import { WHEEL, type WheelSector } from "./feelings-wheel";

/**
 * Words offered in earlier vocabulary eras that are not nodes on the
 * current WHEEL. Sourced from the era-mapping tables (and the E2 cores
 * sentence) in docs/feelings-vocabulary.md; asserted against that
 * document so this list cannot drift as a second hand-maintained
 * vocabulary.
 */
export const ERA_WORDS: readonly string[] = [
  "accomplished",
  "afraid",
  "aggrieved",
  "appreciated",
  "bewildered",
  "bold",
  "bored",
  "brave",
  "cheerful",
  "crawly",
  "creative",
  "cynical",
  "delighted",
  "detached",
  "determined",
  "dismissive",
  "effective",
  "elated",
  "enthusiastic",
  "fired up",
  "flat",
  "frazzled",
  "gone dark",
  "good",
  "hollow",
  "in control",
  "indifferent",
  "insulted",
  "irritable",
  "jangly",
  "judgy",
  "left out",
  "lively",
  "locked in",
  "mad",
  "motivated",
  "pensive",
  "powerful",
  "reflective",
  "reluctant",
  "remorseful",
  "respected",
  "running dry",
  "saturated",
  "scared",
  "scratchy",
  "secure",
  "self-assured",
  "self-doubting",
  "small",
  "spent",
  "stressed",
  "stretched",
  "switched off",
  "thoughtful",
  "threadbare",
  "tranquil",
  "trusting",
  "unwanted",
  "valued",
  "walled off",
  "withdrawn",
  "worn thin",
  "wounded",
  "wrung out",
];

export function wheelWords(wheel: readonly WheelSector[] = WHEEL): string[] {
  return wheel.flatMap((sector) => [
    sector.core,
    ...sector.feelings.flatMap((feeling) => [feeling.word, ...feeling.finer]),
  ]);
}

const ALLOWED_FEELINGS: ReadonlySet<string> = new Set([
  ...wheelWords(),
  ...ERA_WORDS,
]);

export function isAllowedFeeling(feeling: string): boolean {
  return ALLOWED_FEELINGS.has(feeling);
}

/**
 * Pull every word the vocabulary doc records as having been offered:
 * left-hand columns of the era-mapping tables, plus E2's six cores.
 */
export function eraWordsFromVocabularyDoc(markdown: string): string[] {
  const words = new Set<string>();
  const lines = markdown.split("\n");
  let inMappingTable = false;

  for (const line of lines) {
    if (/^\| [^|\n]*\bword\b[^|\n]* \| [^|\n]*\bnode\b/i.test(line)) {
      inMappingTable = true;
      continue;
    }
    if (!inMappingTable) {
      continue;
    }
    if (!line.startsWith("|")) {
      inMappingTable = false;
      continue;
    }
    if (/^\|[\s-|]+\|/.test(line)) {
      continue;
    }
    const first = line.split("|")[1]?.trim() ?? "";
    if (!first) {
      continue;
    }
    for (const part of first.split(",")) {
      const word = part.trim();
      if (word) {
        words.add(word);
      }
    }
  }

  const coresPara = markdown.match(/E2's six cores map: ([^.]+)\./);
  if (coresPara) {
    for (const match of coresPara[1].matchAll(/\*([a-z][a-z -]*)\*/g)) {
      words.add(match[1]);
    }
  }

  return [...words];
}
