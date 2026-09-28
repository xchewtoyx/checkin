import { describe, expect, it } from "vitest";
import {
  DeliveredPrompt,
  ExtractFacts,
  HealthFacts,
  assessHealth,
  deliveredPrompt,
  latestDueSlot,
  manifestHead,
  parsePromptDateKey,
  renderHealthStrip,
  trailingLondonWindow,
} from "../src/health-strip";

const OBSERVED = "2026-09-28T12:00:00.000Z";

function facts(overrides: Partial<HealthFacts>): HealthFacts {
  return {
    observedAt: OBSERVED,
    delivered: [],
    extract: { kind: "no-bucket" },
    ...overrides,
  };
}

function closedWindowPrompts(
  answered: number,
  expired: number,
  dateKey = "2026-09-20",
): DeliveredPrompt[] {
  const prompts: DeliveredPrompt[] = [];
  for (let index = 0; index < answered; index += 1) {
    prompts.push(deliveredPrompt(dateKey, "answered", `${dateKey}T18:00:00.000Z`));
  }
  for (let index = 0; index < expired; index += 1) {
    prompts.push(deliveredPrompt(dateKey, "expired", `${dateKey}T18:00:00.000Z`));
  }
  return prompts;
}

function currentExtract(): ExtractFacts {
  return {
    kind: "bucket",
    manifests: [
      manifestHead("2026-09-28", "030000", "2026-09-28T03:05:00.000Z", false),
    ],
    unreadableKeys: [],
  };
}

describe("parsePromptDateKey", () => {
  it("reads the London civil date from a prompt id", () => {
    expect(parsePromptDateKey("prompt-2026-09-20-w2")).toBe("2026-09-20");
  });

  it("rejects ids that are not prompt-<date>-wN", () => {
    expect(parsePromptDateKey("prompt-export-1")).toBeNull();
  });
});

describe("trailingLondonWindow", () => {
  it("is fourteen London civil days ending on the London date of observedAt", () => {
    const window = trailingLondonWindow(new Date(OBSERVED));
    expect(window).toEqual({
      start: "2026-09-15",
      end: "2026-09-28",
      dayCount: 14,
    });
  });

  it("uses London's date after 23:00 UTC during BST, not the UTC date", () => {
    const window = trailingLondonWindow(new Date("2026-09-28T23:30:00.000Z"));
    expect(window.end).toBe("2026-09-29");
    expect(window.start).toBe("2026-09-16");
  });
});

describe("latestDueSlot", () => {
  it("treats the 15:00 UTC slot as still writing at 15:10", () => {
    expect(latestDueSlot(new Date("2026-09-28T15:10:00.000Z"))).toEqual({
      extractionDate: "2026-09-28",
      objectTimestamp: "030000",
    });
  });

  it("marks the 15:00 UTC slot due at the end of the 15-minute write window", () => {
    expect(latestDueSlot(new Date("2026-09-28T15:15:00.000Z"))).toEqual({
      extractionDate: "2026-09-28",
      objectTimestamp: "150000",
    });
  });
});

describe("assessHealth answer rate", () => {
  it("bands 1/3 as friction failure, never a bare percentage", () => {
    const strip = assessHealth(
      facts({
        delivered: closedWindowPrompts(1, 2),
        extract: currentExtract(),
      }),
    );
    expect(strip.answer).toEqual({
      kind: "measured",
      answered: 1,
      sent: 3,
      percent: 33,
      band: "failure",
    });
    expect(strip.glance).toBe("attention");
    const html = renderHealthStrip(strip);
    expect(html).toContain("1/3 · 33% · Friction failure");
    expect(html).toContain("14 London days · 2026-09-15 – 2026-09-28");
    expect(html).not.toMatch(/>33%</);
  });

  it("bands 3/4 as healthy", () => {
    const strip = assessHealth(
      facts({
        delivered: closedWindowPrompts(3, 1),
        extract: currentExtract(),
      }),
    );
    expect(strip.answer).toMatchObject({
      kind: "measured",
      answered: 3,
      sent: 4,
      percent: 75,
      band: "healthy",
    });
    expect(strip.glance).toBe("healthy");
  });

  it("bands 1/2 as friction review", () => {
    const strip = assessHealth(facts({ delivered: closedWindowPrompts(1, 1) }));
    expect(strip.answer).toMatchObject({
      kind: "measured",
      answered: 1,
      sent: 2,
      percent: 50,
      band: "friction",
    });
  });

  it("shows 0/5 as measured zero, not absent", () => {
    const strip = assessHealth(facts({ delivered: closedWindowPrompts(0, 5) }));
    expect(strip.answer).toEqual({
      kind: "measured",
      answered: 0,
      sent: 5,
      percent: 0,
      band: "failure",
    });
    expect(renderHealthStrip(strip)).toContain("0/5 · 0% · Friction failure");
  });

  it("shows absent when nothing closed in the window, not 0/0", () => {
    const strip = assessHealth(facts({}));
    expect(strip.answer).toEqual({ kind: "absent", reason: "no-sends" });
    expect(strip.extract).toEqual({ kind: "absent", reason: "no-bucket" });
    expect(strip.glance).toBe("absent");
    const html = renderHealthStrip(strip);
    expect(html).toContain("data-answer=\"absent\"");
    expect(html).toContain("data-extract=\"absent\"");
    expect(html).toContain("No prompts closed in this window");
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toContain("0/0");
  });

  it("excludes an open sent prompt and includes a closed sent prompt as unanswered", () => {
    const strip = assessHealth(
      facts({
        delivered: [
          deliveredPrompt("2026-09-20", "answered", "2026-09-20T18:00:00.000Z"),
          deliveredPrompt("2026-09-21", "sent", "2026-09-29T00:00:00.000Z"),
          deliveredPrompt("2026-09-22", "sent", "2026-09-28T11:00:00.000Z"),
        ],
      }),
    );
    expect(strip.answer).toMatchObject({
      kind: "measured",
      answered: 1,
      sent: 2,
      percent: 50,
      band: "friction",
    });
  });

  it("ignores closed prompts whose London date sits outside the window", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T23:30:00.000Z",
        delivered: [
          deliveredPrompt("2026-09-15", "answered"),
          deliveredPrompt("2026-09-16", "expired"),
        ],
      }),
    );
    expect(strip.window).toEqual({
      start: "2026-09-16",
      end: "2026-09-29",
      dayCount: 14,
    });
    expect(strip.answer).toMatchObject({
      kind: "measured",
      answered: 0,
      sent: 1,
      percent: 0,
      band: "failure",
    });
  });
});

describe("assessHealth extract freshness", () => {
  it("is current when the due slot has landed inside the 15:00 grace window", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T15:10:00.000Z",
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-28", "030000", "2026-09-28T03:05:00.000Z", false),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      freshness: { kind: "current" },
      integrity: "match",
    });
  });

  it("flags a missed 15:00 slot after the write window even when the morning extract is within 24h", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T15:20:00.000Z",
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-28", "030000", "2026-09-28T03:05:00.000Z", false),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      freshness: {
        kind: "missed-slot",
        expected: { extractionDate: "2026-09-28", objectTimestamp: "150000" },
      },
    });
    expect(renderHealthStrip(strip)).toContain("missed 2026-09-28 15:00 UTC");
  });

  it("treats an extract exactly 24h old as current when the due slot is present", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T15:20:00.000Z",
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-28", "150000", "2026-09-27T15:20:00.000Z", false),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      freshness: { kind: "current" },
    });
  });

  it("flags older-than-24h one second past the freshness bound", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T15:20:00.000Z",
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-28", "150000", "2026-09-27T15:19:59.000Z", false),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      freshness: { kind: "older-than-24h" },
    });
    expect(renderHealthStrip(strip)).toContain("older than 24h");
  });

  it("combines a missed slot with an extract older than 24h", () => {
    const strip = assessHealth(
      facts({
        observedAt: "2026-09-28T15:20:00.000Z",
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-27", "150000", "2026-09-27T15:05:00.000Z", false),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      freshness: {
        kind: "missed-slot-and-older-than-24h",
        expected: { extractionDate: "2026-09-28", objectTimestamp: "150000" },
      },
    });
  });

  it("surfaces a source-count mismatch on the latest head", () => {
    const strip = assessHealth(
      facts({
        extract: {
          kind: "bucket",
          manifests: [
            manifestHead("2026-09-28", "030000", "2026-09-28T03:05:00.000Z", true),
          ],
          unreadableKeys: [],
        },
      }),
    );
    expect(strip.extract).toMatchObject({
      kind: "landed",
      integrity: "mismatch",
    });
    expect(strip.glance).toBe("attention");
    expect(renderHealthStrip(strip)).toContain("Source count mismatch");
  });

  it("shows unreadable when every probed object failed to parse", () => {
    const strip = assessHealth(
      facts({
        extract: {
          kind: "bucket",
          manifests: [],
          unreadableKeys: [
            "raw/cloudflare/checkins/manifests/extraction_date=2026-09-28/030000.json",
          ],
        },
      }),
    );
    expect(strip.extract).toEqual({
      kind: "unreadable",
      key: "raw/cloudflare/checkins/manifests/extraction_date=2026-09-28/030000.json",
    });
    expect(strip.glance).toBe("attention");
  });

  it("shows absent extract when the bucket is empty", () => {
    const strip = assessHealth(
      facts({
        extract: { kind: "bucket", manifests: [], unreadableKeys: [] },
      }),
    );
    expect(strip.extract).toEqual({ kind: "absent", reason: "no-manifest" });
  });
});
