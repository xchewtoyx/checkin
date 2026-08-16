# Check-in ladder — progressive disclosure + response schema evolution

Design proposal for [#32 — progressive-disclosure check-in ladder](https://github.com/xchewtoyx/checkin/issues/32),
folding in [#27 — note in its own column](https://github.com/xchewtoyx/checkin/issues/27).

An interactive mockup of the ladder interaction lives at
[`docs/mockups/checkin-ladder.html`](mockups/checkin-ladder.html) — open it in a
browser (fully self-contained, embeds the real 258-word taxonomy from
`src/feelings-wheel.ts`). The chip-metrics evidence behind §4's fit decision
lives at [`docs/mockups/checkin-ladder-fit-check.html`](mockups/checkin-ladder-fit-check.html).

## Why #27 rides along

#32 and #27 are deliberately separate requirements — #32 says so explicitly
("Independent of: #27"), and nothing here changes that: each issue's
acceptance criteria stays independently verifiable, and either could ship
without the other. What they share is the *implementation seam* —
`recordResponse()`, the `checkin_response` table, `/api/responses`, and the
R2 extract all get touched by both. That's a [two-way-door decision about
build order](https://github.com/xchewtoyx/rgh-sme/blob/main/decision-alignment/reversibility-as-decision-criterion.md),
not a requirements merge — see [requirement vs. design
decision](https://github.com/xchewtoyx/rgh-sme/blob/main/requirements-architecture/requirement-vs-design-decision.md):
one migration adding two additive nullable columns, one pass through the
same handful of files, instead of two migrations landing on the same table a
day apart. If it turns out to be wrong, splitting back into two PRs later
costs nothing — no data or API shape depends on them having shipped together.

## 1. Current state

- **Vocabulary offering:** `sampleFeelings(token)` in `src/feelings-wheel.ts`
  draws 2 words per sector (12 chips total), FNV-1a/mulberry32-seeded from
  the prompt token. `renderCheckinPage` renders them as a single flat
  `.chips` row that wraps.
- **Submission:** tapping a chip selects it, tapping an intensity 1–10
  button auto-submits `{ feeling, intensity, note }` to `POST /c/:token`.
- **Note handling:** `recordResponse()` concatenates the note into the
  stored `feeling` string (`"anxious: before the meeting"`) — see
  `src/record-response.ts:47-49`. `checkin_response.feeling` is the only
  place a note is ever persisted.
- **Schema:** `checkin_response(id, prompt_id, feeling, intensity,
  observed_at, submitted_at)` — no `note`, no `confidence` column
  (`migrations/0001_init.sql`).
- **Taxonomy:** already the full 6×6×6, 258-word structure since #31/#34 —
  `WHEEL: WheelSector[]`, each sector `{ core, hue, valence, feelings:
  [{ word, finer: string[6] }] }`. This shape is already exactly what a
  three-row ladder needs (core → 6 middles → 6 outers); no data
  restructuring required, only a new consumer of it.

## 2. What's changing

From #32:
- Replace the sampled 12-chip grid with three progressively revealed rows
  of 6 (cores → middles → outers), tinted by the selected core's hue.
- A final-row pick is never required; the deepest tapped word is what gets
  submitted, at 2, 4, or 6 taps deep (see §6).
- Re-tapping a higher row clears and re-populates everything below it.
- Add an optional weak/strong **confidence** toggle that never blocks
  submission and defaults to unset.
- Retire `sampleFeelings` and its seeding machinery — the anti-habituation
  rationale that motivated sampling is superseded by the stable taxonomy
  itself (recorded in #32 already; not re-argued here).

From #27:
- Stop concatenating the note into `feeling`; store it in its own nullable
  `note` column. **Check-in page UX is unchanged** — the note `<input>`
  already posts as a separate `note` field; only server-side handling
  changes.

## 3. Data layer

### 3.1 `src/feelings-wheel.ts`

- Delete `sampleFeelings`, `fnv1a`, `mulberry32`, and the `SampledFeeling`
  type — nothing else in the codebase depends on them once
  `checkin-page.ts` stops calling `sampleFeelings`.
- Keep `WHEEL`, `WheelSector`, `WheelFeeling`, `Valence`, `LABEL_BUDGET`
  untouched — this file is #31's territory and stays a pure data module.
- No new exports needed: the client-side ladder script (§5) consumes
  `WHEEL` directly once it's serialized into the page, and the server never
  needs to look inside it beyond what it already renders (row 1).

### 3.2 Migration — `migrations/0002_response_note_and_confidence.sql`

```sql
ALTER TABLE checkin_response ADD COLUMN note TEXT;
ALTER TABLE checkin_response ADD COLUMN confidence TEXT
  CHECK (confidence IS NULL OR confidence IN ('weak', 'strong'));
```

Both columns are nullable with no explicit default (SQLite defaults new
columns to `NULL`, which the `confidence` CHECK explicitly allows) — additive
per the #1 §4 D1 evolution rule cited by both issues. Existing rows are
untouched; `note` stays `NULL` for them (their qualifier text, if any,
remains embedded in `feeling` — see §4 of `docs/analytics-extract.md` update
below for the legacy-row parsing rule).

**Test harness note:** `test/setup.ts` hand-maintains a `CREATE TABLE`
mirror of the migrations (there's no `applyD1Migrations` wiring in
`vitest.config.ts`, so `migrations/*.sql` isn't applied to the test DB
automatically). Both new columns need adding there too, or the whole test
suite runs against a schema one migration behind. Easy to miss — call it
out explicitly in the PR checklist.

### 3.3 `src/store.ts`

- `ResponseRow`: add `note: string | null` and `confidence: string | null`.
  `ExportedResponseRow` is a type alias of `ResponseRow`, so it picks both
  up automatically.
- `upsertResponse()`: extend the `INSERT ... ON CONFLICT` column list and
  bindings with `note` and `confidence` (insert and the `DO UPDATE SET`
  clause both need it, so re-submission — "Change answer" — updates them
  too).
- `listResponses()` and `listAllResponsesForExport()`: add `note,
  confidence` to their `SELECT` column lists. This is the one place a typo
  would silently keep the columns out of both `/api/responses` and the R2
  extract, so it's worth a dedicated test per query (§7).

### 3.4 `src/record-response.ts`

- `RecordResponseInput`: add `confidence?: "weak" | "strong"`.
- Remove the concatenation:
  ```ts
  const feeling = input.note?.trim()
    ? `${input.feeling}: ${input.note.trim()}`
    : input.feeling;
  ```
  replaced by passing `feeling: input.feeling` and `note: input.note?.trim()
  || null` straight through to `upsertResponse`.
- Validate `confidence`: if present, must be exactly `"weak"` or
  `"strong"`; anything else is `{ ok: false, reason: "invalid" }`, same
  pattern as the existing intensity-range check. Absent/`undefined` stays
  `null` — confidence is opt-in, never inferred.
- No change to the taxonomy-membership question: the server still doesn't
  validate that `feeling` is a real wheel word (it doesn't today either).
  Given the ladder only ever *offers* real wheel words, this is low-risk to
  leave as is; flagged as an open question in §8 rather than folded into
  scope here.

### 3.5 `src/index.ts`

- `handleCheckinToken`'s POST payload type gains `confidence?: string`,
  forwarded into `recordResponse()` unchanged (validation lives in
  `record-response.ts`, not the handler, matching the existing intensity
  pattern).

### 3.6 `src/export.ts`

- `serializeResponses()`: add `note: row.note` and `confidence:
  row.confidence` to the mapped object. This is the `/api/responses` bearer
  endpoint — both new columns flow through it as soon as `store.ts`'s
  `SELECT` carries them.

### 3.7 Analytics extract & docs

- `src/analytics-extract.ts` needs **no code change** — it already calls
  `listAllResponsesForExport()` and serializes whatever `ExportedResponseRow`
  contains, so `note`/`confidence` appear in the next R2 snapshot for free
  once §3.3 lands. This is exactly the additive-schema-evolution property
  #14 §4 promises.
- `docs/analytics-extract.md` data contract update:
  - Note the two new columns under "Schema evolution" as a worked instance
    of the additive rule, with the run they first appear in.
  - Record the **cutover date**: from this change forward, `feeling` is
    always a bare wheel word (or free text pre-#31... no — bare taxonomy
    word); `note` carries the qualifier separately. Rows recorded before
    cutover keep the legacy `"word: note"` concatenation in `feeling` with
    `note = NULL`.
  - Document the legacy parsing rule for downstream consumers (mirrors
    #27's acceptance criteria): split `feeling` on the first `": "`; before
    cutover this yields `(word, qualifier)`, from cutover it's a no-op
    (`note` is already separate). This is the note [checkin-analytics#1
    needs](https://github.com/xchewtoyx/checkin/issues/27) to update its
    qualifier-parsing transform — flag it there, not fixed here (different
    repo, not in this session's scope).
  - `docs/analytics-consumer.md` likely doesn't need changes (it documents
    the *hookup*, not the row schema) — worth a quick check when
    implementing, not a proposed edit here.

## 4. Chip metrics — a measured fit decision, not a guess

#32's acceptance criteria ask for the chip-sizing decision to be *recorded*,
with the two-line/3-chip fallback as an explicit option if honest sizing at
six-per-row can't fit the label budget. Rather than eyeball it,
[`docs/mockups/checkin-ladder-fit-check.html`](mockups/checkin-ladder-fit-check.html)
renders the actual taxonomy's worst-case labels (the 12-char ceiling
`LABEL_BUDGET` already asserts: `Disappointed`, `Lighthearted`,
`Accomplished`, `Underwhelmed`, `Affectionate`, `Switched off`) at 320/360/390px
viewport widths, in three variants: today's chip CSS, a tightened variant,
and a forced 3-column grid.

**Findings, screenshotted at 320/360/390px:**
- Today's chip CSS (`0.95rem` font, `0.5rem 0.8rem` padding) wraps this
  worst-case row to 3 lines of 2 — usable, but tall: three ladder rows at
  that height push the page well past one phone screen.
- A tightened chip style (`0.85rem` font, `0.4rem 0.55rem` padding) *still*
  wraps organically to 3×2, because flex-wrap packs by content width, not
  by a target column count.
- A **forced 3-column grid** (`grid-template-columns: repeat(3, 1fr)`) with
  the tightened style fits every worst-case label on one line, no internal
  wrapping, down to 320px — the narrowest phone width worth supporting.

**Decision:** the ladder's three rows use a 3-column grid
(`.chips { display: grid; grid-template-columns: repeat(3, 1fr); gap:
0.4rem; }`) with the tightened chip padding/font, not `flex-wrap`. This is
exactly the "two 3-chip lines per level" fallback #32 anticipated — recorded
here as the actual layout, not a fallback held in reserve, because organic
wrap already fails to beat it at the taxonomy's real worst case. Row height:
3 rows × 2 lines × 44px min-height + gaps ≈ unchanged from today's 12-chip
grid, which already wrapped to multiple lines — so the "one phone screen"
NFR is not worse than the shipped baseline, though it should still be
checked against the full assembled page (header + 3 rows + note +
confidence + intensity) once built, per #32's own estimate caveat.

## 5. Interaction layer — `src/checkin-page.ts`

### Markup

Three `<section>`s, each with a `.group-label` hint and a `.chips` grid
(`id="chips-0"`/`1`/`2`), rows 2 and 3 hidden (`class="ladder-row"` with a
`.visible` modifier) until populated — mirrors the existing
`form-chips`/`form-note`/`form-intensity` hide/show pattern used by
`setRecorded()`. Row 1 is server-rendered with all 6 cores (no client JS
needed to see the first tap); rows 2–3 are populated by client script from
embedded data, since progressive reveal must not round-trip to the server
(#32's "no new queries" constraint, same as today).

The full `WHEEL` array (or a trimmed projection — just `core`, `hue`,
`feelings[].word`, `feelings[].finer`; `valence` isn't needed client-side)
is serialized as a `<script>` JSON literal in the page, the same way the
page is already a single self-contained Worker response. Rough size: 258
words average ~8 chars plus structure ≈ 3–4 KB — negligible next to the
existing inline `<style>` block.

Add a confidence toggle section: two buttons (`weak`/`strong`), `aria-pressed`
state, tap-to-toggle-off (matches the existing chip re-tap-to-deselect
pattern), never disabled, never required.

### Script logic

Replace the current single `feeling` variable with a 3-slot `depth` array
(`[core, middle, outer]`) and a parallel hue array:

- **Row 0 click** → set `depth[0]`, clear `depth[1]`/`depth[2]` and their
  rendered rows, render row 1 from `sector.feelings.map(f => f.word)`
  tinted `sector.hue`, reveal it.
- **Row 1 click** → set `depth[1]`, clear `depth[2]`/its row, render row 2
  from the matching `feeling.finer`, reveal it.
- **Row 2 click** → set `depth[2]`; nothing deeper to clear.
- Re-tapping a *different* chip within the same row re-runs that row's
  handler, which already clears everything below — satisfies "no stale deep
  word can be submitted under a changed parent" directly, since the DOM for
  deeper rows is destroyed, not just hidden.
- `deepestWord()` = `depth[2] ?? depth[1] ?? depth[0]` — this is what feeds
  the intensity hint and the POST body, so a 2-tap (core + intensity),
  4-tap (core + middle + intensity), or 6-tap (core + middle + outer +
  intensity) submission all work through the same path. Confidence, if set,
  adds one tap anywhere before intensity without being on that path.
- Intensity activation/tinting logic is unchanged in shape — it already
  keys off "is a feeling selected", just now reading `deepestWord()`
  instead of the single `feeling` variable.
- POST body becomes `{ feeling: deepestWord(), intensity, note, confidence
  }` (confidence omitted or `null` when unset).
- `setRecorded()` grows one more id to the hide/show list per new row
  section, otherwise unchanged; "Change answer" still just un-hides the
  form with prior selections intact (existing behavior, not proposed to
  change).

### Copy

Per-row hints follow the issue's own framing ("what feels closest? now
narrow it. now narrow again") kept to a few words each — consistent with
[minimize extraneous cognitive
load](https://github.com/xchewtoyx/rgh-sme/blob/main/data-visualization/minimize-extraneous-cognitive-load.md):
the hint is signal about *what to do*, not decoration, and adding more than
a few words per row risks becoming the clutter that discipline warns
against. The mockup uses: row 1 "what feels closest?", row 2 "narrow it
down", row 3 "narrower still (optional)" — the "(optional)" on row 3 is
worth keeping since it's the one row where the acceptance criterion
("final-row choice is not required") is easy to misread as required just
from the row existing.

## 6. Taps and screen-height check (against #32's fit criteria)

| Path | Taps | Notes |
|---|---|---|
| Core + intensity | 2 | Matches "minimum complete check-in is 2 taps then auto-submit" |
| Core + middle + intensity | 3 | |
| Core + middle + outer + intensity | 4 | |
| ...+ confidence anywhere before submit | +1 | Full depth + confidence = 5 taps, matches the "≤ 5 taps" criterion |

All 258 words reachable in ≤ 3 selection taps (core, middle, outer) plus the
submitting intensity tap — satisfies "≤ 3 taps" read as taxonomy-navigation
taps, consistent with how #32 phrases the acceptance criterion.

## 7. Tests

New/updated, by file:

- **`test/feelings-wheel.spec.ts`**
  - Remove the `sampleFeelings` describe block and its two tests (function
    deleted).
  - Replace the "renders the token-seeded 12-chip grid" test with: row 1
    renders exactly the 6 cores server-side (`data-word` for each
    `WHEEL[i].core`, tinted `WHEEL[i].hue`); rows 2/3 are present in markup
    but empty/hidden pre-JS; the full `WHEEL` data is embedded in the page
    (e.g. assert the script tag contains every core name).
  - Keep the taxonomy-structure tests (6×6×6, uniqueness, label budget,
    sector metadata) — untouched, still #31's territory.
- **New: a client-behavior test** for reveal/reset. Given this is inline
  vanilla JS in a server-rendered string (no DOM testing harness currently
  wired for `checkin-page.ts`'s script), the pragmatic option is a
  Playwright/jsdom smoke test exercising the rendered HTML string in a real
  DOM (`happy-dom`/`jsdom` via vitest, or a small Playwright spec) covering:
  tap core → row 2 appears with that core's 6 middles; tap a different
  core → row 2's contents change and row 3 (if open) closes; tap deep, then
  tap a different row-0 chip → deepest selection clears. This is new test
  infrastructure for the repo (currently `cloudflare:test`/`SELF.fetch`
  only) — flagged as the one piece of this proposal that isn't a
  same-shape extension of an existing pattern; worth confirming the
  approach before building it.
- **`test/analytics-extract.spec.ts` / `test/analytics-extract-verify.spec.ts`**
  — extend fixture rows with `note`/`confidence` values (including `NULL`)
  and assert both keys appear in the exported JSONL with the right values.
- **`test/export.spec.ts`** — `serializeResponses` round-trip for
  `note`/`confidence` present and `null`.
- **`test/export-api.spec.ts`** — extend the existing insert-then-fetch
  test to include `note`/`confidence` columns in the `INSERT` and assert
  them in the JSON response; add a legacy-row case (`note = NULL`,
  `feeling = "anxious: before the meeting"`) asserting it exports
  byte-for-byte unchanged (#27's "legacy-row export unchanged" criterion).
- **A `record-response` test** (new file, `test/record-response.spec.ts` —
  there isn't one today) covering: note stored separately, not
  concatenated; confidence `weak`/`strong`/absent all round-trip through
  `upsertResponse`; an invalid confidence value is rejected the same way an
  out-of-range intensity is.
- **`test/setup.ts`** — add `note`/`confidence` columns to the mirrored
  `CREATE TABLE`, per §3.2's note.

## 8. Open questions

1. **Client-DOM test harness.** As above — do we add `happy-dom`/`jsdom` to
   vitest, or a lightweight Playwright spec, or accept coverage at the
   "row 1 renders correctly + reveal logic reviewed by hand" level for this
   round? The repo has no precedent either way.
2. **Server-side taxonomy validation.** Should `recordResponse()` reject a
   `feeling` that isn't a real `WHEEL` word, now that the client only ever
   offers real words? Today it accepts anything (untouched by this
   proposal); tightening it is a small, separate, low-risk follow-up if
   wanted — not folded in here since neither #32 nor #27 asks for it.
3. **`checkin-analytics#1` cutover coordination.** #27 explicitly asks for
   the downstream consumer to be notified of the cutover date and update
   its qualifier-parsing transform. That's a cross-repo action item, not
   something this proposal can complete — flagged for whoever picks up
   implementation to action against `xchewtoyx/checkin-analytics`.
4. **Reduced page height vs. baseline.** §4's grid keeps ladder-row height
   in line with today's wrapped 12-chip grid, but three rows plus note plus
   confidence plus intensity is more vertical content than today's single
   chip section. Worth an explicit one-phone-screen check against the
   assembled page once built, per #32's own "estimated" caveat on that
   acceptance criterion.

## 9. Suggested delivery order

1. **Schema + storage** (§3.2–3.4, §3.6): migration, `store.ts`,
   `record-response.ts`, `index.ts`, `export.ts` — testable in isolation
   against the existing chip UI, zero UI risk.
2. **Docs** (§3.7): `docs/analytics-extract.md` cutover note — cheap, and
   unblocks flagging the cross-repo item in open question 3 early.
3. **Ladder UI** (§4–§5): retire `sampleFeelings`, build the three-row
   markup/script, chip-metrics CSS — the highest-risk, most-visible slice,
   sequenced last so it lands on top of an already-settled data layer.
4. **Tests** (§7) land alongside each slice above, not as a final pass.
