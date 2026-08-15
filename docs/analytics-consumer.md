# Analytics consumer hookup

Operational guide for importing checkin analytics extracts from R2 (issue #14, slice **E2**). The extract layout and data contract live in [`analytics-extract.md`](analytics-extract.md); this document covers **consumer access only**.

## Bucket and prefixes

| Resource | Value |
| --- | --- |
| R2 bucket | `checkin-analytics` |
| Prompt import prefix | `raw/cloudflare/checkins/checkin_prompt/` |
| Response import prefix | `raw/cloudflare/checkins/checkin_response/` |
| Manifest prefix (monitoring) | `raw/cloudflare/checkins/manifests/` |

Each daily export writes three objects under a shared `extraction_date=YYYY-MM-DD/HHMMSS` partition key (slot time **03:00 UTC** → `030000`).

## Read-only R2 token (N2)

Create a Cloudflare **R2 API token** scoped for the analytics platform:

1. Cloudflare dashboard → **R2** → **Manage R2 API tokens** → **Create API token**.
2. Permissions: **Object Read** only (no Object Write, no Admin Read/Write).
3. Scope: bucket `checkin-analytics` only. Optionally restrict to prefix `raw/` if your token UI supports prefix conditions.
4. Store the token in the analytics platform's secret store — **not** in this repo or Worker secrets.

The Worker continues to write through its R2 binding (`EXTRACT_BUCKET`); no new Worker secrets are added for consumer access.

### Verify read-only scope

With the consumer credentials and [R2's S3-compatible endpoint](https://developers.cloudflare.com/r2/api/s3/api/):

```bash
export AWS_ACCESS_KEY_ID="<token-access-key>"
export AWS_SECRET_ACCESS_KEY="<token-secret>"
export AWS_ENDPOINT_URL="https://<account_id>.r2.cloudflarestorage.com"

# Should succeed
aws s3 ls "s3://checkin-analytics/raw/cloudflare/checkins/manifests/"

# Should fail (AccessDenied) — confirms write is blocked
aws s3 cp /etc/hosts "s3://checkin-analytics/raw/_write_probe" || echo "write correctly denied"
```

Replace `<account_id>` with your Cloudflare account ID (`CLOUDFLARE_ACCOUNT_ID`).

## Import-source configuration (F2)

Point the analytics platform's **S3-compatible import** at two table prefixes (one import job or mapping per prefix):

| Import name | S3 URI prefix | Format |
| --- | --- | --- |
| `checkin_prompt` | `s3://checkin-analytics/raw/cloudflare/checkins/checkin_prompt/` | gzipped JSONL, Hive partition `extraction_date` |
| `checkin_response` | `s3://checkin-analytics/raw/cloudflare/checkins/checkin_response/` | gzipped JSONL, Hive partition `extraction_date` |

Column names match D1 exactly, except `response_token` and `notification_id` are **never** present in prompt exports (F4). Select the **latest** file per table (or latest `extraction_date` partition) when loading current state — snapshots are complete point-in-time copies, not deltas.

## Tie-back verification (F6)

After an export lands, confirm manifest counts match the gzipped JSONL line counts:

```bash
# List manifests (consumer read-only token or operator wrangler auth)
aws s3 ls "s3://checkin-analytics/raw/cloudflare/checkins/manifests/" --recursive

# Operator tie-back (uses wrangler + jq)
bash scripts/verify-analytics-extract.sh \
  raw/cloudflare/checkins/manifests/extraction_date=YYYY-MM-DD/030000.json
```

Expected output: `tie-back ok: prompt=N response=M manifest=...`

## Absence detection (N3)

Alarm when a calendar day has **no** manifest under `raw/cloudflare/checkins/manifests/extraction_date=YYYY-MM-DD/`. Example check (run daily after 04:00 UTC):

```bash
DATE=$(date -u +%F)
aws s3 ls "s3://checkin-analytics/raw/cloudflare/checkins/manifests/extraction_date=${DATE}/" \
  | grep -q . || echo "missing export for ${DATE}"
```

Export failures are also logged server-side as `analytics_extract_failed`.

## Live validation gate

The pre-committed production gate (7 consecutive days, row counts matching D1 on inspection) is tracked on [#14](https://github.com/xchewtoyx/checkin/issues/14). Complete E2 hookup before starting that clock.
