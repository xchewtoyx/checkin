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
tables below. Words from any era chain forward table by table (E2 → E3 →
E4 → E5) until they land on a current node.

Responses recorded after the `vocab_era` column landed
(`migrations/0003_response_vocab_era.sql`) self-describe their era: the
check-in page embeds `VOCAB_ERA` (exported from `src/feelings-wheel.ts`
alongside `WHEEL`, and asserted against the era table below by the
structural test) and the submission carries it back, so the stored era is
that of the page the word was picked from even when a vocabulary deploy
lands between open and submit. Rows with `vocab_era = NULL` predate
stamping — map those by deploy date, as before. Details in
[`analytics-extract.md`](analytics-extract.md).

## Eras

| Era | Introduced | Vocabulary | Source |
|-----|-----------|------------|--------|
| E1 | M1 (#4) | Flat 8-word list | `FEELINGS` in `src/config.ts` (removed in #12) |
| E2 | #12 | Placeholder wheel, 114 words (6 cores × 6 middle × 2 finer) | `src/feelings-wheel.ts` before #31 |
| E3 | #31 | 6×6×6 taxonomy, 258 words (6 cores × 6 middle × 6 outer) | `src/feelings-wheel.ts` before the overload rescan |
| E4 | overload rescan (`claude/feelings-wheel-labels`) | Same 6×6×6 shape, 258 words; `overloaded` sector restructured | `src/feelings-wheel.ts` before the Roberts alignment |
| E5 | Roberts alignment (`claude/roberts-wheel-alignment`) | Same 6×6×6 shape, 258 words; 15 words (one core) renamed to their Roberts-wheel equivalents | `src/feelings-wheel.ts` |

## The E3 taxonomy (issue #31)

Six cores, each with exactly six middle words, each with exactly six outer
words: 6 + 36 + 216 = 258 nodes, every word unique case-insensitively.
The full wheel is rendered at [`feelings-wheel.svg`](feelings-wheel.svg),
regenerated from the data with `npm run wheel-svg`. The
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
- **Review pass per branch** (#31 fit criterion for narrowing semantics):
  each sector was independently reviewed against the rules *child = genuine
  specialisation ("which kind of X?", never "which other word for X?")*,
  *siblings mutually distinguishable*, and *plain British self-report
  register*. The pass replaced ~40 words (thesaurus synonym clusters like
  contemptuous/disdainful/scornful, sibling duplicates like
  terrified/petrified and left out/excluded, Americanisms like
  pumped/goofy/cozy) and surfaced `relieved`, previously missing entirely.
  Era words flagged only for being mild intensity shades of their parent
  (`low`, `tired`, `annoyed`, `worried`, `furious`, `overwhelmed`) were kept:
  recognisably different intensity states are allowed gradations, and these
  are the words the user actually reaches for.
- **Hues.** Five sector hues carry over from era 2 unchanged. `overloaded`
  gets `#9d4f9e` (plum): ≥ 3:1 against both light and dark grounds (5.2:1 /
  3.4:1, the same league as the era-2 blue), and — unlike the
  luminance-matched violet first considered — clearly separable from the
  adjacent `sad` blue for protan/deutan vision (OKLab ΔE 10.5 protan,
  16.2 normal, vs 3.5 / 9.6 for the violet).

## The E4 revision (overload rescan)

Two days of live use surfaced gaps in the `overloaded` sector, and a rescan
against the rgh-pre filings confirmed them. The sector shape changed from
*overwhelmed / frazzled / shut down / burned out / numb / drained* to
**overwhelmed / overstimmed / boiling over / stuck / shut down / drained** —
the six middles now walk the arousal curve: flooded → sensory →
hyperarousal peak → captured attention → hypoarousal collapse → depletion.
Per-word descriptions and identification cues live in
[`feelings-catalog.md`](feelings-catalog.md).

### Findings from the rescan

- **The hyperarousal direction had no home.** The filings model overload as
  crossing the window of tolerance in one of *two* directions
  (`failure-modes/hyperarousal-vs-hypoarousal`): an escalating, outward
  direction (feeding meltdown) and a collapsed, inward direction (feeding
  shutdown). E3 covered only the second — `shut down`, `numb`, plus
  depletion — so the escalating pre-meltdown state had nowhere to land
  except *angry*, which repeats the meltdown-misread-as-temper error
  (`failure-modes/meltdown`: a meltdown is an involuntary overflow, not
  goal-directed anger). New middle: **`boiling over`**, with `meltdown`
  itself as a node.
- **Captured attention was missing entirely.** Hyperfocus, rumination
  loops, waiting mode, and can't-stop urges are all attention held
  involuntarily (`failure-modes/hyperfocus`, `failure-modes/rumination-spiral`,
  `failure-modes/autistic-intellectualized-rumination`,
  `failure-modes/autistic-inertia`,
  `capacity-load/hyperfocus-bypasses-interoception-and-time`,
  `capacity-load/waiting-mode-locks-capacity-before-events`). The E3 wheel
  could only file these as `calm > focused` — wrong valence and wrong
  mechanism: focus is chosen and can be put down; hyperfocus is
  condition-gated capture where *stopping is what's difficult*. New middle:
  **`stuck`** (promoted from `drained > stuck`), holding `hyperfocus`,
  `wired`, `looping`, `ruminating`, `obsessing`, `compelled`.
- **`shut down` and `numb` were one state split in two.** Both are the
  hypoarousal collapse (`failure-modes/shutdown`: speech and cognition slow,
  nonresponsive, dissociation). Merged into **`shut down`**, whose finer
  words now read as *which channel went offline*: `frozen` (can't act),
  `mute` (can't speak), `numb` (can't feel), `blank` (can't think),
  `checked out` (not present), `unreal` (dissociated). The merge funds one
  of the two new middles.
- **`burned out` demoted to `drained > burned out`.** Burnout is the
  chronic end of the depletion gradient (`failure-modes/autistic-burnout`);
  keeping it as the extreme node of `drained` preserves the
  burnout-is-not-depression distinction while funding the other new middle.
  Its E3 finer words were thesaurus shades (`wrung out`, `threadbare`, …)
  and are mapped below.
- **Two sector moves.** `on edge` (from `afraid > anxious`) and `tetchy`
  (from `angry > irritated`) are pre-meltdown hyperarousal markers filed
  under `boiling over`: the escalation state is routinely misread as
  anxiety (`failure-modes/neurodivergence-misread-as-anxiety`, and the
  meltdown filing notes many autistic people reject the "anxiety" label for
  neuro-crash events) or as interpersonal anger. Replacements keep those
  sectors' semantics: `keyed up` (thought-driven anticipatory tension) and
  `huffy` (offence-taking irritation at someone).
- **Whimsical sensory words replaced.** `frazzled`, `jangly`, `scratchy`,
  `crawly` were open to interpretation; the sector's plainest community
  word, `overstimmed`, is promoted to the middle slot and its finer words
  are standard idiom for sensory over-responsivity
  (`telemetry-state/sensory-over-responsivity`): `rattled`, `jarred`,
  `frayed`, `buzzing`, `twitchy`, `too much`.
- **`literal` added** under `overwhelmed`: losing the eye for nuance —
  black-and-white, rule-bound reading of situations — is a recognisable
  overload marker (`failure-modes/stuck-in-outdated-coping` names literal
  rule-following under out-of-script conditions; *Unmasked* ch. 3, "Literal
  Thinking", is a filing source).
- **`locked in` → `absorbed`** (`calm > focused`). With `stuck` now a
  middle for involuntary capture, a pleasant word that reads as "can't get
  out" was an ambiguity trap; `absorbed` keeps the deep-engagement meaning
  with no capture connotation.
- **Word-form rules unchanged**: ≤ 12 characters, at most two
  space-separated lowercase words (the structural test's charset also
  excludes hyphens and apostrophes, which ruled out `short-fused` and
  `can't stop`; `short fuse` and `compelled` stand in).

## The E5 revision (Roberts wheel alignment)

Therapy sessions use the Geoffrey Roberts feelings wheel (the version with
British spellings — *sceptical*, *victimised*), so the two vocabularies are
now used side by side. E5 renames individual words — including the
`afraid` core, now `fearful` — to the Roberts word wherever the two are
near-neighbours, so that a word said in session and a word recorded in a
check-in are the same word. No structural change: same tree, same 258
nodes, same parents.

**The standing rule** (set in this revision, binding on future passes):
where a published vocabulary word and an app word are near-neighbours and
the published word has no clash on the wheel, the published word is
preferred — register preferences, including the user's own stated
preferences, do not outrank the published standard. Keeping the app word
requires a strong, evidence-backed argument (a filing, a documented
failure mode, a coverage loss), not taste. Several E3 review decisions
had chosen between synonym pairs on register grounds alone (`left out`
over `excluded`, `bold` for `courageous`, `small` for `inferior`,
`stretched` for `pressured`); under this rule those ties flip to the
Roberts word.

The alignment stops where the evidence-backed departures begin. The
taxonomy's structural departures from Roberts (and from Willcox) all
stand: the `overloaded` core, the calm/happy split, no
*surprised*/*disgusted*/*bad* cores, and no catch-all words (`stressed`,
`bad`, `awful`). After E5, 68 of the Roberts wheel's 126 words are nodes
here. The renames are tabled under
[E4 → E5](#e4--e5-roberts-alignment-non-identity-rows) below.

### Roberts words considered and not adopted

Every remaining Roberts word was tested against the standing rule; each
non-adoption below names its strong argument. Two arguments recur:

- **Synonym of a parent or core, not of a slot** — a child must answer
  "which kind of X?", never "another word for X?" (E3 fit criterion).
  Rules out **frightened** (≈ the `fearful` core itself; `terrified`
  anchors the panicked extreme), **inquisitive** (≈ its would-be parent
  `curious`), **mad** and **scared** (≈ cores `angry`/`fearful`),
  **interested** (≈ `curious`).
- **The nearest slot is already held by a Roberts word** — swapping
  trades one Roberts word for another, net alignment zero. Rules out
  **creative** (`inspired`), **infuriated** (`furious`), **horrified**
  (`appalled`), **revolted**/**nauseated** (`disgusted`), **ridiculed**
  (`humiliated`), **empty** (`numb` holds the no-ache emptiness;
  `joyless` is distinct — it still aches).

Specific cases:

- **grief / despair** — inflections of `grieving`/`despairing`, the same
  lexeme in the wheel's adjectival register; not a vocabulary difference.
- **remorseful** — E2 dropped it as a synonym of `regretful`, but the
  catalogue has since given `regretful` the non-moral choice-regret
  meaning ("the fork in the road"); remorseful implies wrongdoing and
  would overlap its sibling `guilty` instead.
- **startled** — `panicked > alarmed` (the acute jolt) and
  `panicked > spooked` (the aftermath that won't stand down) split the
  startle response deliberately; `startled` would blur into both.
- **threatened** — `insecure > intimidated` names inhibition (shrinking
  and self-censoring in a specific presence), not perceived danger; the
  entry would not survive the swap. Roberts' *threatened* children
  (nervous, exposed) are already nodes.
- **violated** — would narrow `hurt > wronged` (the general
  injustice-done-to-me state) to boundary-crossing, orphaning most of its
  uses; `betrayed` already holds broken trust.
- **shocked** — sector-ambiguous (shocked-angry, shocked-grief,
  shocked-scared); `confused > blindsided` names the precise mechanism
  (unwatched angle) and `panicked > alarmed` the fear-jolt.
- **dismissive** — collides with the existing `hurt > dismissed` chip
  (opposite direction of the same verb) and `critical > unimpressed`
  names a different failure (quality shortfall, not refusal to engage).
- **withdrawn / distant / numb-under-angry** — Roberts files withdrawal
  under *Angry*; here withdrawal is `overloaded > shut down`, a core E3/E4
  design thesis (shutdown is overload, not anger —
  `failure-modes/shutdown`). At word level `checked out` beats
  `withdrawn` because withdrawn connotes chosen social distancing —
  inviting exactly the sulking misread the filing warns against.
- **depressed** — clinical register avoided throughout; the
  burnout-is-not-depression distinction
  (`telemetry-state/four-autistic-stress-state-signatures`) depends on not
  offering it as a chip.
- **stressed / bad / awful** — catch-alls, deliberately not nodes (see E3
  design decisions; `telemetry-state/alexithymia`).
- **bored** — still no slot after the E4 merge; the standing note
  ("revisit if reached for") is unchanged.
- **unfocused** — `drained > foggy` is the filing-sourced brain-fog word
  (`telemetry-state/brain-fog-as-state-signal`).
- **out of control** — three words / 14 characters, fails the word-form
  rules.
- **accepted / valued / respected** (the Roberts *Accepted* branch) —
  other-directed validation was folded into `proud` in E3; no free slot in
  that branch without dropping a self-achievement distinction. The gap is
  known: a check-in for "seen/valued by others" has no pleasant node.
- **vulnerable / fragile / victimised / persecuted** — no slot-level
  synonyms exist (`exposed`, `raw`, `used`, `wronged` each hold distinct
  meanings); a genuine coverage gap, candidate for a future revision
  rather than a displacement.
- **free / intimate / sensitive / awe / amazed / astonished / aroused** —
  further genuine gaps (liberation, relational closeness, positive
  wonder) with no near-neighbour to rename; noted for a future pass, not
  forced into occupied slots.
- **remaining surprise/disgust vocabulary** (apathetic, indifferent,
  detestable, disillusioned, disapproving, repelled, rushed, busy…) — no
  surprise or disgust sector by design, and no slot-level near-neighbour;
  `critical > disgusted`/`appalled` carry the judging register,
  `shut down > checked out`/`numb` the switched-off states.

## Era mapping

Every word offered in earlier eras maps to its nearest node in the current
taxonomy. **Identity** rows (the word survives as a node, possibly under a
new parent or at a new level) are omitted from the tables; the full
identity list is recoverable by intersecting the era vocabularies with the
current tree. Only words that changed are tabled. Older-era words that map
to an E3 word which itself changed in E4 chain through the E3 → E4 table
(e.g. E2 `indifferent` → E3 `detached` → E4 `checked out`).

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
| tranquil | `calm > peaceful > serene` | dropped as a sibling synonym of serene |
| secure | `calm > safe` | dropped as a synonym restatement of safe |
| delighted | `happy` (core) | |
| cheerful | `happy` (core) | synonym of the core, dropped |
| enthusiastic | `happy > excited > eager` | |
| energetic | `happy > excited > fired up` | |
| lively | `happy > excited` | |
| self-assured | `happy > proud > confident` | |
| courageous | `happy > proud > bold` | |
| brave | `happy > proud > bold` | |
| determined | `happy > proud > confident` | |
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
| excluded | `sad > lonely > left out` | dropped as a sibling synonym of left out |
| remorseful | `sad > ashamed > regretful` | dropped as a sibling synonym of regretful |
| stuck | identity — `overloaded > drained > stuck` | sector move from *scared* |
| drained | identity — `overloaded > drained` | sector move from *sad* |
| weary | identity — `overloaded > drained > weary` | sector move from *sad* |
| indifferent | `overloaded > numb > detached` | |
| flat | identity — `overloaded > numb > flat` | sector move from *sad* |
| bored | identity — `overloaded > numb > bored` | sector move from *sad*; understimulated-flat reading |
| deflated | identity — `sad > disappointed > deflated` | sector move from *sad > ashamed* |

All other E2 words are identity mappings (same word, possibly a new parent;
the parent is discoverable from `WHEEL` in `src/feelings-wheel.ts`).

### E3 → E4 (overload rescan): non-identity rows

Identity rows with level or sector changes, listed here because analytics
may care about the parent change even though the recorded word is stable:
`overstimmed` (finer → middle), `stuck` (`drained` finer → middle),
`numb` (middle → `shut down` finer), `burned out` (middle → `drained`
finer), `wired` (`frazzled` finer → `stuck` finer), `on edge`
(`afraid > anxious` → `overloaded > boiling over`, sector move), `tetchy`
(`angry > irritated` → `overloaded > boiling over`, sector move).

| E3 word | E4 node | Note |
|---------|---------|------|
| saturated | `overloaded > overwhelmed > flooded` | sibling synonym of flooded/swamped |
| frazzled | `overloaded > overstimmed` | middle renamed to the plainer community word |
| jangly | `overloaded > overstimmed > rattled` | whimsical → standard idiom |
| scratchy | `overloaded > overstimmed > frayed` | whimsical → standard idiom |
| crawly | `overloaded > overstimmed > twitchy` | whimsical → standard idiom |
| gone dark | `overloaded > shut down > blank` | |
| withdrawn | `overloaded > shut down > checked out` | |
| walled off | `overloaded > shut down > checked out` | |
| flat | `overloaded > shut down > numb` | E2 `flat` chains here too |
| switched off | `overloaded > shut down > checked out` | |
| detached | `overloaded > shut down > checked out` | E2 `indifferent` chains here too |
| bored | `sad > disappointed > underwhelmed` | sector move; the understimulated-flat reading lost its slot in the merge — revisit if reached for |
| wrung out | `overloaded > drained > burned out` | |
| hollow | `overloaded > shut down > numb` | emptiness reading |
| spent | `overloaded > drained > exhausted` | |
| running dry | `overloaded > drained > burned out` | |
| worn thin | `overloaded > drained > burned out` | |
| threadbare | `overloaded > drained > burned out` | |
| locked in | `calm > focused > absorbed` | ambiguity with the new `stuck` middle |

### E4 → E5 (Roberts alignment): non-identity rows

Pure renames — every row keeps its slot, parent, and catalogue meaning;
the recorded word changes to the Roberts-wheel synonym. Earlier-era words
that mapped to the left column chain through (e.g. E2 `excluded` → E3/E4
`left out` → E5 `excluded`, an identity round-trip; likewise E2
`pressured`, `rejected`, `courageous`, `brave`, `successful`,
`energetic`).

| E4 word | E5 node | Note |
|---------|---------|------|
| afraid | `fearful` (core) | pure synonym; four of six cores now match Roberts labels |
| aggrieved | `angry > resentful > indignant` | |
| insulted | `angry > hurt > disrespected` | catalogue already defined the injury as disrespect |
| cynical | `angry > critical > sceptical` | entry generalised from motives to claims-and-motives |
| judgy | `angry > critical > judgmental` | slang → standard form |
| bewildered | `fearful > confused > perplexed` | |
| small | `fearful > insecure > inferior` | same spoke as Roberts (*Insecure > Inferior*) |
| reluctant | `fearful > dreading > hesitant` | Roberts files hesitant under *Repelled*; the word, not the placement, is what aligns |
| stretched | `overloaded > overwhelmed > pressured` | reverses the E2 `pressured` → `stretched` mapping |
| left out | `sad > lonely > excluded` | reverses the E3 drop of `excluded` |
| unwanted | `sad > lonely > rejected` | reverses the E2 `rejected` → `unwanted` mapping |
| fired up | `happy > excited > energetic` | reverses the E2 `energetic` → `fired up` mapping |
| elated | `happy > excited > joyful` | Roberts files joyful under *Content*; here it keeps elated's peak slot |
| accomplished | `happy > proud > successful` | reverses the E2 `successful` → `accomplished` mapping |
| bold | `happy > proud > courageous` | reverses the E2 `courageous` → `bold` mapping |

## Wiki references

E4 rescan sources from the rgh-pre bundle: `failure-modes/` meltdown,
shutdown, hyperfocus, hyperarousal-vs-hypoarousal, anxiety-vs-sensory-overload,
rumination-spiral, autistic-intellectualized-rumination, autistic-inertia,
autistic-burnout, chronic-stress-activation, stuck-in-outdated-coping,
neurodivergence-misread-as-anxiety; `telemetry-state/`
four-autistic-stress-state-signatures, sensory-over-responsivity,
not-wanting-locks-rumination; `capacity-load/`
hyperfocus-bypasses-interoception-and-time, waiting-mode-locks-capacity-before-events,
rumination-as-continuous-cognitive-demand, routine-as-decision-capacity-preservation
(*Unmasked* ch. 3, "Literal Thinking").

E3 authoring sources from the rgh-pre bundle (per #31's implementation note):
`telemetry-state/` alexithymia, affect-labeling, emotional-vocabulary-building,
four-autistic-stress-state-signatures, glimmers, halt-body-budget-rubric,
brain-fog-as-state-signal; `mindset/` emotional-granularity,
naming-emotions-specifically, fear-underlies-negative-emotions;
`failure-modes/` undetected-sensory-overload, neurodivergence-misread-as-anxiety,
depression-sensory-shutdown; `fleeting/` cbt-for-dummies §7 (healthy/unhealthy
pairs as within-family gradients), unmasking-workbook-penot §9.
