#!/usr/bin/env bash
# Ensure the analytics R2 bucket exists. Idempotent: succeeds if created or already owned.
set -euo pipefail

BUCKET="${1:-checkin-analytics}"

set +e
output=$(npx wrangler r2 bucket create "$BUCKET" 2>&1)
code=$?
set -e

if [ "$code" -eq 0 ]; then
  echo "$output"
  exit 0
fi

if echo "$output" | grep -qE 'already exists|10004'; then
  echo "Bucket $BUCKET already exists — ok"
  exit 0
fi

if echo "$output" | grep -qE '10042|enable R2'; then
  echo "Enable R2 on the account first — see docs/deploy.md §2" >&2
fi

echo "$output" >&2
exit "$code"
