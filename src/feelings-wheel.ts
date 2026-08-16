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

// Longest chip label the taxonomy may contain. Provisional until #32 fixes
// the chip metrics; asserted by the structural test so a #32 revision that
// tightens the budget fails loudly here rather than truncating in the UI.
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
        finer: ["blocked", "thwarted", "exasperated", "foiled", "fed up", "hampered"],
      },
      {
        word: "resentful",
        finer: ["bitter", "envious", "jealous", "slighted", "used", "cheated"],
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
        finer: ["scornful", "cynical", "disgusted", "contemptuous", "appalled", "disdainful"],
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
        finer: ["worried", "uneasy", "nervous", "on edge", "jittery", "fretful"],
      },
      {
        word: "panicked",
        finer: ["terrified", "petrified", "alarmed", "frantic", "shaky", "spooked"],
      },
      {
        word: "insecure",
        finer: ["inadequate", "unsure", "exposed", "unworthy", "small", "intimidated"],
      },
      {
        word: "dreading",
        finer: ["apprehensive", "daunted", "wary", "hesitant", "reluctant", "queasy"],
      },
      {
        word: "helpless",
        finer: ["trapped", "cornered", "powerless", "defenseless", "desperate", "adrift"],
      },
      {
        word: "confused",
        finer: ["bewildered", "lost", "torn", "muddled", "blindsided", "thrown"],
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
        finer: ["overstimmed", "jangly", "grated", "wired", "twitchy", "buzzing"],
      },
      {
        word: "shut down",
        finer: ["frozen", "unresponsive", "withdrawn", "checked out", "walled off", "mute"],
      },
      {
        word: "burned out",
        finer: ["used up", "hollow", "spent", "running dry", "worn thin", "threadbare"],
      },
      {
        word: "numb",
        finer: ["flat", "blank", "distant", "detached", "bored", "unreal"],
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
        finer: ["low", "gloomy", "blue", "glum", "heavy", "somber"],
      },
      {
        word: "grieving",
        finer: ["bereft", "mourning", "heartbroken", "aching", "longing", "wistful"],
      },
      {
        word: "lonely",
        finer: ["isolated", "left out", "unseen", "unwanted", "homesick", "excluded"],
      },
      {
        word: "disappointed",
        finer: ["let down", "deflated", "disheartened", "discouraged", "dismayed", "crestfallen"],
      },
      {
        word: "ashamed",
        finer: ["guilty", "embarrassed", "humiliated", "regretful", "remorseful", "mortified"],
      },
      {
        word: "despairing",
        finer: ["hopeless", "worthless", "defeated", "despondent", "miserable", "empty"],
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
        finer: ["serene", "tranquil", "still", "unhurried", "settled", "unruffled"],
      },
      {
        word: "content",
        finer: ["satisfied", "comfortable", "cozy", "fulfilled", "mellow", "snug"],
      },
      {
        word: "relaxed",
        finer: ["at ease", "loose", "unwound", "soothed", "refreshed", "rested"],
      },
      {
        word: "safe",
        finer: ["secure", "protected", "sheltered", "held", "grounded", "steady"],
      },
      {
        word: "focused",
        finer: ["absorbed", "engaged", "in flow", "clear", "sharp", "present"],
      },
      {
        word: "curious",
        finer: ["interested", "intrigued", "open", "wondering", "fascinated", "receptive"],
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
        finer: ["optimistic", "encouraged", "inspired", "uplifted", "expectant", "heartened"],
      },
      {
        word: "excited",
        finer: ["eager", "thrilled", "exhilarated", "pumped", "giddy", "elated"],
      },
      {
        word: "playful",
        finer: ["amused", "silly", "mischievous", "lighthearted", "tickled", "goofy"],
      },
      {
        word: "grateful",
        finer: ["thankful", "blessed", "touched", "moved", "lucky", "humbled"],
      },
      {
        word: "proud",
        finer: ["accomplished", "confident", "capable", "triumphant", "strong", "bold"],
      },
      {
        word: "loving",
        finer: ["affectionate", "tender", "warm", "adoring", "smitten", "caring"],
      },
    ],
  },
];

export interface SampledFeeling {
  word: string;
  core: string;
  hue: string;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws `perSector` words from each sector (middle and outer ring pooled
// together), in wheel order. Seeded by the prompt token: each prompt gets a
// fresh spread, but reloading the page never reshuffles it mid-decision.
// Retires with the #32 progressive-disclosure ladder.
export function sampleFeelings(token: string, perSector = 2): SampledFeeling[] {
  const random = mulberry32(fnv1a(token));
  const picks: SampledFeeling[] = [];
  for (const sector of WHEEL) {
    const pool = sector.feelings.flatMap((f) => [f.word, ...f.finer]);
    for (let n = 0; n < perSector && pool.length > 0; n++) {
      const index = Math.floor(random() * pool.length);
      const [word] = pool.splice(index, 1);
      picks.push({ word, core: sector.core, hue: sector.hue });
    }
  }
  return picks;
}
