# Mood Check-in — MVP Scope and Requirements

The primary record of the MVP scope is
[issue #1](https://github.com/xchewtoyx/checkin/issues/1); this document is a
repo-local mirror of it, kept for offline reference. If the two drift, the
issue wins. The original, fuller proposal is preserved in the issue's edit
history. Deferred items return via the backlog in §7, not by silently
re-expanding scope.

## 1. Problem definition

- **Now (R1):** Mood over the day is unrecorded. There is no structured data
  to analyse, and no sampling mechanism that isn't biased by when the user
  happens to think of it.
- **Desired (R2):** A sustained, structured time series of
  `(feeling, intensity, observed_at)` samples, captured at 3–4 semi-random
  points per day, with interaction friction low enough that responding stays
  habitual for months.
- **Question:** What is the smallest system that sustains that capture for
  one user?

The governing principle from the proposal stands: this is a **measurement
instrument**, not an interpretation or intervention system. The critical path
is `notification → feeling → intensity → done`, and any feature that slows
that path needs strong justification.

## 2. Mandated constraints

Fixed before analysis, recorded with rationale so each can be re-examined if
its reason lapses:

| Constraint | Rationale |
| --- | --- |
| Cloudflare Workers + Cron Triggers + D1, free tier | Scheduled execution and HTTPS response handling without owning a daemon, TLS, DNS, patching, or backups. Workload is orders of magnitude below free-tier limits. |
| Pushover for notifications | Only push transport that delivers a tappable URL to the phone with zero app infrastructure. Interactive Slack would require an app + interactivity callback endpoint. |
| Single user | No accounts, no multi-tenancy provisions unless they are free. |
| TypeScript Worker, server-rendered UI, no frontend framework | App is small enough that a framework adds build/dependency complexity without UX benefit. |

## 3. Requirements

Each requirement states *what* must be true and a fit criterion that makes it
pass/fail testable. How it is achieved is §4.

### Functional

- **F1 — Scheduled prompting.** Exactly one prompt is generated per
  configured window per day, at a semi-random time within the window.
  *Fit:* over any 7-day run, prompts-per-window-per-day = 1; no prompt
  outside 08:00–20:00 Europe/London; send times within a window are not
  constant day to day.
- **F2 — Idempotent scheduling.** Re-running the scheduled handler within
  the same interval must not duplicate work.
  *Fit:* a test invoking the handler N times in one 15-minute tick produces
  at most one prompt row and one notification send.
- **F3 — Check-in capture.** The check-in page offers the feeling as
  one-tap choices (default vocabulary: good, calm, happy, low, anxious,
  stressed, irritable, tired) plus a free-text field, then intensity as
  ten explicit buttons (1–10, no slider), and auto-submits once both are
  chosen, ending on a minimal "Recorded." screen.
  *Fit:* from notification tap to "Recorded." in ≤ 3 taps for a
  quick-select feeling; the whole flow fits one mobile screen, one-handed;
  a normal check-in completes in under ~10 seconds.
- **F4 — Persistence.** Every completed check-in is stored in D1, linked to
  its prompt, with `observed_at` and `submitted_at` recorded separately.
  *Fit:* a response row exists with `intensity` in 1..10 and a valid
  prompt reference.
- **F5 — Missed prompts.** An unanswered prompt transitions to
  `expired`; no synthetic response is ever created.
  *Fit:* after expiry, prompt status is `expired` and the response table
  has no row for it — "no observation" is distinguishable from any real
  observation.
- **F6 — Retrieval.** An authenticated endpoint returns responses as JSON,
  filterable by time range.
  *Fit:* `GET /api/responses?from=&to=` with a bearer token loads into
  pandas with a single `read_json` call; requests without the token get 401.

### Operational (first-class, not afterthoughts)

- **N1 — Unguessable, expiring response links.** Check-in URLs carry a
  cryptographically random ≥256-bit opaque token bound to exactly one
  prompt, expiring 16 hours after the prompt is sent. Prompt IDs never
  grant access and never appear in URLs.
  *Fit:* expired or unknown tokens get a terse 4xx that leaks nothing;
  tokens contain no user data.
- **N2 — Secrets stay server-side.** Pushover credentials and the export
  bearer token exist only as Worker secrets.
  *Fit:* no secret or response token ever appears in config files, logs,
  or client-delivered content.
- **N3 — DST correctness.** The schedule is defined in Europe/London local
  time; GMT/BST transitions must not shift it.
  *Fit:* unit tests pin the scheduler's behaviour across the March and
  October transition dates.
- **N4 — Observability, proportionate.** Log scheduler runs, prompt
  creation, notification success/failure, response accepted/rejected.
  Never log tokens, secrets, or (outside structured export) feeling values.
  `/health` confirms the Worker is serving. D1 failures and Pushover
  failures are separately distinguishable in logs.
- **N5 — Delivery failure containment.** A failed Pushover send marks the
  prompt `failed` and is visible in logs; it does not crash the scheduler
  or block later windows.

### Configuration (deliberately minimal)

The only values changeable without a code edit are the **schedule windows**
and **timezone** (deploy-time vars) — this preserves the proposal's
"3 or 4 check-ins per day, configurable without code changes". Everything
else the proposal made configurable (feelings vocabulary, expiry hours,
notification provider, Loki toggle) becomes a named constant in code: for a
single-user app a one-line edit plus deploy *is* the configuration UI, and
each avoided parameter is a decision the module resolves instead of
exporting.

## 4. Design decisions

Triage by reversibility: most choices here are two-way doors — decided
quickly, cheap to change later. Two are effectively one-way and got the
scrutiny:

**One-way doors (data and security outlive the code):**

- **D1 — Schema.** Adopt the proposal's two tables, with the intensity
  check inline:

  ```sql
  CREATE TABLE checkin_prompt (
      id                TEXT PRIMARY KEY,
      scheduled_for     TEXT NOT NULL,
      sent_at           TEXT,
      expires_at        TEXT,
      response_token    TEXT NOT NULL UNIQUE,
      notification_id   TEXT,
      status            TEXT NOT NULL,   -- scheduled|sent|answered|expired|failed
      created_at        TEXT NOT NULL
  );

  CREATE TABLE checkin_response (
      id                TEXT PRIMARY KEY,
      prompt_id         TEXT REFERENCES checkin_prompt(id),
      feeling           TEXT NOT NULL,
      intensity         INTEGER NOT NULL CHECK (intensity >= 1 AND intensity <= 10),
      observed_at       TEXT NOT NULL,
      submitted_at      TEXT NOT NULL
  );
  ```

  The `observed_at`/`submitted_at` split and nullable `prompt_id` are kept
  *now* precisely because they are what lets manual and backdated entries
  arrive later without a migration. Evolution rule: future needs (note,
  energy, tags, …) are added as **optional columns with defaults only**;
  column meanings are never repurposed.

- **D2 — Token model.** One opaque token is both the identifier and the
  credential: routes are `GET/POST /c/:token`, not `/c/:prompt_id?token=`.
  There is then no unauthenticated identifier to leak or enumerate, and no
  way to mis-handle the pair. Re-submission against a still-valid token
  overwrites the previous answer (last write wins) — that is the "Edit"
  affordance, free of extra UI.

**Two-way doors (decide fast, keep reversible):**

- **D3 — Notifier port.** Pushover sits behind a minimal `Notifier`
  interface. This is the one interface the MVP earns: it wraps an
  unmanaged out-of-process dependency, enabling tests without live sends
  and a Slack adapter later. No other single-implementation interfaces —
  D1 access is concrete.
- **D4 — Humble entry points.** `scheduled()` and `fetch()` are thin glue;
  scheduling, token, and response logic live in plain functions with the
  clock injected as a value. N3's DST tests are only possible this way.
- **D5 — Single write path.** All response persistence goes through one
  `recordResponse()` service function. That is the seam where a secondary
  sink (Loki) attaches later as a best-effort call, without touching
  callers.
- **D6 — Windows-only scheduling.** One schedule mode. Fixed times were a
  second mode serving the same need; if ever wanted, a zero-width window
  degenerates to a fixed time.

## 5. MVP acceptance criteria

The MVP is complete when:

- [ ] Runs entirely on Cloudflare's serverless platform (Worker, Cron, D1).
- [ ] Cron fires every 15 minutes; the Worker decides in Europe/London
      local time whether a prompt is due (F1, N3).
- [ ] Duplicate scheduler invocations cannot duplicate prompts (F2).
- [ ] A Pushover notification arrives with a supplementary URL; tapping it
      opens the check-in directly, with no login (N1).
- [ ] Feeling + intensity captured in ≤ 3 taps, auto-submit, "Recorded."
      (F3).
- [ ] Responses persisted in D1; missed prompts expire without synthetic
      data (F4, F5).
- [ ] Response links are unguessable and expire after 16 h (N1).
- [ ] JSON export works with a bearer token (F6).
- [ ] All credentials are Worker secrets (N2).
- [ ] Logs cover the N4 event list and exclude the N4 forbidden list.

**Live validation gate (pre-committed, before any data exists):** after 14
consecutive days of real use — ≥ 75 % of sent prompts answered, zero
duplicate prompts, zero schedule drift. If the answer rate is below 50 %,
that is a friction failure: revisit the check-in UX before building *any*
new feature. Thresholds are fixed now so the result can't be rationalised
after the fact.

## 6. Delivery order

Thin vertical slices, each shippable:

1. **M0 — Skeleton.** Wrangler project, D1 migration, `/health`, deploy.
2. **M1 — The loop.** Cron → scheduler (idempotent, DST-safe) → prompt +
   token → Pushover → check-in page → response persisted → expiry sweep.
   *This slice alone is the measurement instrument.*
3. **M2 — Retrieval.** Bearer-token JSON export.

MVP = M0 + M1 + M2 against §5.

## 7. Deferred — cut from MVP, held open by design

Each cut is a two-way door: the listed re-entry point is what keeps it cheap
to add later, which is exactly why it need not be built now.

| Item | Why not now | Re-entry point |
| --- | --- | --- |
| Manual entry (`/checkin`) | Drags browser-session admin auth into the MVP; the scheduled loop doesn't need it | Nullable `prompt_id` + `observed_at` split (D1) already model it |
| Loki secondary sink | Second external dependency and failure mode, zero added measurement value; export already feeds Grafana/pandas | `recordResponse()` seam (D5) |
| CSV export | JSON satisfies every listed consumer | Content negotiation on the existing endpoint |
| Slack notifications | Proposal already rejects for MVP | `Notifier` port (D3) |
| Fixed-times schedule mode | Duplicate mechanism for the same need | Zero-width windows (D6) |
| Configurable feelings vocabulary | Config parameter with a single user on the other end | One constant, one deploy |
| Recency-promoted quick feelings | UX optimisation with no usage data yet | Response history is already in D1 |
| Gentle retry on missed prompt | Proposal keeps it off by default; off = absent | Scheduler owns window state; add there |
| Extra observation fields (note, energy, tags, …) | Slows the critical path | Additive optional columns (D1 evolution rule) |

Everything under "Out of Scope" in issue #1 §17 (multi-user, dashboards,
interpretation, native apps, OAuth on the check-in path, emotion taxonomies,
escalation) remains out, unchanged.
