import { describe, expect, it } from "vitest";
import vocabularyDoc from "../docs/feelings-vocabulary.md?raw";
import { WHEEL } from "../src/feelings-wheel";
import {
  ERA_WORDS,
  eraWordsFromVocabularyDoc,
  isAllowedFeeling,
  wheelWords,
} from "../src/vocabulary";

describe("vocabulary allowlist", () => {
  it("ERA_WORDS is the retired projection of docs/feelings-vocabulary.md", () => {
    const documented = eraWordsFromVocabularyDoc(vocabularyDoc);
    const current = new Set(wheelWords(WHEEL));
    const retiredFromDoc = documented
      .filter((word) => !current.has(word))
      .sort();

    expect([...ERA_WORDS].sort()).toEqual(retiredFromDoc);
  });

  it("accepts every current WHEEL word and every documented era word", () => {
    for (const word of wheelWords()) {
      expect(isAllowedFeeling(word), word).toBe(true);
    }
    for (const word of eraWordsFromVocabularyDoc(vocabularyDoc)) {
      expect(isAllowedFeeling(word), word).toBe(true);
    }
  });

  it("rejects strings that were never offered", () => {
    expect(isAllowedFeeling("xyzzy-not-a-feeling")).toBe(false);
    expect(isAllowedFeeling("stressed out")).toBe(false);
    expect(isAllowedFeeling("Frazzled")).toBe(false);
  });
});
