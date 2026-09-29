#!/usr/bin/env bash
# Authenticated production smoke for GET /report.
# Never prints EXPORT_BEARER_TOKEN or the raw HTML body.
set -euo pipefail

if [ -z "${BASE_URL:-}" ]; then
  echo "BASE_URL is required" >&2
  exit 1
fi
if [ -z "${EXPORT_BEARER_TOKEN:-}" ]; then
  echo "EXPORT_BEARER_TOKEN is required" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

status="$(
  curl -sS --retry 5 --retry-delay 3 \
    -o "$tmp" -w '%{http_code}' \
    -H "Authorization: Bearer ${EXPORT_BEARER_TOKEN}" \
    "${BASE_URL%/}/report"
)"

echo "http_status=${status}"
if [ "$status" != "200" ]; then
  echo "expected HTTP 200 from /report" >&2
  exit 1
fi

python3 - "$tmp" <<'PY'
import os
import re
import sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")
token = os.environ["EXPORT_BEARER_TOKEN"]
if token and token in html:
    print("token_in_html=yes", file=sys.stderr)
    sys.exit("EXPORT_BEARER_TOKEN leaked into HTML")

def attr(name: str) -> str | None:
    match = re.search(rf'data-{re.escape(name)}="([^"]*)"', html)
    return match.group(1) if match else None

def figure_for(kind: str) -> str | None:
    match = re.search(
        rf'data-{re.escape(kind)}="[^"]*"[\s\S]*?class="figure">([^<]*)',
        html,
    )
    return match.group(1) if match else None

glance = attr("glance")
answer = attr("answer")
band = attr("band")
extract = attr("extract")
freshness = attr("freshness")
integrity = attr("integrity")
window_match = re.search(r'data-window>([^<]*)', html)
window = window_match.group(1) if window_match else None
answer_figure = figure_for("answer")
extract_figure = figure_for("extract")

print(f"glance={glance}")
print(f"window={window}")
print(f"answer={answer}")
print(f"band={band}")
print(f"answer_figure={answer_figure}")
print(f"extract={extract}")
print(f"freshness={freshness}")
print(f"integrity={integrity}")
print(f"extract_figure={extract_figure}")
print("token_in_html=no")

errors: list[str] = []

if not window or not re.fullmatch(
    r"14 London days · \d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}",
    window,
):
    errors.append("window must state 14 London days with start and end dates")

if answer == "absent":
    if answer_figure != "Absent":
        errors.append("absent answer rate must render as Absent")
    if re.search(r"\d+%", answer_figure or ""):
        errors.append("absent answer rate must not be a percentage")
    if "0/0" in html:
        errors.append("absent data must not render as 0/0")
elif answer == "measured":
    if band not in {"healthy", "friction", "failure"}:
        errors.append("measured rate must carry a #1 §5 band")
    if not re.search(
        r"^\d+/\d+ · \d+% · (Healthy|Friction review|Friction failure)$",
        answer_figure or "",
    ):
        errors.append("measured rate must show answered/sent, percent, and band")
else:
    errors.append("answer cell missing")

if extract == "absent":
    if extract_figure != "Absent":
        errors.append("absent extract must render as Absent")
elif extract == "unreadable":
    if extract_figure != "Unreadable":
        errors.append("unreadable extract must render as Unreadable")
elif extract == "landed":
    if not extract_figure or "Refreshed " not in extract_figure:
        errors.append("landed extract must show a refresh timestamp")
    if freshness in {
        "missed-slot",
        "older-than-24h",
        "missed-slot-and-older-than-24h",
    }:
        if not extract_figure.startswith("Stale ·"):
            errors.append("stale extract must be visibly flagged")
    elif freshness != "current":
        errors.append("landed extract freshness missing")
else:
    errors.append("extract cell missing")

if errors:
    print("smoke_failed=", "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
