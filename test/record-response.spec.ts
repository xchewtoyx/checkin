import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { recordResponse } from "../src/record-response";
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

describe("recordResponse — page-stamped vocabulary era", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("stores the era stamped into the submitting page", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-1", "token-era-1"));

    const result = await recordResponse(env.DB, {
      token: "token-era-1",
      feeling: "fearful",
      intensity: 5,
      vocabEra: "E5",
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    expect(result.ok).toBe(true);
    const row = await fetchResponseRow("response-prompt-era-1");
    expect(row?.vocab_era).toBe("E5");
  });

  it("stores null when the submission carries no era (pre-stamp page)", async () => {
    await insertPrompt(env.DB, makePrompt("prompt-era-2", "token-era-2"));

    await recordResponse(env.DB, {
      token: "token-era-2",
      feeling: "calm",
      intensity: 3,
      now: new Date("2026-08-15T09:10:00.000Z"),
    });

    const row = await fetchResponseRow("response-prompt-era-2");
    expect(row?.vocab_era).toBeNull();
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
      vocabEra: "E5",
      now,
    });

    const row = await fetchResponseRow("response-prompt-era-4");
    expect(row?.feeling).toBe("perplexed");
    expect(row?.vocab_era).toBe("E5");
  });
});
