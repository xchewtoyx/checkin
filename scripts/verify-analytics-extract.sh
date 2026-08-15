#!/usr/bin/env bash
set -euo pipefail

# Tie-back verification for a landed analytics extract manifest (issue #14, F6).
#
# Usage:
#   bash scripts/verify-analytics-extract.sh <manifest-object-key>
#
# Example:
#   bash scripts/verify-analytics-extract.sh \
# Example (morning slot):
#   raw/cloudflare/checkins/manifests/extraction_date=2026-08-15/030000.json
# Example (afternoon slot):
#   raw/cloudflare/checkins/manifests/extraction_date=2026-08-15/150000.json
#
# Requires: wrangler (authenticated), jq, gunzip. Uses remote R2 unless --local is
# passed through WRANGLER_R2_FLAGS.

MANIFEST_KEY="${1:?Usage: verify-analytics-extract.sh <manifest-object-key>}"
BUCKET="${ANALYTICS_R2_BUCKET:-checkin-analytics}"
WRANGLER_R2_FLAGS="${WRANGLER_R2_FLAGS:-}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

wrangler r2 object get "${BUCKET}/${MANIFEST_KEY}" --file "$TMP/manifest.json" ${WRANGLER_R2_FLAGS}

PROMPT_KEY=$(jq -r '.tables.checkin_prompt.object_key' "$TMP/manifest.json")
RESPONSE_KEY=$(jq -r '.tables.checkin_response.object_key' "$TMP/manifest.json")
EXPECTED_PROMPT=$(jq -r '.tables.checkin_prompt.row_count' "$TMP/manifest.json")
EXPECTED_RESPONSE=$(jq -r '.tables.checkin_response.row_count' "$TMP/manifest.json")

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

if [ "$PROMPT_LINES" != "$EXPECTED_PROMPT" ]; then
  echo "checkin_prompt count mismatch: manifest=${EXPECTED_PROMPT} jsonl=${PROMPT_LINES}" >&2
  exit 1
fi

if [ "$RESPONSE_LINES" != "$EXPECTED_RESPONSE" ]; then
  echo "checkin_response count mismatch: manifest=${EXPECTED_RESPONSE} jsonl=${RESPONSE_LINES}" >&2
  exit 1
fi

echo "tie-back ok: prompt=${PROMPT_LINES} response=${RESPONSE_LINES} manifest=${MANIFEST_KEY}"
