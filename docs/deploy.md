# Deploy

Automated deploy to Cloudflare on every push to `main`. Routine releases do not require a local `wrangler deploy`.

## One-time setup

### 1. Cloudflare D1

Create the database once (Cloudflare dashboard or CLI with a personal token):

```bash
npx wrangler login   # local only for this one-time step
npx wrangler d1 create checkin
```

Copy the returned **database ID** into the GitHub repository variable `CLOUDFLARE_D1_DATABASE_ID`.

### 2. Analytics extract bucket (R2)

Create the R2 bucket once for daily D1 snapshots (issue #14):

```bash
npx wrangler r2 bucket create checkin-analytics
```

The Worker binds this bucket as `EXTRACT_BUCKET` in `wrangler.toml`. No new Worker secrets are required — the binding uses the deploy token's R2 permissions.

### 3. Pushover

Create a Pushover application at [pushover.net](https://pushover.net/) and note:

- Application API token → GitHub secret `PUSHOVER_TOKEN`
- User key → GitHub secret `PUSHOVER_USER`

### 4. Export bearer token

Generate a long random token for `/api/responses`:

```bash
openssl rand -hex 32
```

Store as GitHub secret `EXPORT_BEARER_TOKEN`.

### 5. Cloudflare API token

Create an API token with at least:

- Account → Cloudflare Workers Scripts → Edit
- Account → D1 → Edit
- Account → R2 → Edit
- Account → Account Settings → Read

Store as GitHub secret `CLOUDFLARE_API_TOKEN`. Store your account ID as `CLOUDFLARE_ACCOUNT_ID`.

### 6. Production URL

After the first successful deploy, set GitHub repository variable:

| Variable | Example |
|----------|---------|
| `BASE_URL` | `https://checkin.<your-subdomain>.workers.dev` |

Re-run the deploy workflow (or push to `main`) if the first deploy ran before `BASE_URL` was set.

## GitHub configuration summary

### Secrets (Settings → Secrets and variables → Actions → Secrets)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy and D1 migrations in CI |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `PUSHOVER_TOKEN` | Pushover application API token (Worker runtime) |
| `PUSHOVER_USER` | Pushover user key (Worker runtime) |
| `EXPORT_BEARER_TOKEN` | Bearer token for `GET /api/responses` (Worker runtime) |

### Variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Purpose |
|----------|---------|
| `CLOUDFLARE_D1_DATABASE_ID` | D1 database ID from `wrangler d1 create checkin` |
| `BASE_URL` | Public Worker URL (used for Pushover links and deploy smoke test) |

## What CI does on push to `main`

1. Run tests (`scripts/ci-local.sh`)
2. Patch `wrangler.toml` production D1 binding with `CLOUDFLARE_D1_DATABASE_ID`
3. Apply D1 migrations remotely
4. Sync Worker secrets from GitHub secrets
5. `wrangler deploy --env production` with `BASE_URL` var
6. Smoke test `GET $BASE_URL/health`

## Manual smoke test (after first deploy)

```bash
curl "$BASE_URL/health"
# → {"status":"ok"}

curl -H "Authorization: Bearer $EXPORT_BEARER_TOKEN" \
  "$BASE_URL/api/responses"
```

Confirm a Pushover notification arrives and a check-in completes end-to-end on your phone.

## Local development

Local dev does not use production secrets or deploy settings:

```bash
npm ci
npm run dev
```

Production configuration lives in the `production` Wrangler environment; local defaults use `local-checkin-db` and `http://127.0.0.1:8787`.

## Analytics extract (issue #14)

Daily D1 snapshots land in R2 bucket `checkin-analytics` (see [analytics-extract.md](analytics-extract.md)). After E1 deploy:

1. Ensure the bucket exists (`wrangler r2 bucket create checkin-analytics` — also attempted in deploy workflow).
2. Complete **consumer hookup** per [analytics-consumer.md](analytics-consumer.md): read-only R2 token, import-source prefixes, tie-back verification.
3. Run tie-back on the latest manifest:

```bash
bash scripts/verify-analytics-extract.sh \
  raw/cloudflare/checkins/manifests/extraction_date=YYYY-MM-DD/030000.json
```
