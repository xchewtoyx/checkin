#!/usr/bin/env bash
# Production dump for the G1 live-validation gate (checkin#25 / CCP-425).
# Reads D1 prompt lifecycle fields (no tokens) and R2 extract objects.
# Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID and a patched
# wrangler.toml production D1 id (same as .github/workflows/deploy.yml).
set -euo pipefail

OUT="${G1_DUMP_DIR:-/tmp/g1-gate-dump}"
BUCKET="${ANALYTICS_R2_BUCKET:-checkin-analytics}"
mkdir -p "$OUT/manifests" "$OUT/prompts" "$OUT/responses" "$OUT/logs"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required" >&2
  exit 1
fi

echo "== D1 checkin_prompt (export columns only) =="
npx wrangler d1 execute checkin --remote --env production --json --command \
  "SELECT id, scheduled_for, sent_at, expires_at, status, created_at
   FROM checkin_prompt
   ORDER BY created_at ASC" \
  > "$OUT/d1-prompts.json"

echo "== D1 prompt status counts =="
npx wrangler d1 execute checkin --remote --env production --json --command \
  "SELECT status, COUNT(*) AS n FROM checkin_prompt GROUP BY status ORDER BY status" \
  > "$OUT/d1-prompt-status-counts.json"

echo "== D1 response counts (no feeling/intensity) =="
npx wrangler d1 execute checkin --remote --env production --json --command \
  "SELECT COUNT(*) AS n FROM checkin_response" \
  > "$OUT/d1-response-count.json"

echo "== R2 object list (manifests + tables) =="
# wrangler 3.109: r2 object list <bucket> [--prefix]
npx wrangler r2 object list "$BUCKET" --prefix "raw/cloudflare/checkins/" \
  > "$OUT/r2-object-list.txt" || {
  echo "wrangler r2 object list failed; trying REST API" >&2
  curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=raw/cloudflare/checkins/" \
    > "$OUT/r2-object-list-api.json"
}

# Also paginate via Cloudflare R2 HTTP API for a machine-readable listing.
curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=raw/cloudflare/checkins/&per_page=1000" \
  > "$OUT/r2-object-list-api.json" || true

download_key() {
  local key="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  npx wrangler r2 object get "${BUCKET}/${key}" --file "$dest" --remote || \
    npx wrangler r2 object get "${BUCKET}/${key}" --file "$dest"
}

# Expected extract-gate days: 2026-08-20 → 2026-08-26, both slots.
for DATE in 2026-08-20 2026-08-21 2026-08-22 2026-08-23 2026-08-24 2026-08-25 2026-08-26; do
  for SLOT in 030000 150000; do
    MANIFEST="raw/cloudflare/checkins/manifests/extraction_date=${DATE}/${SLOT}.json"
    DEST="$OUT/manifests/extraction_date=${DATE}/${SLOT}.json"
    echo "get $MANIFEST"
    if download_key "$MANIFEST" "$DEST"; then
      echo "ok $MANIFEST" >> "$OUT/manifest-fetch.txt"
    else
      echo "MISSING $MANIFEST" >> "$OUT/manifest-fetch.txt"
      continue
    fi
    PROMPT_KEY="raw/cloudflare/checkins/checkin_prompt/extraction_date=${DATE}/${SLOT}.jsonl.gz"
    RESPONSE_KEY="raw/cloudflare/checkins/checkin_response/extraction_date=${DATE}/${SLOT}.jsonl.gz"
    download_key "$PROMPT_KEY" "$OUT/prompts/extraction_date=${DATE}/${SLOT}.jsonl.gz" || \
      echo "MISSING $PROMPT_KEY" >> "$OUT/manifest-fetch.txt"
    download_key "$RESPONSE_KEY" "$OUT/responses/extraction_date=${DATE}/${SLOT}.jsonl.gz" || \
      echo "MISSING $RESPONSE_KEY" >> "$OUT/manifest-fetch.txt"
  done
done

# Latest snapshot on/after gate end for D1 tie-back (prefer 2026-08-26/150000).
for SNAP in \
  "2026-08-26/150000" \
  "2026-08-26/030000" \
  "2026-08-27/030000" \
  "2026-08-27/150000"
do
  DATE="${SNAP%/*}"
  SLOT="${SNAP#*/}"
  KEY="raw/cloudflare/checkins/checkin_prompt/extraction_date=${DATE}/${SLOT}.jsonl.gz"
  DEST="$OUT/prompts/latest-candidate-${DATE}-${SLOT}.jsonl.gz"
  if download_key "$KEY" "$DEST"; then
    echo "latest_candidate=${DATE}/${SLOT}" >> "$OUT/manifest-fetch.txt"
  fi
done

echo "== Workers Observability: analytics_extract_failed =="
# Workers Logs query API (best-effort; dump the response even on 4xx).
# Window: 2026-08-13 00:00 UTC → 2026-08-27 00:00 UTC.
START_MS=1755043200000
END_MS=1756252800000
curl -sS -X POST \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query" \
  -d "{
    \"queryId\": \"g1-extract-failed\",
    \"timeframe\": {\"from\": ${START_MS}, \"to\": ${END_MS}},
    \"parameters\": {
      \"datasets\": [\"cloudflare-workers\"],
      \"filters\": [
        {\"key\": \"scriptName\", \"operation\": \"eq\", \"value\": \"checkin\"},
        {\"key\": \"message\", \"operation\": \"includes\", \"value\": \"analytics_extract_failed\"}
      ],
      \"limit\": 100
    }
  }" > "$OUT/logs/observability-extract-failed.json" || true

curl -sS -X POST \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query" \
  -d "{
    \"queryId\": \"g1-extract-events\",
    \"timeframe\": {\"from\": ${START_MS}, \"to\": ${END_MS}},
    \"parameters\": {
      \"datasets\": [\"cloudflare-workers\"],
      \"filters\": [
        {\"key\": \"scriptName\", \"operation\": \"eq\", \"value\": \"checkin\"}
      ],
      \"needle\": {\"value\": \"analytics_extract\"},
      \"limit\": 200
    }
  }" > "$OUT/logs/observability-extract-events.json" || true

echo "== dump complete =="
find "$OUT" -type f | sort
