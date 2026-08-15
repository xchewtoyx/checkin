# Analytics Extract — Scope and Requirements

This file mirrors [#14 Data extract for analytics](https://github.com/xchewtoyx/checkin/issues/14).

Issue #14 is the authoritative requirements record for the analytics extract. It refines the original request (preserved in that issue's edit history), separating the *what* (§3) from the suggested *how* (§5) so each can be judged on its own terms. Update the issue first; keep this file in sync when scope changes materially.

## 1. Problem definition

- **Now (R1):** The only path out of D1 is the pull-based `GET /api/responses` bearer endpoint (F6 of #1). An analytics platform cannot consume that as a bulk import source; prompts — including expired ones — are not exported at all, so answer rate (the KPI the #1 §5 validation gate is defined on) cannot be computed downstream; and because responses are overwritten in place on re-submission, any state the platform fails to capture in time is unrecoverable from the source.
- **Desired (R2):** The analytics platform bulk-loads the full history of prompts and responses through its existing S3-compatible import mechanism, with no bespoke consumer code, and a transform bug discovered downstream weeks later never requires a re-extraction the source can no longer serve.
- **Question:** What is the smallest extract that achieves this on the existing platform?

The original request arrived solution-first ("cloudflare workflow dumps d1 to r2 as gzipped jsonl"). Parts of that sketch are genuine constraints — R2 as the delivery interface *is* what the consumer imports from — and parts are open design choices (the Workflow mechanism, the cadence). §2 and §5 sort them accordingly.

## 2. Mandated constraints

| Constraint | Rationale |
| --- | --- |
| Delivery via an R2 bucket consumable as an S3-compatible import source | This is the import mechanism the sole consumer (the analytics platform) already has; anything else requires custom ingestion code on the consumer side. |
| Export objects are immutable: a new export only ever creates new objects | Immutability is what makes the landing zone a permanent archive of extracts — the property that lets downstream transforms be re-run against landed data instead of re-hitting the source. It also makes partial-failure reasoning trivial: an object either exists completely or not at all. |
| Cloudflare free tier, no new external dependencies | Consistent with #1 §2. Volumes (≈1,100 prompts/year) are orders of magnitude below R2 free-tier limits. |

## 3. Requirements

**Grain, declared up front.** Two datasets, each at the atomic grain of one record per D1 row: `checkin_prompt` (the sampling event — expired and failed prompts are data, not noise: non-response is the denominator of answer rate) and `checkin_response` (the measurement). The extract never aggregates, filters, or reshapes toward any particular report; modeling happens downstream against the atomic grain.

### Functional

- **F1 — Complete snapshot per export.** Each export run writes a complete point-in-time snapshot of both tables (minus the F4 exclusions), not a delta.
  *Rationale:* both tables mutate in place — prompt `status` transitions, and re-submission upserts over the prior response — and neither carries a change-tracking column, so incremental extraction has nothing reliable to key on. At this volume a snapshot costs effectively nothing, while CDC machinery costs real complexity. Snapshots also make every export self-consistent: consuming the latest one requires no cross-file assembly.
  *Fit:* loading only the files of any single export reproduces `SELECT *` of both tables (excluding F4 columns) as they stood at extraction time.

- **F2 — Import-source compatibility.** Objects are gzipped JSONL — one JSON object per line, keys named exactly as the D1 columns, values as stored — laid out one table per prefix with a Hive-style partition key:

  ```
  raw/cloudflare/checkins/checkin_prompt/extraction_date=YYYY-MM-DD/HHMMSS.jsonl.gz
  raw/cloudflare/checkins/checkin_response/extraction_date=YYYY-MM-DD/HHMMSS.jsonl.gz
  ```

  Times are UTC. One table per prefix so the import maps prefix → schema without content sniffing. Gzipped JSONL is the right *staging* format at this volume; columnar conversion, if ever wanted, is a downstream concern.
  *Fit:* pointing the platform's S3 import at a table prefix loads every row with no custom parsing, and `extraction_date` is usable as a partition column.

- **F3 — Freshness.** Every completed check-in and every prompt state transition is reflected in some export within 24 hours.
  *Fit:* a response submitted at time T appears in an export whose extraction time is ≤ T + 24 h; same for a prompt reaching `expired`/`failed`/`answered`.

- **F4 — Credential and surplus-field exclusion.** `response_token` and `notification_id` never leave D1.
  *Rationale:* `response_token` is a live credential (N1 of #1) and `notification_id` is a delivery receipt; analytics needs neither, and a field that is never exported cannot leak downstream. This is the only permitted divergence from raw fidelity.
  *Fit:* no export object contains a `response_token` or `notification_id` key or value.

- **F5 — Idempotent, replay-safe runs.** Export runs are keyed to their scheduled slot: object names derive from the slot's scheduled time, not the wall clock. A retried or duplicated run for the same slot rewrites its own keys with a fresh snapshot and can never touch another slot's objects.
  *Fit:* invoking the export N times for one slot leaves exactly one file set for that slot, and the downstream import result is identical to a single invocation.

- **F6 — Audit tie-back.** Each run writes a manifest at `raw/cloudflare/checkins/manifests/extraction_date=YYYY-MM-DD/HHMMSS.json` recording the extraction timestamp and per-table row counts, and logs the same numbers.
  *Rationale:* the export gets a defensible claim of matching the source, and a discrepancy is localizable to extract-vs-import rather than "somewhere in the pipeline."
  *Fit:* manifest counts equal the line counts of the corresponding `.jsonl.gz` objects and D1 `COUNT(*)` at extraction time; a mismatch is detectable from the analytics side alone.

### Operational (first-class, per #1)

- **N1 — Loop isolation.** An export failure never blocks or delays prompting, response capture, or expiry sweeps.
  *Fit:* with R2 writes forced to fail, a scheduler tick still produces its prompt and processes responses; the export failure is logged and distinguishable from a D1 failure.
- **N2 — Consumer access is read-only and scoped.** The analytics platform reads via an R2 S3-API token scoped read-only to this bucket. The Worker writes through its R2 binding — no new Worker secrets.
  *Fit:* the consumer token can list/get under `raw/` but not put/delete; the Worker secret list is unchanged.
- **N3 — Absence is observable.** A missing export is detectable without reading logs: at least one manifest is expected per `extraction_date`, so the consumer side can alarm on silence. Export success/failure is additionally logged per run.
- **N4 — Proportionate cost, with a pre-committed revisit trigger.** Snapshot cadence and size sit far inside the free tier today. If a snapshot exceeds 5 MB gzipped, or an export run approaches Worker CPU limits, requirement F1's full-snapshot choice gets revisited (re-entry: §7, incremental export). The trigger is fixed now so growth can't be rationalised past it later.

## 4. Data contract

The consumer-facing summary — what the extract promises, and explicitly what it does not:

- **Promised:** complete point-in-time snapshots of both tables at the declared grain; the F2 layout; F3 freshness; F6 counts.
- **Not promised:** content cleansing — `feeling` strings carry free-text suffixes (`"anxious: before the meeting"`) verbatim; deduplication across snapshots — the consumer selects the latest file per table (or latest partition); a stable number of files per day.
- **Consumer:** the analytics platform import, owned by @xchewtoyx. This list is the record of who depends on the contract; additions go here.
- **Schema evolution:** additive only, mirroring #1's D1 evolution rule. A column added by migration appears in export objects from the next run; columns are never renamed or repurposed.

## 5. Design decisions

Triaged by reversibility, as in #1.

**One-way door:**

- **D1 — Snapshot semantics and object layout are the contract.** F1/F2 are what the consumer builds against; changing them reshapes the consumer. They got the scrutiny above; everything else below is cheap to change.

**Two-way doors:**

- **D2 — Mechanism: a gated step in the existing scheduled handler, not a Cloudflare Workflow.** The 15-minute cron already exists; the export fires when a tick crosses the export slot, guarded by the same idempotency pattern as prompt scheduling (F2 of #1). A whole snapshot fits comfortably in one invocation, so a Workflow would add a second execution surface, config, and failure domain for no current gain. This is the deliberately reversible reading of the original sketch: if the N4 trigger ever fires, a Workflow (or Queue-driven chunking) is the natural re-entry point for a multi-step incremental export.
- **D3 — ELT posture.** The extract performs no cleansing and no modeling — minimization (F4) and serialization only. All transformation happens in the analytics platform against landed raw data, so a transform bug is fixed by re-running downstream against R2, never by re-extracting D1.
- **D4 — Cadence: daily, one slot, as a named constant.** One export per day satisfies F3 with margin. The layout already accommodates multiple files per day, so moving to hourly is a one-line constant change plus deploy — configuration in the #1 sense (a code edit *is* the config UI).

## 6. Acceptance criteria

- [ ] The analytics platform's S3 import, pointed at the two table prefixes, loads all prompts and responses with no custom code (F2).
- [ ] A loaded snapshot matches D1 row-for-row on the exported columns (F1), and manifest counts tie back both to D1 and to the landed files (F6).
- [ ] No export object contains `response_token` or `notification_id` (F4).
- [ ] Re-running an export slot N times leaves one file set and an unchanged import result (F5).
- [ ] Existing objects are never modified or deleted by later runs (§2).
- [ ] With R2 failing, the check-in loop is provably unaffected in tests (N1).
- [ ] Consumer token verified read-only; no new Worker secrets (N2).
- [ ] A day with no export is detectable from the bucket alone (N3).

**Live validation gate (pre-committed):** after 7 consecutive days in production — 7 daily manifests per table, zero unexplained export failures, and analytics-side row counts matching D1 on inspection. Failure of the gate blocks building anything downstream of the extract.

## 7. Delivery order

1. **E1 — The extract.** R2 binding + bucket, snapshot writer, manifest, slot gating in the scheduled handler, loop-isolation and idempotency tests. *This slice alone satisfies every F requirement.*
2. **E2 — The consumer hookup.** Scoped read-only token, import-source configuration, tie-back verification, `docs/deploy.md` update. Mostly operations and documentation. See [`docs/analytics-consumer.md`](analytics-consumer.md) and `scripts/verify-analytics-extract.sh`.

## 8. Deferred — cut from this scope, held open by design

| Item | Why not now | Re-entry point |
| --- | --- | --- |
| Incremental / CDC export | No change-tracking column to key on; volume makes snapshots free | N4 trigger; add `updated_at` via additive migration, then delta exports |
| Response edit history | Source overwrites by design (D2 of #1); value of edit history unproven | Insert-only secondary write at the `recordResponse()` seam (D5 of #1) |
| Parquet / conformed zone | JSONL is the correct staging format at this volume; format conversion is a downstream job | Conform in the analytics platform from the raw zone |
| R2 lifecycle / storage tiering | Storage cost is negligible for years | R2 lifecycle rules on the `raw/` prefix |
| Machine-readable contract & multiple consumers | One consumer, one owner | §4 is the seed; formalize when a second consumer appears |

## Sources

The shape of this document follows the rgh-sme wikis: [requirement vs. design decision](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/requirement-vs-design-decision.md), [fit criterion](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/fit-criterion.md), [requirement rationale](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/requirement-rationale.md), [mandated constraint](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/mandated-constraint.md), [operational requirements as first-class](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/operational-requirements-as-first-class.md); [ETL vs. ELT](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/etl-vs-elt.md), [incremental vs. full extraction](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/incremental-vs-full-extraction.md), [extract archival for reprocessing](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/extract-archival-for-reprocessing.md), [idempotent and replayable jobs](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/idempotent-and-replayable-jobs.md), [file format selection](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/file-format-selection-for-pipelines.md), [data lake zone layering](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/data-lake-zone-layering.md), [audit statistics tie-back](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/audit-statistics-tie-back.md), [data contract](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/data-contract.md), [data minimization at ingestion](https://github.com/xchewtoyx/rgh-sme/blob/main/data-engineering/data-minimization-at-ingestion.md); [grain](https://github.com/xchewtoyx/rgh-sme/blob/main/dimensional-modelling/grain.md), [designing from reports antipattern](https://github.com/xchewtoyx/rgh-sme/blob/main/dimensional-modelling/designing-from-reports-antipattern.md).
