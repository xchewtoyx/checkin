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

// The 6×6×6 feelings taxonomy (issue #31): 6 cores × 6 middle words × 6
// outer words = 258 nodes, every word unique case-insensitively. Willcox is
// the base, but the top level departs from it deliberately: the "powerful"
// sector folds into happy/calm, freeing a core for "overloaded" — the
// overwhelm / shutdown / burnout / numb / drained axis that generic wheels
// bury and that the rgh-pre filings argue is first-class and distinct from
// fear. Vocabulary sources and the era mapping for previously recorded
// words live in docs/feelings-vocabulary.md.
export const WHEEL: WheelSector[] = [
  {
    core: "angry",
    hue: "#d64550",
    valence: "unpleasant",
    feelings: [
      {
        word: "irritated",
        finer: ["annoyed", "impatient", "grumpy", "snappy", "tetchy", "prickly"],
      },
      {
        word: "frustrated",
        finer: ["blocked", "thwarted", "exasperated", "held up", "fed up", "hampered"],
      },
      {
        word: "resentful",
        finer: ["bitter", "aggrieved", "jealous", "sore", "used", "cheated"],
      },
      {
        word: "hostile",
        finer: ["furious", "seething", "fuming", "raging", "vengeful", "spiteful"],
      },
      {
        word: "hurt",
        finer: ["betrayed", "wronged", "stung", "insulted", "offended", "dismissed"],
      },
      {
        word: "critical",
        finer: ["scornful", "cynical", "disgusted", "unimpressed", "appalled", "judgy"],
      },
    ],
  },
  {
    core: "afraid",
    hue: "#e8871e",
    valence: "unpleasant",
    feelings: [
      {
        word: "anxious",
        finer: ["worried", "uneasy", "nervous", "on edge", "jittery", "tense"],
      },
      {
        word: "panicked",
        finer: ["terrified", "breathless", "alarmed", "frantic", "shaky", "spooked"],
      },
      {
        word: "insecure",
        finer: ["inadequate", "unsure", "exposed", "unworthy", "small", "intimidated"],
      },
      {
        word: "dreading",
        finer: ["sinking", "daunted", "wary", "reluctant", "queasy", "on eggshells"],
      },
      {
        word: "helpless",
        finer: ["trapped", "cornered", "powerless", "defenceless", "desperate", "adrift"],
      },
      {
        word: "confused",
        finer: ["bewildered", "lost", "torn", "muddled", "blindsided", "flustered"],
      },
    ],
  },
  {
    core: "overloaded",
    hue: "#8a5fc8",
    valence: "unpleasant",
    feelings: [
      {
        word: "overwhelmed",
        finer: ["flooded", "swamped", "maxed out", "buried", "stretched", "saturated"],
      },
      {
        word: "frazzled",
        finer: ["overstimmed", "jangly", "scratchy", "wired", "twitchy", "crawly"],
      },
      {
        word: "shut down",
        finer: ["frozen", "gone dark", "withdrawn", "checked out", "walled off", "mute"],
      },
      {
        word: "burned out",
        finer: ["wrung out", "hollow", "spent", "running dry", "worn thin", "threadbare"],
      },
      {
        word: "numb",
        finer: ["flat", "blank", "switched off", "detached", "bored", "unreal"],
      },
      {
        word: "drained",
        finer: ["tired", "exhausted", "weary", "sleepy", "foggy", "stuck"],
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
        finer: ["isolated", "left out", "unseen", "unwanted", "homesick", "abandoned"],
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
        finer: ["locked in", "engaged", "in flow", "clear", "sharp", "present"],
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
        finer: ["eager", "thrilled", "exhilarated", "fired up", "giddy", "elated"],
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
        finer: ["accomplished", "confident", "capable", "triumphant", "chuffed", "bold"],
      },
      {
        word: "loving",
        finer: ["affectionate", "tender", "warm", "adoring", "smitten", "doting"],
      },
    ],
  },
];

