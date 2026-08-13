# checkin

A lightweight mood checkin service.

Record moods on a 1–5 scale with optional notes. Data is stored locally in SQLite (`data/checkins.db`).

## Quick start

```bash
bash scripts/ci-local.sh
.venv/bin/uvicorn checkin.app:app --reload --host 0.0.0.0 --port 8000
```

## Example

```bash
curl -s -X POST http://127.0.0.1:8000/checkins \
  -H 'content-type: application/json' \
  -d '{"mood": 4, "note": "productive morning"}'

curl -s http://127.0.0.1:8000/checkins
```

## Development

See [AGENTS.md](AGENTS.md) for harness and local conventions.
