# Check-in page redesign — feelings wheel

Design proposal for [#12 evolving the interface](https://github.com/xchewtoyx/checkin/issues/12).

An interactive mockup of everything described here lives at
[`docs/mockups/checkin-page-redesign.html`](mockups/checkin-page-redesign.html) —
open it in a browser (it is fully self-contained).

## Goals (from #12, revised after discussion)

1. Lean on the **feelings wheel** as a visual aid.
2. **Wheel colors** as button backgrounds.
3. Vocabulary constrained to **wheel words** — no free-text feeling entry
   (free text lives only in the note).
4. **12 options: a random 2 from each of the six sectors**, redrawn per
   prompt.

Deliberately **no** frequency-based personalization and **no** search box:
the tool's job is to get signal through alexithymia, and surfacing "your
usual answers" first would create a feedback loop toward habitual labels —
flattening exactly the signal we're after. Instead, every prompt offers a
fresh, sector-balanced spread; you scan it and pick the word you most
resonate with, drilling into the wheel when none quite fit.

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
comparable.

**No schema change.** `checkin_response.feeling` stays a plain string; the
export endpoint is untouched. Sector/tier can always be re-derived from the
word at analysis time.

### 2. Layout: wheel → chips → intensity

Single compact column, mobile-first (the page is opened from a Pushover
tap) — the goal is everything visible on one phone screen with little or no
scrolling:

1. **Header** — "How are you?" plus the check-in window ("Thursday afternoon").
2. **Mini wheel (the visual aid)** — a tappable six-wedge donut SVG,
   generated from the sector data at render time. Tapping a wedge drills
   into that sector: the chip area shows all of that sector's middle- and
   outer-ring words, tinted in the sector hue. The wheel center acts as
   back/reset. This gives the full ~114-word vocabulary two taps away
   without a giant grid — it replaces both free text and search.
3. **Chip grid** — 12 colored chips, see §3.
4. **Optional note** — unchanged single field (still concatenated
   server-side; splitting it into its own column is out of scope here).
5. **Intensity 1–10** — activates once a feeling is chosen and tints itself
   with the chosen sector's hue in a rising gradient, so "how strong" reads
   visually. Tapping intensity submits, as today.

Selection has visible state: the chosen chip highlights in its sector color
and can be re-tapped/changed any time before intensity is picked. The
confirmation screen echoes the word in its sector color with an "undo"
available while the token is still valid (re-submits overwrite via the
existing `upsertResponse` upsert, so undo/edit is already free server-side).

### 3. Chip grid: 2 per sector, seeded per prompt

Twelve chips: **two words drawn from each of the six sectors**, grouped in
wheel order so the grid scans like the wheel. Balanced-by-construction
sampling means every affect family is always represented — the spread never
skews all-negative or all-positive, so it neither leads the answer nor
biases the recorded data.

The draw is **deterministically seeded from the prompt token**: each prompt
gets a fresh spread (variety across the day), but reloading the page never
reshuffles the options mid-decision, and an expired-then-revisited link
shows the same grid it originally did. Implementation is a small
`seededSample(token)` — hash the token, use it to pick 2 of the ~6 middle
ring words per sector (whether outer-ring words join the draw pool is an
open question, §"Open questions").

Chips are tinted with their sector hue (soft fill + colored text on the
neutral ground; solid fill when selected). Color is reinforcement, not the
only signal — the word is always printed.

### 4. Visual language

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
| **M1** | Wheel dataset, token-seeded 2-per-sector chip grid, intensity tinting, selected/changeable state, styled expired page | `feelings-wheel.ts` (new), `checkin-page.ts`, `config.ts` |
| **M2** | Tappable SVG wheel drill-down | `checkin-page.ts` |

`renderCheckinPage(prompt, now)` keeps its signature — the seed comes from
`prompt.response_token`, which it already has. No new queries, no schema
changes; existing tests keep passing.

## Open questions

1. **Which wheel exactly?** The attachment in #12 needs transcribing —
   Willcox (6 cores) and the Roberts emotion wheel (7 cores) differ. The
   design is agnostic; only the data file changes.
2. **Draw pool:** sample the 12 chips from the middle ring only (outer ring
   reachable via drill-down), or let outer-ring words appear in the grid
   too? Middle-only keeps the grid's abstraction level even; including
   outer words surfaces more precise vocabulary unprompted.
3. Should the note ever move to its own column so recorded feelings stay
   clean wheel words? (The `feeling: note` concatenation makes
   sector-level analysis of exports slightly fiddlier.)
