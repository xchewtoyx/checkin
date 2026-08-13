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

## Quick commands

```bash
bash scripts/ci-local.sh
.venv/bin/uvicorn checkin.app:app --reload --host 0.0.0.0 --port 8000
```

## API

- `GET /health` — liveness
- `POST /checkins` — create a mood checkin (`mood` 1–5, optional `note`)
- `GET /checkins` — list recent checkins
- `GET /checkins/{id}` — fetch one checkin
