import { describe, expect, it } from "vitest";
import { renderCheckinPage } from "../src/checkin-page";
import { WHEEL, sampleFeelings } from "../src/feelings-wheel";
import { PromptRow } from "../src/store";

describe("sampleFeelings", () => {
  it("draws two distinct words from each sector in wheel order", () => {
    const picks = sampleFeelings("abc123");

    expect(picks).toHaveLength(12);
    expect(picks.map((p) => p.core)).toEqual(
      WHEEL.flatMap((s) => [s.core, s.core]),
    );
    expect(new Set(picks.map((p) => p.word)).size).toBe(12);
    for (const pick of picks) {
      const sector = WHEEL.find((s) => s.core === pick.core);
      const pool = sector?.feelings.flatMap((f) => [f.word, ...f.finer]) ?? [];
      expect(pool).toContain(pick.word);
    }
  });

  it("is deterministic per token and varies across tokens", () => {
    expect(sampleFeelings("token-a")).toEqual(sampleFeelings("token-a"));

    const words = (token: string) =>
      sampleFeelings(token)
        .map((p) => p.word)
        .join(",");
    const variants = new Set(["a1", "b2", "c3", "d4", "e5"].map(words));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe("renderCheckinPage", () => {
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

  it("renders the token-seeded 12-chip grid", () => {
    const html = renderCheckinPage(prompt, now);

    expect(html.match(/data-feeling="/g)).toHaveLength(12);
    for (const pick of sampleFeelings(prompt.response_token)) {
      expect(html).toContain(`data-feeling="${pick.word}"`);
      expect(html).toContain(`--h:${pick.hue}`);
    }
  });

  it("renders the expired page for an unusable prompt", () => {
    const html = renderCheckinPage({ ...prompt, status: "expired" }, now);

    expect(html).toContain("This link has expired");
    expect(html).not.toContain("data-feeling");
  });
});
