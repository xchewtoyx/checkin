export interface WheelFeeling {
  word: string;
  finer: string[];
}

export interface WheelSector {
  core: string;
  hue: string;
  feelings: WheelFeeling[];
}

// Placeholder approximation of the Willcox feeling wheel (issue #12).
// Swapping in the vocabulary transcribed from the real wheel is a pure
// data edit — nothing else in the codebase depends on the words.
export const WHEEL: WheelSector[] = [
  {
    core: "peaceful",
    hue: "#2ba193",
    feelings: [
      { word: "calm", finer: ["serene", "tranquil"] },
      { word: "content", finer: ["satisfied", "comfortable"] },
      { word: "relaxed", finer: ["mellow", "at ease"] },
      { word: "thoughtful", finer: ["reflective", "pensive"] },
      { word: "loving", finer: ["warm", "affectionate"] },
      { word: "trusting", finer: ["secure", "open"] },
    ],
  },
  {
    core: "joyful",
    hue: "#d9a514",
    feelings: [
      { word: "happy", finer: ["delighted", "cheerful"] },
      { word: "excited", finer: ["eager", "enthusiastic"] },
      { word: "playful", finer: ["amused", "lighthearted"] },
      { word: "energetic", finer: ["lively", "refreshed"] },
      { word: "optimistic", finer: ["hopeful", "inspired"] },
      { word: "grateful", finer: ["thankful", "appreciative"] },
    ],
  },
  {
    core: "powerful",
    hue: "#4f9d55",
    feelings: [
      { word: "confident", finer: ["self-assured", "capable"] },
      { word: "proud", finer: ["accomplished", "fulfilled"] },
      { word: "courageous", finer: ["brave", "determined"] },
      { word: "valued", finer: ["appreciated", "respected"] },
      { word: "creative", finer: ["motivated", "focused"] },
      { word: "successful", finer: ["effective", "in control"] },
    ],
  },
  {
    core: "mad",
    hue: "#d64550",
    feelings: [
      { word: "irritable", finer: ["annoyed", "impatient"] },
      { word: "angry", finer: ["furious", "seething"] },
      { word: "frustrated", finer: ["exasperated", "blocked"] },
      { word: "hurt", finer: ["wounded", "let down"] },
      { word: "resentful", finer: ["bitter", "jealous"] },
      { word: "critical", finer: ["cynical", "dismissive"] },
    ],
  },
  {
    core: "scared",
    hue: "#e8871e",
    feelings: [
      { word: "anxious", finer: ["worried", "uneasy"] },
      { word: "stressed", finer: ["overwhelmed", "pressured"] },
      { word: "insecure", finer: ["inadequate", "self-doubting"] },
      { word: "confused", finer: ["bewildered", "lost"] },
      { word: "helpless", finer: ["stuck", "powerless"] },
      { word: "rejected", finer: ["excluded", "unwanted"] },
    ],
  },
  {
    core: "sad",
    hue: "#4a6fdc",
    feelings: [
      { word: "low", finer: ["down", "gloomy"] },
      { word: "lonely", finer: ["isolated", "left out"] },
      { word: "tired", finer: ["drained", "weary"] },
      { word: "bored", finer: ["indifferent", "flat"] },
      { word: "guilty", finer: ["remorseful", "regretful"] },
      { word: "ashamed", finer: ["embarrassed", "deflated"] },
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
