import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WHEEL_ERA } from "../src/feelings-wheel";
import { recordDecline, recordManualResponse, recordResponse } from "../src/record-response";
import { insertPrompt, PromptRow } from "../src/store";

function makePrompt(id: string, token: string): PromptRow {
  return {
    id,
    scheduled_for: "2026-08-15T09:00:00.000Z",
    sent_at: "2026-08-15T09:00:00.000Z",
    expires_at: "2026-08-16T01:00:00.000Z",
    response_token: token,
    notification_id: null,
    status: "sent",
    created_at: "2026-08-15T09:00:00.000Z",
  };
}

async function fetchResponseRow(id: string) {
  return env.DB.prepare(
    "SELECT feeling, intensity, note, confidence, vocab_era FROM checkin_response WHERE id = ?",
  )
    .bind(id)
    .first<{
      feeling: string;
      intensity: number;
      note: string | null;
      confidence: string | null;
      vocab_era: string | null;
    }>();
}

describe("recordResponse — note and confidence", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("stores the note separately, without concatenating it into feeling", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-note-1", "token-note-1"));

    const result = await recordResponse(env.DB, {
      token: "token-note-1",
      feeling: "irritated",
      intensity: 6,
      note: "before the meeting",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-note-1");
    expect(row?.feeling).toBe("irritated");
    expect(row?.note).toBe("before the meeting");
  });

  it("stores note as null when absent or blank", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-note-2", "token-note-2"));

    await recordResponse(env.DB, {
      token: "token-note-2",
      feeling: "calm",
      intensity: 3,
      note: "   ",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    const row = await fetchResponseRow("response-prompt-note-2");
    expect(row?.note).toBeNull();
  });

  it.each(["weak", "strong"] as const)(
    "round-trips confidence = %s",
    async (confidence) => {
      const id = `prompt-conf-${confidence}`;
      await insertPrompt(env.DB, makePrompt(id, `token-conf-${confidence}`));

      const result = await recordResponse(env.DB, {
        token: `token-conf-${confidence}`,
        feeling: "hopeful",
        intensity: 7,
        confidence,
        now: new Date("2026-08-15T09:10:00.000Z"),
      });

      expect(result.ok).toBe(true);
      const row = await fetchResponseRow(`response-${id}`);
      expect(row?.confidence).toBe(confidence);
    },
  );

  it("stores confidence as null when not provided", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-conf-none", "token-conf-none"));

    await recordResponse(env.DB, {
      token: "token-conf-none",
      feeling: "content",
      intensity: 5,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    const row = await fetchResponseRow("response-prompt-conf-none");
    expect(row?.confidence).toBeNull();
  });

  it("treats an explicit null confidence the same as unset", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-conf-null", "token-conf-null"));

    const result = await recordResponse(env.DB, {
      token: "token-conf-null",
      feeling: "content",
      intensity: 5,
      confidence: null,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-conf-null");
    expect(row?.confidence).toBeNull();
  });

  it("rejects an invalid confidence value", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-conf-bad", "token-conf-bad"));

    const result = await recordResponse(env.DB, {
      token: "token-conf-bad",
      feeling: "content",
      intensity: 5,
      confidence: "sort-of",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    const row = await fetchResponseRow("response-prompt-conf-bad");
    expect(row).toBeNull();
  });

  it("updates note and confidence on re-submission (Change answer)", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-resubmit", "token-resubmit"));
    const now = new Date("2026-08-15T09:10:00.000Z");

    await recordResponse(env.DB, {
      token: "token-resubmit",
      feeling: "anxious",
      intensity: 8,
      note: "first pass",
      confidence: "weak",
      now,
    });
    await recordResponse(env.DB, {
      token: "token-resubmit",
      feeling: "calm",
      intensity: 4,
      note: "changed my mind",
      confidence: "strong",
      now,
    });

    const row = await fetchResponseRow("response-prompt-resubmit");
    expect(row?.feeling).toBe("calm");
    expect(row?.note).toBe("changed my mind");
    expect(row?.confidence).toBe("strong");
  });
});

describe("recordResponse — vocabulary era stamp", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("stores vocabulary era equal to WHEEL_ERA on submit", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-1", "token-era-1"));

    const result = await recordResponse(env.DB, {
      token: "token-era-1",
      feeling: "fearful",
      intensity: 5,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-era-1");
    expect(row?.vocab_era).toBe(WHEEL_ERA);
  });

  it("stores the era stamped into the submitting page when it differs", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-page", "token-era-page"));

    const result = await recordResponse(env.DB, {
      token: "token-era-page",
      feeling: "fearful",
      intensity: 5,
      vocabEra: "E4",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-era-page");
    expect(row?.vocab_era).toBe("E4");
  });

  it("discards a malformed era to null without rejecting the check-in", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-3", "token-era-3"));

    const result = await recordResponse(env.DB, {
      token: "token-era-3",
      feeling: "content",
      intensity: 2,
      vocabEra: "not-an-era",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-era-3");
    expect(row?.feeling).toBe("content");
    expect(row?.vocab_era).toBeNull();
  });

  it("re-stamps the era of the page used for a re-submission", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-4", "token-era-4"));
    const now = new Date("2026-08-15T09:10:00.000Z");

    await recordResponse(env.DB, {
      token: "token-era-4",
      feeling: "bewildered",
      intensity: 6,
      vocabEra: "E4",
      now,
    });
    await recordResponse(env.DB, {
      token: "token-era-4",
      feeling: "perplexed",
      intensity: 6,
      vocabEra: WHEEL_ERA,
      now,
    });

    const row = await fetchResponseRow("response-prompt-era-4");
    expect(row?.feeling).toBe("perplexed");
    expect(row?.vocab_era).toBe(WHEEL_ERA);
  });
});

describe("recordResponse — vocabulary allowlist", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a current WHEEL word and stores it unchanged", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-vocab-current", "token-vocab-current"));

    const result = await recordResponse(env.DB, {
      token: "token-vocab-current",
      feeling: "overstimmed",
      intensity: 5,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-vocab-current");
    expect(row?.feeling).toBe("overstimmed");
  });

  it("accepts a retired E3 word and stores it verbatim", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-vocab-e3", "token-vocab-e3"));

    const result = await recordResponse(env.DB, {
      token: "token-vocab-e3",
      feeling: "frazzled",
      intensity: 7,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-vocab-e3");
    expect(row?.feeling).toBe("frazzled");
  });

  it("accepts an E1 word and stores it verbatim", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-vocab-e1", "token-vocab-e1"));

    const result = await recordResponse(env.DB, {
      token: "token-vocab-e1",
      feeling: "stressed",
      intensity: 8,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-vocab-e1");
    expect(row?.feeling).toBe("stressed");
  });

  it("rejects a junk string the same way as an out-of-range intensity", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-vocab-junk", "token-vocab-junk"));
    const now = new Date("2026-08-15T09:10:00.000Z");

    const junk = await recordResponse(env.DB, {
      token: "token-vocab-junk",
      feeling: "xyzzy-not-a-feeling",
      intensity: 5,
      now,
    });
    const intensity = await recordResponse(env.DB, {
      token: "token-vocab-junk",
      feeling: "calm",
      intensity: 11,
      now,
    });

    expect(junk).toEqual({ ok: false, reason: "invalid" });
    expect(intensity).toEqual({ ok: false, reason: "invalid" });
    expect(await fetchResponseRow("response-prompt-vocab-junk")).toBeNull();
  });

  it("logs the rejection per N4 without the feeling value", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-vocab-log", "token-vocab-log"));
    const junkFeeling = "xyzzy-not-a-feeling";
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    const result = await recordResponse(env.DB, {
      token: "token-vocab-log",
      feeling: junkFeeling,
      intensity: 4,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(lines.join("\n")).not.toContain(junkFeeling);

    const rejected = lines.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as { event?: string; reason?: string };
        return parsed.event === "response_rejected" ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(rejected).toEqual([
      expect.objectContaining({ event: "response_rejected", reason: "invalid" }),
    ]);
    expect(JSON.stringify(rejected[0])).not.toContain(junkFeeling);
  });
});

describe("recordDecline", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("marks the prompt declined without writing a response row", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-skip-1", "token-skip-1"));

    const result = await recordDecline(env.DB, {
      token: "token-skip-1",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result).toEqual({ ok: true });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-1")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("declined");
    expect(await fetchResponseRow("response-prompt-skip-1")).toBeNull();
  });

  it("removes a prior answer so a decline is not also a measurement", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-skip-2", "token-skip-2"));
    const now = new Date("2026-08-15T09:10:00.000Z");
    await recordResponse(env.DB, {
      token: "token-skip-2",
      feeling: "calm",
      intensity: 4,
      now,
    });

    const result = await recordDecline(env.DB, { token: "token-skip-2", now });

    expect(result).toEqual({ ok: true });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-2")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("declined");
    expect(await fetchResponseRow("response-prompt-skip-2")).toBeNull();
  });

  it("lets an answer after a decline become the measurement", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-skip-3", "token-skip-3"));
    const now = new Date("2026-08-15T09:10:00.000Z");
    await recordDecline(env.DB, { token: "token-skip-3", now });

    const result = await recordResponse(env.DB, {
      token: "token-skip-3",
      feeling: "hopeful",
      intensity: 6,
      now,
    });

    expect(result).toEqual({ ok: true });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-3")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("answered");
    const row = await fetchResponseRow("response-prompt-skip-3");
    expect(row?.feeling).toBe("hopeful");
    expect(row?.intensity).toBe(6);
  });

  it("rejects a decline after expiry without asking why", async () => {
    await insertPrompt(env.DB, {
      ...makePrompt("prompt-skip-4", "token-skip-4"),
      status: "expired",
    });

    const result = await recordDecline(env.DB, {
      token: "token-skip-4",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-4")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("expired");
  });

  it("is idempotent on a second decline", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-skip-5", "token-skip-5"));
    const now = new Date("2026-08-15T09:10:00.000Z");
    await recordDecline(env.DB, { token: "token-skip-5", now });
    const again = await recordDecline(env.DB, { token: "token-skip-5", now });
    expect(again).toEqual({ ok: true });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-5")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("declined");
  });

  it("leaves a declined prompt declined after the link expires", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-skip-6", "token-skip-6"));
    await recordDecline(env.DB, {
      token: "token-skip-6",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    const late = await recordDecline(env.DB, {
      token: "token-skip-6",
      now: new Date("2026-08-16T02:00:00.000Z"),
    });

    expect(late).toEqual({ ok: false, reason: "expired" });
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-skip-6")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("declined");
  });
});

describe("recordManualResponse", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  const now = new Date("2026-08-20T12:00:00.000Z");

  async function fetchManualRow(id: string) {
    return env.DB.prepare(
      `SELECT id, prompt_id, feeling, intensity, note, observed_at, submitted_at
       FROM checkin_response WHERE id = ?`,
    )
      .bind(id)
      .first<{
        id: string;
        prompt_id: string | null;
        feeling: string;
        intensity: number;
        note: string | null;
        observed_at: string;
        submitted_at: string;
      }>();
  }

  it("stores a backdated row with null prompt_id and a live submitted_at", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "overwhelmed",
      intensity: 8,
      note: "the day I missed",
      observedAt: "2026-08-15T10:00:00.000Z",
      now,
      id: "manual-backdated-1",
    });

    expect(result).toEqual({ ok: true, id: "manual-backdated-1" });
    const row = await fetchManualRow("manual-backdated-1");
    expect(row?.prompt_id).toBeNull();
    expect(row?.feeling).toBe("overwhelmed");
    expect(row?.intensity).toBe(8);
    expect(row?.note).toBe("the day I missed");
    expect(row?.observed_at).toBe("2026-08-15T10:00:00.000Z");
    expect(row?.submitted_at).toBe(now.toISOString());
  });

  it("treats a timezone-less datetime as Europe/London", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "calm",
      intensity: 4,
      observedAt: "2026-08-15T10:00",
      now,
      id: "manual-london-naive",
    });

    expect(result.ok).toBe(true);
    const row = await fetchManualRow("manual-london-naive");
    // 10:00 BST = 09:00 UTC
    expect(row?.observed_at).toBe("2026-08-15T09:00:00.000Z");
    expect(row?.submitted_at).toBe(now.toISOString());
  });

  it("treats an evening timezone-less datetime as Europe/London", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "tired",
      intensity: 5,
      observedAt: "2026-08-15T23:00",
      now,
      id: "manual-london-evening",
    });

    expect(result.ok).toBe(true);
    const row = await fetchManualRow("manual-london-evening");
    // 23:00 BST = 22:00 UTC
    expect(row?.observed_at).toBe("2026-08-15T22:00:00.000Z");
  });

  it("accepts observed_at at the start of the 7-day London window", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "tired",
      intensity: 5,
      observedAt: "2026-08-13T00:00",
      now,
      id: "manual-window-edge",
    });

    expect(result.ok).toBe(true);
    const row = await fetchManualRow("manual-window-edge");
    expect(row?.observed_at).toBe("2026-08-12T23:00:00.000Z");
  });

  it("rejects observed_at older than seven London calendar days", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "tired",
      intensity: 5,
      observedAt: "2026-08-12T22:59:00.000Z",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "out_of_range" });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM checkin_response",
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("rejects a future observed_at", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "hopeful",
      intensity: 6,
      observedAt: "2026-08-20T13:00:00.000Z",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("rejects a missing or unparseable observed_at", async () => {
    const empty = await recordManualResponse(env.DB, {
      feeling: "calm",
      intensity: 3,
      observedAt: "  ",
      now,
    });
    const junk = await recordManualResponse(env.DB, {
      feeling: "calm",
      intensity: 3,
      observedAt: "last Tuesday",
      now,
    });
    expect(empty).toEqual({ ok: false, reason: "invalid" });
    expect(junk).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an unknown feeling the same way as the prompted path", async () => {
    const result = await recordManualResponse(env.DB, {
      feeling: "xyzzy-not-a-feeling",
      intensity: 5,
      observedAt: "2026-08-15T10:00:00.000Z",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not attach to or alter an existing prompt", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-untouched", "token-untouched"));

    const result = await recordManualResponse(env.DB, {
      feeling: "calm",
      intensity: 3,
      observedAt: "2026-08-15T10:00:00.000Z",
      now,
      id: "manual-untouched",
    });

    expect(result.ok).toBe(true);
    const prompt = await env.DB.prepare("SELECT status FROM checkin_prompt WHERE id = ?")
      .bind("prompt-untouched")
      .first<{ status: string }>();
    expect(prompt?.status).toBe("sent");
    const linked = await env.DB.prepare(
      "SELECT id FROM checkin_response WHERE prompt_id = ?",
    )
      .bind("prompt-untouched")
      .first();
    expect(linked).toBeNull();
  });
});
