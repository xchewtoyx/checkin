import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { WHEEL_ERA } from "../src/feelings-wheel";
import { insertPrompt, PromptRow } from "../src/store";

describe("checkin worker", () => {
  it("returns ok from /health", async () => {
    const response = await SELF.fetch("http://example.com/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await SELF.fetch("http://example.com/unknown");

    expect(response.status).toBe(404);
  });
});

describe("POST /c/:token — vocabulary validation", () => {
  const prompt: PromptRow = {
    id: "prompt-http-vocab",
    scheduled_for: "2026-09-16T09:00:00.000Z",
    sent_at: "2026-09-16T09:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    response_token: "abcdef01",
    notification_id: null,
    status: "sent",
    created_at: "2026-09-16T09:00:00.000Z",
  };

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
    await insertPrompt(env.DB, prompt);
  });

  async function post(body: Record<string, unknown>): Promise<Response> {
    return SELF.fetch("http://example.com/c/abcdef01", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects an unknown feeling with the same 400 as an invalid intensity", async () => {
    const junk = await post({ feeling: "xyzzy-not-a-feeling", intensity: 5 });
    const intensity = await post({ feeling: "calm", intensity: 11 });

    expect(junk.status).toBe(400);
    expect(intensity.status).toBe(400);
    expect(await junk.text()).toBe("Unavailable");
    expect(await intensity.text()).toBe("Unavailable");
    const stored = await env.DB.prepare(
      "SELECT id FROM checkin_response WHERE prompt_id = ?",
    )
      .bind(prompt.id)
      .first();
    expect(stored).toBeNull();
  });

  it("accepts a current wheel word and stamps WHEEL_ERA", async () => {
    const response = await post({ feeling: "calm", intensity: 4 });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Recorded");
    const stored = await env.DB.prepare(
      "SELECT feeling, vocab_era FROM checkin_response WHERE prompt_id = ?",
    )
      .bind(prompt.id)
      .first<{ feeling: string; vocab_era: string | null }>();
    expect(stored?.feeling).toBe("calm");
    expect(stored?.vocab_era).toBe(WHEEL_ERA);
  });
});
