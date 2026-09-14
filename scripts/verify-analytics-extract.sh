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
MANIFEST_VERSION=$(jq -r '.manifest_version // 1' "$TMP/manifest.json")
PROMPT_KEY=$(jq -r '.tables.checkin_prompt.object_key' "$TMP/manifest.json")
RESPONSE_KEY=$(jq -r '.tables.checkin_response.object_key' "$TMP/manifest.json")
EXPECTED_PROMPT=$(jq -r '.tables.checkin_prompt.row_count' "$TMP/manifest.json")
EXPECTED_RESPONSE=$(jq -r '.tables.checkin_response.row_count' "$TMP/manifest.json")
SOURCE_PROMPT=$(jq -r '.tables.checkin_prompt.source_row_count // "absent"' "$TMP/manifest.json")
SOURCE_RESPONSE=$(jq -r '.tables.checkin_response.source_row_count // "absent"' "$TMP/manifest.json")

wrangler r2 object get "${BUCKET}/${PROMPT_KEY}" --file "$TMP/prompt.jsonl.gz" ${WRANGLER_R2_FLAGS}
wrangler r2 object get "${BUCKET}/${RESPONSE_KEY}" --file "$TMP/response.jsonl.gz" ${WRANGLER_R2_FLAGS}

count_jsonl_lines() {
  local file="$1"
  if [ ! -s "$file" ]; then
    echo 0
    return
  fi
  gunzip -c "$file" | grep -c '^' || true
}

PROMPT_LINES=$(count_jsonl_lines "$TMP/prompt.jsonl.gz")
RESPONSE_LINES=$(count_jsonl_lines "$TMP/response.jsonl.gz")

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
    # there is a broken artifact, not a legacy one.
    if [ "$MANIFEST_VERSION" -ge 2 ] 2>/dev/null; then
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

  for spec in "checkin_prompt ${D1_PROMPT} ${EXPECTED_PROMPT} ${PROMPT_LINES} ${SOURCE_PROMPT}" \
              "checkin_response ${D1_RESPONSE} ${EXPECTED_RESPONSE} ${RESPONSE_LINES} ${SOURCE_RESPONSE}"; do
    # shellcheck disable=SC2086
    set -- $spec
    table="$1" d1="$2" manifest_count="$3" jsonl_lines="$4" source_count="$5"

    if [ -z "$d1" ] || [ "$d1" = "null" ]; then
      report_fail "${table} d1 as-of count unavailable"
      continue
    fi

    if [ "$d1" != "$manifest_count" ] || [ "$d1" != "$jsonl_lines" ]; then
      report_fail "${table} d1 as-of mismatch: d1=${d1} manifest=${manifest_count} jsonl=${jsonl_lines}"
      continue
    fi

    if [ "$source_count" != "absent" ] && [ "$d1" != "$source_count" ]; then
      report_fail "${table} d1 as-of mismatch: d1=${d1} source=${source_count}"
      continue
    fi

    echo "${table}: d1 as-of=${d1} ok"
  done
fi

if [ "$FAILED" != "0" ]; then
  exit 1
fi

if [ "$LEGACY" = "1" ]; then
  echo "tie-back ok (manifest=jsonl only, no source count): prompt=${PROMPT_LINES} response=${RESPONSE_LINES} manifest=${MANIFEST_KEY}"
else
  echo "tie-back ok (source=manifest=jsonl): prompt=${PROMPT_LINES} response=${RESPONSE_LINES} manifest=${MANIFEST_KEY}"
fi
