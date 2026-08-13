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

## Issue tracking

This repo does **not** use GitHub milestones.

| Role | Issue |
|------|-------|
| Scope epic / "milestone" | [#1 Project MVP](https://github.com/xchewtoyx/checkin/issues/1) |
| Stories, tasks, bugs | Sub-issues of #1 |

When filing new work:

1. Create the issue as a **sub-issue** of #1.
2. Do not assign GitHub milestones.
3. Parent stories under #1 directly; nest tasks under their story when the hierarchy helps.

The MVP requirements live in #1's body; `docs/mvp-scope.md` (when present) is a mirror.

## Exceptions

None yet.

## Review extras

None yet.
