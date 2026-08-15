# checkin

A lightweight mood checkin service.

## Development harness

This repository pins a versioned agentic development control plane:

- **Harness:** [rgh-mms](https://github.com/xchewtoyx/rgh-mms.git) `v0.1.0`
- **Profile:** `generic`
- **Contract:** [.agentic/harness.yaml](.agentic/harness.yaml)

This harness is an optional convenience layer, not a mandatory standard —
everything it adds here is fully removable. Scope and adoption boundaries:
`policy/mission-boundaries.md` in the pinned harness source above.

## Local conventions

Repository-specific architecture, commands, and exceptions:

- [.agentic/local-policy.md](.agentic/local-policy.md)

## Issue tracking

This repo does **not** use GitHub milestones.

- **Scope epic:** [#1 Project MVP](https://github.com/xchewtoyx/checkin/issues/1) — the primary requirements record and delivery scope.
- **Stories and tasks:** file as GitHub **sub-issues** nested under #1 (not as milestone members).
- When starting work, confirm the issue is a sub-issue of #1 before cutting a branch.

## Quick commands

```bash
bash scripts/ci-local.sh
npm run dev
```

Deploy is automated on push to `main` — see [docs/deploy.md](docs/deploy.md) for required GitHub secrets and one-time setup.

## API (M2)

- `GET /health` — liveness
- `GET/POST /c/:token` — check-in page and submission
- `GET /api/responses?from=&to=` — bearer-token JSON export
- Cron (15 min) — scheduler, Pushover notification, expiry sweep, daily analytics extract to R2

Secrets (Worker): `PUSHOVER_TOKEN`, `PUSHOVER_USER`, `EXPORT_BEARER_TOKEN`. Vars: `BASE_URL`, `SCHEDULE_WINDOWS`.
