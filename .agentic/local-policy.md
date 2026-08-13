# Local Policy — checkin

Repository-specific extensions and exceptions to the pinned harness profile.
This file is **hand-maintained** and referenced from `.agentic/harness.yaml`.

## Architecture

FastAPI service with SQLite persistence under `data/checkins.db`.

- `src/checkin/app.py` — HTTP API (`/health`, `/checkins`)
- `src/checkin/store.py` — SQLite store
- `tests/` — API tests via FastAPI TestClient

## Commands

| Task | Command |
|------|---------|
| Local CI | `bash scripts/ci-local.sh` |
| Dev server | `.venv/bin/uvicorn checkin.app:app --reload --host 0.0.0.0 --port 8000` |
| Install | `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'` |

## Exceptions

None yet.

## Review extras

None yet.
