# Check-in page redesign — feelings wheel

Design proposal for [#12 evolving the interface](https://github.com/xchewtoyx/checkin/issues/12).

An interactive mockup of everything described here lives at
[`docs/mockups/checkin-page-redesign.html`](mockups/checkin-page-redesign.html) —
open it in a browser (it is fully self-contained).

## Goals (from #12)

1. Lean on the **feelings wheel** as a visual aid.
2. **Autocomplete from wheel vocabulary** instead of free text.
3. **Wheel colors** as button backgrounds.
4. More than a static 8 buttons: **top 4 (personal) + 8 sampled** from the wheel.

## Current state

`renderCheckinPage` emits a static page: 8 hard-coded feelings from
`FEELINGS` in `src/config.ts`, a free-text note, and a 1–10 intensity grid.
Picking a feeling and an intensity auto-submits. There is no selected state,
no way to change your mind, no color, and the vocabulary is fixed.

## Proposed design

### 1. The wheel becomes data (`src/feelings-wheel.ts`)

Replace the flat `FEELINGS` list with a three-tier structure mirroring the
wheel: six **sectors** (core feelings), each with ~6 **middle-ring** words,
each with ~2 **outer-ring** words. Every sector carries a hue.

```ts
export interface WheelSector {
  core: string;          // "peaceful"
  hue: string;           // "#2ba193"
  feelings: { word: string; finer: string[] }[];
}
```

> **Placeholder warning:** the word list in this proposal and the mockup is a
> reasonable approximation of the Willcox feeling wheel. It should be
> transcribed verbatim from the wheel in the photo attached to #12 before
> implementation — the structure is built so this is purely a data edit.

Proposed starter sectors and hues (tuned for contrast on light and dark):

| Sector | Hue | Middle ring (placeholder) |
|---|---|---|
| peaceful | `#2ba193` teal | calm, content, relaxed, thoughtful, loving, trusting |
| joyful | `#d9a514` amber | happy, excited, playful, energetic, optimistic, grateful |
| powerful | `#4f9d55` green | confident, proud, courageous, valued, creative, successful |
| sad | `#4a6fdc` blue | low, lonely, tired, bored, guilty, ashamed |
| scared | `#e8871e` orange | anxious, stressed, insecure, confused, helpless, rejected |
| mad | `#d64550` red | irritable, angry, frustrated, hurt, resentful, critical |

Seven of the current eight `FEELINGS` (`calm, happy, low, anxious, stressed,
irritable, tired`) survive verbatim as wheel words, so historical data stays
comparable. `good` is kept as an autocomplete alias for `content`.

**No schema change.** `checkin_response.feeling` stays a plain string; the
export endpoint is untouched. Sector/tier can always be re-derived from the
word at analysis time.

### 2. Layout: wheel → chips → intensity

Single column, mobile-first (the page is opened from a Pushover tap):

1. **Header** — "How are you?" plus the check-in window ("Thursday afternoon").
2. **Mini wheel (the visual aid)** — a tappable six-wedge donut SVG,
   generated from the sector data at render time. Tapping a wedge drills
   into that sector: the chip area shows all of that sector's middle- and
   outer-ring words, tinted in the sector hue. The wheel center acts as
   back/reset. This gives the full ~114-word vocabulary two taps away
   without a giant grid.
3. **Chip grid (default view)** — 12 colored chips, see §3.
4. **Search box** — typeahead over the whole wheel vocabulary, see §4.
5. **Optional note** — unchanged single field (still concatenated
   server-side; splitting it into its own column is out of scope here).
6. **Intensity 1–10** — activates once a feeling is chosen and tints itself
   with the chosen sector's hue in a rising gradient, so "how strong" reads
   visually. Tapping intensity submits, as today.

Selection now has visible state: the chosen chip highlights in its sector
color and can be re-tapped/changed any time before intensity is picked. The
confirmation screen echoes the word in its sector color with an "undo"
available while the token is still valid (re-submits overwrite via the
existing `upsertResponse` upsert, so undo/edit is already free server-side).

### 3. Chip grid: top 4 + 8 sampled

* **Top 4 — yours.** The four most frequent feelings from
  `checkin_response` over the trailing 30 days. One new store helper:

  ```ts
  topFeelings(db, { limit: 4, sinceIso }): Promise<string[]>
  ```

  (`SELECT feeling, COUNT(*) … GROUP BY feeling ORDER BY COUNT(*) DESC` —
  note-concatenated rows are excluded by matching against wheel words.)
  Falls back to `calm, happy, low, tired` while history is thin.
* **8 sampled from the wheel.** Deterministically seeded from the prompt
  token, so a reload does not reshuffle the grid mid-decision. Sampling is
  **stratified: at least one word per sector**, then the remaining two picks
  weighted toward the middle ring. Stratification matters for data quality —
  a purely random draw could serve an all-negative or all-positive grid and
  bias what gets reported.
* Chips are tinted with their sector hue (soft fill + colored text on the
  neutral ground; solid fill when selected). Color is reinforcement, not the
  only signal — the word is always printed.

### 4. Autocomplete replaces free-text feeling entry

A search input filters the full vocabulary (word + sector shown with a color
dot). The ~114 words inline into the page as JSON (~2 KB, no extra request —
the page stays a single dependency-free HTML response). Selection is
**constrained to wheel words**; free text lives only in the note field. The
server keeps accepting any string (the POST contract is unchanged), but the
UI only offers wheel words.

### 5. Visual language

* **Ground:** warm near-white `#faf9f7` / ink `#1f2328`; dark theme
  `#15171a` / `#e8eaed` via `prefers-color-scheme`. Sector hues are the only
  color — the page literally takes on the color of what you pick.
* **Type:** system stack (`ui-rounded, system-ui`) — honest for a page that
  must stay a single small Worker-rendered response; `tabular-nums` on the
  intensity row.
* Touch targets ≥ 44px, visible focus states, `prefers-reduced-motion`
  respected. The expired page gets the same styling instead of the bare
  "Link expired."

## Implementation plan

| Phase | Scope | Touches |
|---|---|---|
| **M1** | Wheel dataset, colored chip grid (static top-4 fallback), autocomplete, intensity tinting, styled expired page | `feelings-wheel.ts` (new), `checkin-page.ts`, `config.ts` |
| **M2** | Personal top-4 (`topFeelings` query), seeded stratified sampling | `store.ts`, `index.ts` (pass data into `renderCheckinPage`) |
| **M3** | Tappable SVG wheel drill-down | `checkin-page.ts` |

`renderCheckinPage(prompt, now)` grows an options argument
(`{ topFeelings: string[] }`) — existing tests keep passing with a default.

## Open questions

1. **Which wheel exactly?** The attachment in #12 needs transcribing —
   Willcox (6 cores) and the Roberts emotion wheel (7 cores) differ. The
   design is agnostic; only the data file changes.
2. Should the note ever be stored in its own column so autocomplete-picked
   feelings stay clean strings? (Currently `feeling: note` concatenation
   makes the top-4 query slightly fiddlier.)
3. Sampling weights: middle ring only, or include outer-ring words in the
   sampled 8?
