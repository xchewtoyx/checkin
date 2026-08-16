# Feelings vocabulary — eras and era mapping

The recorded `feeling` value is the bare word the user picked (free-text
suffixes like `"anxious: before the meeting"` are carried verbatim — see the
data contract in [`analytics-extract.md`](analytics-extract.md)). The word
alone is the `dim_feeling` lookup key downstream, so this note records every
vocabulary the instrument has offered and how older words map onto the
current taxonomy. The mapping is the conformance seed for `dim_feeling`
([checkin-analytics#1](https://github.com/xchewtoyx/checkin-analytics/issues/1)):
where an old word survives as a node the mapping is identity; where it does
not, the analytics transformation layer applies the synonym row from the
tables below.

## Eras

| Era | Introduced | Vocabulary | Source |
|-----|-----------|------------|--------|
| E1 | M1 (#4) | Flat 8-word list | `FEELINGS` in `src/config.ts` (removed in #12) |
| E2 | #12 | Placeholder wheel, 114 words (6 cores × 6 middle × 2 finer) | `src/feelings-wheel.ts` before #31 |
| E3 | #31 | 6×6×6 taxonomy, 258 words (6 cores × 6 middle × 6 outer) | `src/feelings-wheel.ts` |

## The E3 taxonomy (issue #31)

Six cores, each with exactly six middle words, each with exactly six outer
words: 6 + 36 + 216 = 258 nodes, every word unique case-insensitively. The
structural test in `test/feelings-wheel.spec.ts` asserts the shape, the
uniqueness, and the label budget (≤ 12 characters, provisional until #32
fixes the chip metrics).

### Design decisions

- **The top level departs from Willcox.** Willcox's *powerful* sector is
  folded into `happy` (the `proud` branch: accomplished, confident, capable…)
  and `calm` (the `focused` and `safe` branches), freeing the sixth core for
  **`overloaded`** — the capacity/body-budget axis: overwhelm, sensory
  overload (`frazzled`), `shut down`, `burned out`, `numb`, `drained`.
  The rgh-pre filings argue these states are first-class and *distinct from
  fear and sadness* for this instrument's user: sensory overload is
  explicitly not anxiety (`failure-modes/undetected-sensory-overload`,
  `failure-modes/neurodivergence-misread-as-anxiety`), meltdown looks like
  anger but is overload underneath, and burnout is explicitly not depression
  (`telemetry-state/four-autistic-stress-state-signatures`). A wheel whose
  only homes for these states are *afraid* or *sad* mislabels the user's
  most common difficult states; the era-2 wheel buried them exactly that way
  (`overwhelmed` under *scared*, `tired`/`drained` under *sad*).
- **No core is a subset of another.** `overloaded` ≠ `afraid` is the point
  above; `calm` ≠ `happy` (low-arousal regulation vs positive affect —
  polyvagal "glimmers" states get their own core so quiet regulated states
  are recordable without claiming happiness).
- **Valence is 4 unpleasant / 2 pleasant**, a recorded deviation from the
  3 / 3 example in #31. The balance concern (negativity bias — pleasant
  states must be genuinely recordable, `telemetry-state/glimmers`) is met by
  granularity rather than core count: 86 pleasant nodes vs 38 in era 2.
- **Short compounds are allowed** (open question 2 of #31): two words max,
  ≤ 12 characters including the space (`shut down`, `at ease`, `let down`,
  `in flow`). They are the reader's own language where any single word would
  be a thesaurus word.
- **`stressed` is deliberately not a node.** The filings name it as one of
  the catch-all words alexithymic answers collapse into
  (`telemetry-state/alexithymia`); the wheel's job is to move past it. It
  maps to the `overloaded` core below.
- **Community vernacular is welcome** where it is the plainest label
  (`overstimmed`, `wired`, `foggy`, `checked out`), per the filings'
  preference for lived language over clinical terms.
- **Hues.** Five sector hues carry over from era 2 unchanged. `overloaded`
  gets `#8a5fc8` (violet), chosen to match the relative luminance of the
  era-2 blue (`#4a6fdc`, L ≈ 0.18) so its contrast on light and dark grounds
  is the same as an already-shipped hue.

## Era mapping

Every word offered in eras 1–2 maps to its nearest node in E3. **Identity**
rows (the word survives as a node, possibly under a new parent) are omitted
from the tables; the full identity list is recoverable by intersecting the
era vocabularies with the E3 tree. Only words that changed are tabled.

### E1 → E3 (MVP 8-word list)

| E1 word | E3 node | Note |
|---------|---------|------|
| good | `happy` (core) | generic positive |
| stressed | `overloaded` (core) | catch-all, deliberately not a node |
| irritable | `irritated` (middle, angry) | word form change |
| calm, happy, anxious | identity | |
| low | identity — `sad > down > low` | |
| tired | identity — `overloaded > drained > tired` | sector move from E2's *sad* |

### E2 → E3 (placeholder wheel): non-identity rows

Cores first. E2's six cores map: *peaceful* → `peaceful` (now a middle under
`calm`), *joyful* → `happy`, *powerful* → `proud` (middle under `happy`),
*mad* → `angry`, *scared* → `afraid`, *sad* → `sad`.

| E2 word | E3 node | Note |
|---------|---------|------|
| thoughtful | `calm > curious > wondering` | reflective register |
| reflective | `calm > curious > wondering` | |
| pensive | `sad > grieving > wistful` | thoughtful-sad shade |
| trusting | `calm > safe` | |
| delighted | `happy` (core) | |
| cheerful | `happy` (core) | synonym of the core, dropped |
| enthusiastic | `happy > excited > eager` | |
| energetic | `happy > excited > pumped` | |
| lively | `happy > excited` | |
| self-assured | `happy > proud > confident` | |
| courageous | `happy > proud > bold` | |
| brave | `happy > proud > bold` | |
| determined | `happy > proud > strong` | |
| valued | `happy > proud` | seen/validated by others |
| appreciated | `happy > proud` | |
| respected | `happy > proud` | |
| creative | `happy > hopeful > inspired` | |
| motivated | `happy > excited > eager` | |
| successful | `happy > proud > accomplished` | |
| effective | `happy > proud > capable` | |
| in control | `calm > safe > steady` | |
| wounded | `angry > hurt > stung` | |
| dismissive | `angry > critical > scornful` | |
| stressed | `overloaded` (core) | see design decisions |
| pressured | `overloaded > overwhelmed > stretched` | |
| overwhelmed | identity — `overloaded > overwhelmed` | sector move from *scared* |
| self-doubting | `afraid > insecure > unsure` | |
| rejected | `sad > lonely > unwanted` | |
| stuck | identity — `overloaded > drained > stuck` | sector move from *scared* |
| drained | identity — `overloaded > drained` | sector move from *sad* |
| weary | identity — `overloaded > drained > weary` | sector move from *sad* |
| indifferent | `overloaded > numb > detached` | |
| flat | identity — `overloaded > numb > flat` | sector move from *sad* |
| bored | identity — `overloaded > numb > bored` | sector move from *sad*; understimulated-flat reading |
| deflated | identity — `sad > disappointed > deflated` | sector move from *sad > ashamed* |

All other E2 words are identity mappings (same word, possibly a new parent;
the parent is discoverable from `WHEEL` in `src/feelings-wheel.ts`).

## Wiki references

Authoring sources from the rgh-pre bundle (per #31's implementation note):
`telemetry-state/` alexithymia, affect-labeling, emotional-vocabulary-building,
four-autistic-stress-state-signatures, glimmers, halt-body-budget-rubric,
brain-fog-as-state-signal; `mindset/` emotional-granularity,
naming-emotions-specifically, fear-underlies-negative-emotions;
`failure-modes/` undetected-sensory-overload, neurodivergence-misread-as-anxiety,
depression-sensory-shutdown; `fleeting/` cbt-for-dummies §7 (healthy/unhealthy
pairs as within-family gradients), unmasking-workbook-penot §9.
