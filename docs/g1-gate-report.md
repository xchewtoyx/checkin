# G1 — Live validation gate report

Recorded 2026-09-11 against landed D1 and R2. Thresholds were pre-committed
on 2026-08-13 ([#1 day-0 comment](https://github.com/xchewtoyx/checkin/issues/1#issuecomment-5280674435));
the 50–74% middle band was defined 2026-08-28, before this rate was computed.
Thresholds are not revised after seeing the data.

Primary records: GitHub [#1](https://github.com/xchewtoyx/checkin/issues/1)
(MVP gate) and [#14](https://github.com/xchewtoyx/checkin/issues/14) (extract
gate). Delivery: GitHub [#25](https://github.com/xchewtoyx/checkin/issues/25)
and Linear [CCP-425](https://linear.app/chewcorp/issue/CCP-425). Recorded on
the feature-ask issues as
[#1 comment](https://github.com/xchewtoyx/checkin/issues/1#issuecomment-5641319697)
and
[#14 comment](https://github.com/xchewtoyx/checkin/issues/14#issuecomment-5641319807).

## Numbers (before the verdict)

### #1 §5 — 14-day answer rate (2026-08-13 → 2026-08-26)

Source: production D1 `checkin_prompt` (export columns only), evaluated
2026-09-11. Grain is one row per prompt. London calendar date is taken from
the prompt id (`prompt-YYYY-MM-DD-wN`), which is the scheduler's
Europe/London `dateKey`.

```sql
SELECT id, scheduled_for, sent_at, expires_at, status, created_at
FROM checkin_prompt
ORDER BY created_at ASC;
-- filter: id date in [2026-08-13, 2026-08-26]
```

Verdict metric: **answered / sent**, with expired in the denominator and
`failed` excluded (notification never delivered). In-flight `sent` would
count as non-response; none remain in this window.

| Status in gate window | Count |
| --- | ---: |
| answered | 35 |
| expired | 6 |
| sent | 0 |
| failed | 0 |
| scheduled | 0 |
| **sent prompts (denom)** | **41** |

**Answer rate = 35 / 41 = 85.4%.**

`failed` count = 0, so the including-failed rate is the same 85.4% and is
not shown separately as a distinct figure. Delivery-reliability figure:
**0 failed prompts** in the gate window (and 0 in the full D1 table at
evaluation time).

Per window per day (exactly one prompt per occupied slot; `rate` is
answered / sent for that slot):

| Date | w0 morning | w1 afternoon | w2 evening |
| --- | --- | --- | --- |
| 2026-08-13 | — (go-live after this window) | 1/1 | 1/1 |
| 2026-08-14 | 1/1 | 1/1 | 1/1 |
| 2026-08-15 | 1/1 | 1/1 | 1/1 |
| 2026-08-16 | 1/1 | 1/1 | 1/1 |
| 2026-08-17 | 1/1 | 1/1 | 1/1 |
| 2026-08-18 | 1/1 | 1/1 | 1/1 |
| 2026-08-19 | 1/1 | 1/1 | 1/1 |
| 2026-08-20 | 1/1 | 0/1 expired | 0/1 expired |
| 2026-08-21 | 0/1 expired | 0/1 expired | 1/1 |
| 2026-08-22 | 1/1 | 1/1 | 1/1 |
| 2026-08-23 | 1/1 | 1/1 | 1/1 |
| 2026-08-24 | 1/1 | 1/1 | 1/1 |
| 2026-08-25 | 0/1 expired | 1/1 | 1/1 |
| 2026-08-26 | 0/1 expired | 1/1 | 1/1 |

The six expiries cluster on 20–21 Aug (four consecutive misses after a
perfect first week) and two later morning misses (25 and 26). They are
non-response in the KPI, not noise (F5).

**Duplicate check (F2):** 0 `(window, day)` slots with more than one prompt.
The only unoccupied slot is 2026-08-13 w0, which is before the live clock
started (day-0 owner report is the 14:00 afternoon check-in). That is
absence of a morning sample on go-live day, not a duplicate.

**Drift check (F1, N3):** 0 prompts with `scheduled_for` or `sent_at` outside
08:00–20:00 Europe/London, and 0 outside the configured window of their id
suffix (`w0` 09:00–11:00, `w1` 13:00–15:00, `w2` 17:00–19:00). Send times
fall on the 15-minute cron tick at or after `scheduled_for`, still inside
the window.

### Star-model tie-back (checkin-analytics)

`fact_checkin_prompt` is designed so answer rate is
`SUM(answered_flag)/SUM(prompt_count)`. Rebuilt from the
`2026-08-26/150000` snapshot (extraction 2026-08-26T15:00:04.906Z):

| Snapshot | prompts | answered_flag sum | rate |
| --- | ---: | ---: | ---: |
| 2026-08-26/150000 (mid-gate-day) | 40 | 34 | 85.0% |

That snapshot is a point-in-time copy taken at 15:00 UTC / 16:00 London,
so it correctly omits 2026-08-26 w2 (not yet issued) and still has
2026-08-26 w1 as `sent` (answered later). The closed D1 state, and the next
snapshot `2026-08-27/030000`, both have the full 41-row gate universe at
35 answered / 6 expired = **85.4%**. The 15:00 UTC snapshot and the closed
state agree to rounding; they are not expected to be row-identical.

### #14 §6 — 7-day extract gate (2026-08-20 → 2026-08-26)

Required: both daily manifests (`030000`, `150000`) per table, zero
unexplained `analytics_extract_failed` events, analytics-side row counts
tying back to D1.

**Manifests:** 14/14 present under
`raw/cloudflare/checkins/manifests/extraction_date=YYYY-MM-DD/{030000,150000}.json`
for 2026-08-20 through 2026-08-26. Matching `checkin_prompt` and
`checkin_response` `.jsonl.gz` objects exist for every slot.

**Tie-back** (same check as `scripts/verify-analytics-extract.sh`): for all
14 slots, gunzipped JSONL line counts equal the manifest `row_count` for
both tables (28/28 table files). End-of-gate slot
`2026-08-26/150000`:

| Table | manifest | jsonl lines | D1 rows with `created_at` ≤ extraction_timestamp |
| --- | ---: | ---: | ---: |
| checkin_prompt | 40 | 40 | 40 |
| checkin_response | 34 | 34 | (34 answered prompts at that instant) |

**Unexplained extract failures:** Workers Observability log query is not
authorised with the deploy token (API 10000). Absence is observable from
the bucket (N3): the only missing slot in the entire landing zone is
`2026-08-15/030000`, which is outside this 7-day window and was explained
on the day (E1 deployed after that morning UTC slot). From 2026-08-16
`030000` through 2026-09-11 `150000` every expected slot is present. No
unexplained gap in the gate window.

## Verdict

Pre-committed bands: ≥ 75% pass; 50–74% pass-with-friction-review; < 50%
friction failure.

| Gate | Metric | Threshold | Result |
| --- | --- | --- | --- |
| #1 answer rate | 35/41 = **85.4%** | ≥ 75% pass | **PASS** |
| #1 duplicates | 0 | 0 | **PASS** |
| #1 schedule drift | 0 | 0 | **PASS** |
| #14 manifests | 14/14 slots | 7 days × 2 slots | **PASS** |
| #14 tie-back | 28/28 files match | manifest = jsonl = D1 as-of | **PASS** |
| #14 unexplained failures | none in landing zone | 0 | **PASS** |

**#1 live validation gate: PASS.** Backlog order is unchanged. The check-in
UX slice ([#40](https://github.com/xchewtoyx/checkin/issues/40) /
CCP-428) is not pulled forward by this gate; it remains in its planned
place.

**#14 extract gate: PASS.** Downstream analytics work
([checkin-analytics#1](https://github.com/xchewtoyx/checkin-analytics/issues/1),
[checkin-analytics#5](https://github.com/xchewtoyx/checkin-analytics/issues/5))
is not blocked by this gate.
