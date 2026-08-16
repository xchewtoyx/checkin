import { describe, expect, it } from "vitest";
import { renderCheckinPage } from "../src/checkin-page";
import { LABEL_BUDGET, WHEEL } from "../src/feelings-wheel";
import { PromptRow } from "../src/store";

const allWords = WHEEL.flatMap((s) => [
  s.core,
  ...s.feelings.flatMap((f) => [f.word, ...f.finer]),
]);

describe("taxonomy structure (issue #31)", () => {
  it("is a perfectly regular 6×6×6 tree", () => {
    expect(WHEEL).toHaveLength(6);
    for (const sector of WHEEL) {
      expect(sector.feelings, sector.core).toHaveLength(6);
      for (const feeling of sector.feelings) {
        expect(feeling.finer, `${sector.core} > ${feeling.word}`).toHaveLength(6);
      }
    }
  });

  it("counts 6 cores, 36 middle, 216 outer, 258 total", () => {
    const middles = WHEEL.flatMap((s) => s.feelings.map((f) => f.word));
    const outers = WHEEL.flatMap((s) => s.feelings.flatMap((f) => f.finer));
    expect(middles).toHaveLength(36);
    expect(outers).toHaveLength(216);
    expect(allWords).toHaveLength(258);
  });

  it("has no duplicate word anywhere in the tree, case-insensitively", () => {
    const seen = new Map<string, string>();
    for (const word of allWords) {
      const key = word.toLowerCase();
      expect(seen.get(key), `duplicate word: ${word}`).toBeUndefined();
      seen.set(key, word);
    }
    expect(seen.size).toBe(258);
  });

  it("keeps every label within the chip budget", () => {
    for (const word of allWords) {
      expect(word.length, word).toBeLessThanOrEqual(LABEL_BUDGET);
      expect(word).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
  });

  it("carries sector metadata: distinct hues and both valences", () => {
    const hues = new Set(WHEEL.map((s) => s.hue));
    expect(hues.size).toBe(6);
    for (const sector of WHEEL) {
      expect(sector.hue).toMatch(/^#[0-9a-f]{6}$/);
      expect(["pleasant", "unpleasant"]).toContain(sector.valence);
    }
    const valences = new Set(WHEEL.map((s) => s.valence));
    expect(valences.size).toBe(2);
  });
});

describe("renderCheckinPage — progressive-disclosure ladder (#32)", () => {
  const prompt: PromptRow = {
    id: "prompt-2026-08-14-w0",
    scheduled_for: "2026-08-14T09:00:00.000Z",
    sent_at: "2026-08-14T09:00:00.000Z",
    expires_at: "2026-08-15T01:00:00.000Z",
    response_token: "deadbeef",
    notification_id: null,
    status: "sent",
    created_at: "2026-08-14T09:00:00.000Z",
  };
  const now = new Date("2026-08-14T10:00:00.000Z");

  it("renders exactly the 6 cores in row 1, tinted by their own hue", () => {
    const html = renderCheckinPage(prompt, now);

    const row0Match = html.match(/<div class="chips" id="chips-0"[^>]*>(.*?)<\/div>/s);
    expect(row0Match).not.toBeNull();
    const row0 = row0Match![1];

    expect(row0.match(/data-word="/g)).toHaveLength(6);
    for (const sector of WHEEL) {
      expect(row0).toContain(`data-word="${sector.core}"`);
      expect(row0).toContain(`--h:${sector.hue}`);
    }
  });

  it("renders rows 2 and 3 empty and hidden pre-JS", () => {
    const html = renderCheckinPage(prompt, now);

    expect(html).toMatch(/<section id="row-1" class="ladder-row">/);
    expect(html).toMatch(/<section id="row-2" class="ladder-row">/);
    expect(html).toContain('<div class="chips" id="chips-1" role="group" aria-label="More specific feelings"></div>');
    expect(html).toContain('<div class="chips" id="chips-2" role="group" aria-label="Most specific feelings"></div>');
  });

  it("embeds the full taxonomy for client-side row reveal, with no new queries", () => {
    const html = renderCheckinPage(prompt, now);

    const allWords = WHEEL.flatMap((s) => [
      s.core,
      ...s.feelings.flatMap((f) => [f.word, ...f.finer]),
    ]);
    for (const word of allWords) {
      expect(html).toContain(`"${word}"`);
    }
  });

  it("renders an optional, unset-by-default confidence toggle", () => {
    const html = renderCheckinPage(prompt, now);

    expect(html).toContain('data-confidence="weak"');
    expect(html).toContain('data-confidence="strong"');
    expect(html.match(/data-confidence="weak" aria-pressed="false"/)).not.toBeNull();
    expect(html.match(/data-confidence="strong" aria-pressed="false"/)).not.toBeNull();
  });

  it("renders the expired page for an unusable prompt", () => {
    const html = renderCheckinPage({ ...prompt, status: "expired" }, now);

    expect(html).toContain("This link has expired");
    expect(html).not.toContain("data-word");
  });
});
