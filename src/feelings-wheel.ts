export interface WheelFeeling {
  word: string;
  finer: string[];
}

export type Valence = "pleasant" | "unpleasant";

export interface WheelSector {
  core: string;
  hue: string;
  valence: Valence;
  feelings: WheelFeeling[];
}

// Longest chip label the taxonomy may contain. Fixed by #32's chip-metrics
// decision (docs/checkin-ladder.md §4: a 3-column ladder-row grid, measured
// against this budget); asserted by the structural test so a future word
// past 12 characters fails loudly here rather than truncating in the UI.
export const LABEL_BUDGET = 12;

// The 6×6×6 feelings taxonomy (issue #31, revised E5): 6 cores × 6 middle
// words × 6 outer words = 258 nodes, every word unique case-insensitively.
// Willcox is the base, but the top level departs from it deliberately: the
// "powerful" sector folds into happy/calm, freeing a core for "overloaded"
// — the overwhelm / overstimulation / meltdown / captured-attention /
// shutdown / depletion axis that generic wheels bury and that the rgh-pre
// filings argue is first-class and distinct from fear and anger.
// E5 renames individual words to their Geoffrey Roberts wheel equivalents
// where the two are genuine synonyms, so check-ins and therapy sessions
// (which use the Roberts wheel) share a vocabulary without remapping.
// Vocabulary sources, revision rationales, and the era mapping for
// previously recorded words live in docs/feelings-vocabulary.md; per-word
// descriptions live in docs/feelings-catalog.md.
export const WHEEL: WheelSector[] = [
  {
    core: "angry",
    hue: "#d64550",
    valence: "unpleasant",
    feelings: [
      {
        word: "irritated",
        finer: ["annoyed", "impatient", "grumpy", "snappy", "huffy", "prickly"],
      },
      {
        word: "frustrated",
        finer: ["blocked", "thwarted", "exasperated", "held up", "fed up", "hampered"],
      },
      {
        word: "resentful",
        finer: ["bitter", "indignant", "jealous", "sore", "used", "cheated"],
      },
      {
        word: "hostile",
        finer: ["furious", "seething", "fuming", "raging", "vengeful", "spiteful"],
      },
      {
        word: "hurt",
        finer: ["betrayed", "wronged", "stung", "disrespected", "offended", "dismissed"],
      },
      {
        word: "critical",
        finer: ["scornful", "sceptical", "disgusted", "unimpressed", "appalled", "judgmental"],
      },
    ],
  },
  {
    core: "fearful",
    hue: "#e8871e",
    valence: "unpleasant",
    feelings: [
      {
        word: "anxious",
        finer: ["worried", "uneasy", "nervous", "keyed up", "jittery", "tense"],
      },
      {
        word: "panicked",
        finer: ["terrified", "breathless", "alarmed", "frantic", "shaky", "spooked"],
      },
      {
        word: "insecure",
        finer: ["inadequate", "unsure", "exposed", "unworthy", "inferior", "intimidated"],
      },
      {
        word: "dreading",
        finer: ["sinking", "daunted", "wary", "hesitant", "queasy", "on eggshells"],
      },
      {
        word: "helpless",
        finer: ["trapped", "cornered", "powerless", "defenceless", "desperate", "adrift"],
      },
      {
        word: "confused",
        finer: ["perplexed", "lost", "torn", "muddled", "blindsided", "flustered"],
      },
    ],
  },
  {
    core: "overloaded",
    hue: "#9d4f9e",
    valence: "unpleasant",
    feelings: [
      {
        word: "overwhelmed",
        finer: ["flooded", "swamped", "maxed out", "buried", "pressured", "literal"],
      },
      {
        word: "overstimmed",
        finer: ["rattled", "jarred", "frayed", "buzzing", "twitchy", "too much"],
      },
      {
        word: "boiling over",
        finer: ["meltdown", "simmering", "wound up", "on edge", "tetchy", "short fuse"],
      },
      {
        word: "stuck",
        finer: ["hyperfocus", "wired", "looping", "ruminating", "obsessing", "compelled"],
      },
      {
        word: "shut down",
        finer: ["frozen", "numb", "blank", "checked out", "mute", "unreal"],
      },
      {
        word: "drained",
        finer: ["tired", "exhausted", "weary", "sleepy", "foggy", "burned out"],
      },
    ],
  },
  {
    core: "sad",
    hue: "#4a6fdc",
    valence: "unpleasant",
    feelings: [
      {
        word: "down",
        finer: ["low", "gloomy", "glum", "heavy", "teary", "joyless"],
      },
      {
        word: "grieving",
        finer: ["bereft", "raw", "heartbroken", "aching", "longing", "wistful"],
      },
      {
        word: "lonely",
        finer: ["isolated", "excluded", "unseen", "rejected", "homesick", "abandoned"],
      },
      {
        word: "disappointed",
        finer: ["let down", "deflated", "underwhelmed", "discouraged", "dismayed", "downcast"],
      },
      {
        word: "ashamed",
        finer: ["guilty", "embarrassed", "humiliated", "regretful", "sheepish", "mortified"],
      },
      {
        word: "despairing",
        finer: ["bleak", "worthless", "defeated", "resigned", "anguished", "crushed"],
      },
    ],
  },
  {
    core: "calm",
    hue: "#2ba193",
    valence: "pleasant",
    feelings: [
      {
        word: "peaceful",
        finer: ["serene", "still", "unhurried", "hushed", "untroubled", "quiet"],
      },
      {
        word: "content",
        finer: ["satisfied", "comfortable", "cosy", "fulfilled", "mellow", "at home"],
      },
      {
        word: "relaxed",
        finer: ["at ease", "loose", "unwound", "soothed", "refreshed", "recharged"],
      },
      {
        word: "safe",
        finer: ["settled", "protected", "sheltered", "held", "grounded", "steady"],
      },
      {
        word: "focused",
        finer: ["absorbed", "engaged", "in flow", "clear", "sharp", "present"],
      },
      {
        word: "curious",
        finer: ["keen", "intrigued", "open", "wondering", "fascinated", "drawn in"],
      },
    ],
  },
  {
    core: "happy",
    hue: "#d9a514",
    valence: "pleasant",
    feelings: [
      {
        word: "hopeful",
        finer: ["optimistic", "encouraged", "inspired", "uplifted", "buoyant", "heartened"],
      },
      {
        word: "excited",
        finer: ["eager", "thrilled", "exhilarated", "energetic", "giddy", "joyful"],
      },
      {
        word: "playful",
        finer: ["amused", "silly", "mischievous", "lighthearted", "tickled", "cheeky"],
      },
      {
        word: "grateful",
        finer: ["thankful", "blessed", "touched", "relieved", "lucky", "humbled"],
      },
      {
        word: "proud",
        finer: ["successful", "confident", "capable", "triumphant", "chuffed", "courageous"],
      },
      {
        word: "loving",
        finer: ["affectionate", "tender", "warm", "adoring", "smitten", "doting"],
      },
    ],
  },
];

