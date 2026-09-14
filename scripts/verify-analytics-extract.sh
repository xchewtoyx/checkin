#!/usr/bin/env bash
set -euo pipefail

# Tie-back verification for a landed analytics extract manifest (issue #14, F6).
#
# Compares three numbers per table and fails on any disagreement:
#   1. manifest row_count        — rows the worker serialized
#   2. gunzipped JSONL lines     — rows that actually landed in R2
#   3. manifest source_row_count — an independent SELECT COUNT(*) taken by the
#                                  worker on a separate code path from the row
#                                  fetch, so a short read from the unpaged
#                                  export query is visible here
#
# (1) vs (2) alone is tautological for read errors: both derive from the same
# in-memory array, so it can only catch a corrupt or truncated upload. (3) is
# what ties the extract back to D1.
#
# manifest_version 1 artifacts (written before the source count existed) carry
# no source_row_count. Those are still verified (1) vs (2) and reported as
# such, rather than failing. A manifest that declares version 2 or later and
# omits the field fails: the version is the promise that the tie-back is there.
#
# Usage:
#   bash scripts/verify-analytics-extract.sh <manifest-object-key> [--d1]
#
# Example (morning slot):
#   raw/cloudflare/checkins/manifests/extraction_date=2026-08-15/030000.json
# Example (afternoon slot):
#   raw/cloudflare/checkins/manifests/extraction_date=2026-08-15/150000.json
#
# --d1 additionally runs a live as-of count against D1, bounded by the
# manifest's extraction_timestamp, and compares it to the same three numbers.
# That makes this script usable on a historical slot, instead of the as-of
# count having to be run by hand. It is opt-in because it needs D1 credentials;
# the default path needs none.
#
# The as-of count is reconstructed from current table state, so it assumes no
# rows were deleted or edited since extraction — it cannot detect a row mutated
# in place afterwards.
#
# It can also report a false mismatch for an extract that was correct when it
# was taken. Two reasons, both issue #62: submitted_at/created_at are stamped at
# request start rather than at commit, so a submission in flight across the
# export can carry a timestamp inside the watermark while committing after the
# export read it; and checkin_response is exported unbounded (it has no
# immutable creation column — bounding on the mutable submitted_at would drop
# re-answered responses), so a response written mid-run lands in the slot while
# falling outside this as-of query. Check for both before treating a --d1
# mismatch of one or two rows as a real failure.
#
# Requires: wrangler (authenticated), jq, gunzip. Uses remote R2 unless --local is
# passed through WRANGLER_R2_FLAGS.
#
# --d1 additionally requires curl, CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID. It goes to the D1 HTTP API rather than
# `wrangler d1 execute` because the checked-in wrangler.toml carries a
# placeholder production database_id (substituted at deploy time), so wrangler
# cannot resolve the production database from a working copy. Set
# D1_DATABASE_ID to skip the name lookup; D1_DATABASE (default: checkin) names
# the database otherwise.

MANIFEST_KEY="${1:?Usage: verify-analytics-extract.sh <manifest-object-key> [--d1]}"
shift || true

CHECK_D1=0
for arg in "$@"; do
  case "$arg" in
    --d1) CHECK_D1=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

BUCKET="${ANALYTICS_R2_BUCKET:-checkin-analytics}"
WRANGLER_R2_FLAGS="${WRANGLER_R2_FLAGS:-}"
D1_DATABASE="${D1_DATABASE:-checkin}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

wrangler r2 object get "${BUCKET}/${MANIFEST_KEY}" --file "$TMP/manifest.json" ${WRANGLER_R2_FLAGS}

EXTRACTION_TIMESTAMP=$(jq -r '.extraction_timestamp' "$TMP/manifest.json")
# The manifest version is classified entirely in jq, and the shell only compares
# the resulting label. Every step of this has to happen before the value reaches
# bash:
#   - `.manifest_version // 1` would default an explicit null or false to 1, and
#     -r renders the string "1" identically to the number 1, so a malformed
#     manifest would look absent and take the legacy path.
#   - `[ "$v" -ge 2 ]` is bounded by the shell's signed integer range. An
#     all-digit version too large for it (9999999999999999999) makes both the
#     range test and the >= 2 test error out rather than fail; inside an `if`
#     condition that is not fatal even under `set -e`, so the version would fall
#     through to legacy and skip the source-count requirement.
# An absent version means 1. A present one must be an integer >= 1. Version 1 is
# legacy (manifest-to-JSONL only); every version from 2 up promises
# source_row_count and is required to carry it.
MANIFEST_VERSION_INFO=$(jq -r '
  if (has("manifest_version") | not) then "legacy 1"
  elif (.manifest_version | type) != "number" then "invalid " + (.manifest_version | type)
  elif (.manifest_version | floor) != .manifest_version then "invalid non-integer"
  elif .manifest_version < 1 then "invalid out-of-range"
  elif .manifest_version < 2 then "legacy " + (.manifest_version | tostring)
  else "strict " + (.manifest_version | tostring)
  end' "$TMP/manifest.json")

MANIFEST_VERSION_CLASS="${MANIFEST_VERSION_INFO%% *}"
MANIFEST_VERSION="${MANIFEST_VERSION_INFO#* }"

if [ "$MANIFEST_VERSION_CLASS" = "invalid" ]; then
  echo "unsupported manifest_version: ${MANIFEST_VERSION}" >&2
  exit 1
fi
PROMPT_KEY=$(jq -r '.tables.checkin_prompt.object_key' "$TMP/manifest.json")
RESPONSE_KEY=$(jq -r '.tables.checkin_response.object_key' "$TMP/manifest.json")

# Counts are validated as JSON before they are read, for the same reason as the
# version: `jq -r` renders the string "1" identically to the number 1, so a
# manifest with string-encoded counts would sail through the three-way
# comparison. Missing is only legal for source_row_count, and is reported as
# "absent" rather than defaulted, so the version gate decides what it means.
count_field() {
  local table="$1" field="$2" allow_absent="$3"
  jq -r --arg table "$table" --arg field "$field" --arg absent "$allow_absent" '
    .tables[$table][$field] as $value
    | if $value == null then (if $absent == "yes" then "absent" else "invalid missing" end)
      elif ($value | type) != "number" then "invalid " + ($value | type)
      elif ($value | floor) != $value then "invalid non-integer"
      elif $value < 0 then "invalid negative"
      else ($value | tostring)
      end' "$TMP/manifest.json"
}

read_count() {
  local table="$1" field="$2" allow_absent="$3" value
  value=$(count_field "$table" "$field" "$allow_absent")
  case "$value" in
    invalid*)
      echo "${table}.${field} is not a non-negative integer: ${value#invalid }" >&2
      exit 1
      ;;
  esac
  echo "$value"
}

EXPECTED_PROMPT=$(read_count checkin_prompt row_count no)
EXPECTED_RESPONSE=$(read_count checkin_response row_count no)
SOURCE_PROMPT=$(read_count checkin_prompt source_row_count yes)
SOURCE_RESPONSE=$(read_count checkin_response source_row_count yes)

wrangler r2 object get "${BUCKET}/${PROMPT_KEY}" --file "$TMP/prompt.jsonl.gz" ${WRANGLER_R2_FLAGS}
wrangler r2 object get "${BUCKET}/${RESPONSE_KEY}" --file "$TMP/response.jsonl.gz" ${WRANGLER_R2_FLAGS}

# Decompress fully and check gzip's own exit status before counting. A gzip
# object truncated after its payload but before its trailer emits every row and
# *then* fails; piping straight into `grep -c '^' || true` discarded that status
# and returned the expected line count, so the verifier could certify exactly the
# corrupt upload this check exists to catch. `|| true` was there because grep -c
# exits 1 on a zero count, so the two failures have to be told apart rather than
# both swallowed.
count_jsonl_lines() {
  local file="$1" text
  if [ ! -s "$file" ]; then
    echo 0
    return
  fi
  if ! text=$(gunzip -c "$file"); then
    return 1
  fi
  if [ -z "$text" ]; then
    echo 0
    return
  fi
  printf '%s\n' "$text" | grep -c '^'
}

if ! PROMPT_LINES=$(count_jsonl_lines "$TMP/prompt.jsonl.gz"); then
  echo "checkin_prompt object failed to decompress (truncated or corrupt)" >&2
  exit 1
fi
if ! RESPONSE_LINES=$(count_jsonl_lines "$TMP/response.jsonl.gz"); then
  echo "checkin_response object failed to decompress (truncated or corrupt)" >&2
  exit 1
fi

FAILED=0
LEGACY=0

report_fail() {
  echo "$1" >&2
  FAILED=1
}

check_table() {
  local table="$1" manifest_count="$2" jsonl_lines="$3" source_count="$4"

  if [ "$jsonl_lines" != "$manifest_count" ]; then
    report_fail "${table} count mismatch: manifest=${manifest_count} jsonl=${jsonl_lines}"
  fi

  if [ "$source_count" = "absent" ]; then
    # Only a version 1 manifest is allowed to lack the source count. A manifest
    # declaring version 2 or later promises the tie-back, so a missing field
    # there is a broken artifact, not a legacy one. The comparison was made in
    # jq; this is a string test, so no version can slip past on integer range.
    if [ "$MANIFEST_VERSION_CLASS" = "strict" ]; then
      report_fail "${table} manifest declares manifest_version ${MANIFEST_VERSION} but has no source_row_count"
      return
    fi
    echo "${table}: no source_row_count in manifest (manifest_version ${MANIFEST_VERSION}) — manifest-to-jsonl check only"
    LEGACY=1
    return
  fi

  if [ "$source_count" != "$manifest_count" ]; then
    report_fail "${table} source count mismatch: source=${source_count} manifest=${manifest_count}"
  fi

  if [ "$source_count" != "$jsonl_lines" ]; then
    report_fail "${table} source count mismatch: source=${source_count} jsonl=${jsonl_lines}"
  fi
}

check_table checkin_prompt "$EXPECTED_PROMPT" "$PROMPT_LINES" "$SOURCE_PROMPT"
check_table checkin_response "$EXPECTED_RESPONSE" "$RESPONSE_LINES" "$SOURCE_RESPONSE"

d1_api() {
  local path="$1"
  shift
  curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database${path}" "$@"
}

resolve_d1_database_id() {
  if [ -n "${D1_DATABASE_ID:-}" ]; then
    echo "$D1_DATABASE_ID"
    return
  fi
  d1_api "" | jq -r --arg name "$D1_DATABASE" \
    '.result[] | select(.name == $name) | .uuid'
}

d1_count() {
  local database_id="$1" table="$2" column="$3" sql
  sql="SELECT COUNT(*) AS row_count FROM ${table} WHERE ${column} <= '${EXTRACTION_TIMESTAMP}';"
  d1_api "/${database_id}/query" \
    -X POST -H "Content-Type: application/json" \
    --data "$(jq -n --arg sql "$sql" '{sql: $sql}')" \
    | jq -r '.result[0].results[0].row_count // empty'
}

# Values are passed as separate quoted arguments rather than packed into one
# whitespace-separated string: d1_count yields an empty value when the API
# returns an error envelope, and word-splitting such a string would drop that
# field, shift every later one, and abort under `set -u` before the
# "count unavailable" branch below could report the real problem.
check_d1_table() {
  local table="$1" d1="$2" manifest_count="$3" jsonl_lines="$4" source_count="$5"

  if [ -z "$d1" ] || [ "$d1" = "null" ]; then
    report_fail "${table} d1 as-of count unavailable (check CLOUDFLARE_API_TOKEN and database access)"
    return
  fi

  if [ "$d1" != "$manifest_count" ] || [ "$d1" != "$jsonl_lines" ]; then
    report_fail "${table} d1 as-of mismatch: d1=${d1} manifest=${manifest_count} jsonl=${jsonl_lines}"
    return
  fi

  if [ "$source_count" != "absent" ] && [ "$d1" != "$source_count" ]; then
    report_fail "${table} d1 as-of mismatch: d1=${d1} source=${source_count}"
    return
  fi

  echo "${table}: d1 as-of=${d1} ok"
}

if [ "$CHECK_D1" = "1" ]; then
  : "${CLOUDFLARE_API_TOKEN:?--d1 requires CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ACCOUNT_ID:?--d1 requires CLOUDFLARE_ACCOUNT_ID}"

  DATABASE_ID=$(resolve_d1_database_id)
  if [ -z "$DATABASE_ID" ]; then
    echo "could not resolve D1 database '${D1_DATABASE}'" >&2
    exit 1
  fi

  echo "as-of D1 counts at ${EXTRACTION_TIMESTAMP} (assumes no deletes or in-place edits since)"
  D1_PROMPT=$(d1_count "$DATABASE_ID" checkin_prompt created_at)
  D1_RESPONSE=$(d1_count "$DATABASE_ID" checkin_response submitted_at)

  check_d1_table checkin_prompt "$D1_PROMPT" "$EXPECTED_PROMPT" "$PROMPT_LINES" "$SOURCE_PROMPT"
  check_d1_table checkin_response "$D1_RESPONSE" "$EXPECTED_RESPONSE" "$RESPONSE_LINES" "$SOURCE_RESPONSE"
fi

if [ "$FAILED" != "0" ]; then
  exit 1
fi

if [ "$LEGACY" = "1" ]; then
  echo "tie-back ok (manifest=jsonl only, no source count): prompt=${PROMPT_LINES} response=${RESPONSE_LINES} manifest=${MANIFEST_KEY}"
else
  echo "tie-back ok (source=manifest=jsonl): prompt=${PROMPT_LINES} response=${RESPONSE_LINES} manifest=${MANIFEST_KEY}"
fi
