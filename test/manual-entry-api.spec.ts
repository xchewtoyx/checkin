import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MANUAL_BACKDATE_DAYS } from "../src/config";
import { insertPrompt, PromptRow } from "../src/store";

const exportToken = "test-export-token";

function bearerHeaders(): HeadersInit {
  return { authorization: `Bearer ${exportToken}` };
}

function basicHeaders(): HeadersInit {
  return { authorization: `Basic ${btoa(`anyone:${exportToken}`)}` };
}

function isoDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchRow(id?: string) {
  const query = id
    ? env.DB.prepare("SELECT * FROM checkin_response WHERE id = ?").bind(id)
    : env.DB.prepare("SELECT * FROM checkin_response ORDER BY submitted_at DESC LIMIT 1");
  return query.first<{
    id: string;
    prompt_id: string | null;
    feeling: string;
    intensity: number;
    observed_at: string;
    submitted_at: string;
  }>();
}

describe("GET/POST /checkin", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  it("redirects cleartext requests to https before issuing a challenge", async () => {
    const response = await SELF.fetch("http://example.com/checkin", {
      redirect: "manual",
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://example.com/checkin");
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("challenges unauthenticated browsers with Basic", async () => {
    const response = await SELF.fetch("https://example.com/checkin");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("renders the catch-up form with a stated backdate window", async () => {
    const response = await SELF.fetch("https://example.com/checkin", {
      headers: bearerHeaders(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const html = await response.text();
    expect(html).toContain("How were you?");
    expect(html).toContain('id="observed-at"');
    expect(html).toContain(`past ${MANUAL_BACKDATE_DAYS} London days`);
    expect(html).not.toContain("Not now");
  });

  it("accepts Basic auth with the export token as the password", async () => {
    const response = await SELF.fetch("https://example.com/checkin", {
      headers: basicHeaders(),
    });
    expect(response.status).toBe(200);
  });

  it("records a manual response with null prompt_id and a backdated observed_at", async () => {
    const before = Date.now();
    const observedAt = isoDaysAgo(2);
    const response = await SELF.fetch("https://example.com/checkin", {
      method: "POST",
      headers: { ...bearerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        feeling: "overwhelmed",
        intensity: 7,
        observed_at: observedAt,
        prompt_id: "prompt-should-be-ignored",
      }),
    });
    const after = Date.now();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Recorded");
    const row = await fetchRow();
    expect(row?.feeling).toBe("overwhelmed");
    expect(row?.prompt_id).toBeNull();
    expect(row?.id.startsWith("manual-")).toBe(true);
    expect(row?.observed_at).toBe(new Date(observedAt).toISOString());
    const submitted = Date.parse(row?.submitted_at ?? "");
    expect(submitted).toBeGreaterThanOrEqual(before);
    expect(submitted).toBeLessThanOrEqual(after);
    expect(row?.submitted_at).not.toBe(row?.observed_at);
  });

  it("export readback attributes the entry to the observed day, not the submit day", async () => {
    const observedAt = isoDaysAgo(2);
    const posted = await SELF.fetch("https://example.com/checkin", {
      method: "POST",
      headers: { ...bearerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        feeling: "overwhelmed",
        intensity: 7,
        observed_at: observedAt,
      }),
    });
    expect(posted.status).toBe(200);

    const observedDay = await SELF.fetch(
      `https://example.com/api/responses?from=${encodeURIComponent(observedAt)}&to=${encodeURIComponent(observedAt)}`,
      { headers: bearerHeaders() },
    );
    expect(observedDay.status).toBe(200);
    const onObservedDay = (await observedDay.json()) as Array<{
      id: string;
      prompt_id: string | null;
      feeling: string;
      observed_at: string;
      submitted_at: string;
    }>;
    expect(onObservedDay).toHaveLength(1);
    expect(onObservedDay[0].prompt_id).toBeNull();
    expect(onObservedDay[0].id.startsWith("manual-")).toBe(true);
    expect(onObservedDay[0].feeling).toBe("overwhelmed");
    expect(onObservedDay[0].observed_at).toBe(new Date(observedAt).toISOString());
    expect(onObservedDay[0].submitted_at).not.toBe(onObservedDay[0].observed_at);

    const afterObserved = new Date(Date.parse(observedAt) + 1000).toISOString();
    const submitDay = await SELF.fetch(
      `https://example.com/api/responses?from=${encodeURIComponent(afterObserved)}`,
      { headers: bearerHeaders() },
    );
    const onSubmitDay = (await submitDay.json()) as Array<{ id: string }>;
    expect(onSubmitDay.map((row) => row.id)).not.toContain(onObservedDay[0].id);
  });

  it("rejects a POST without observed_at", async () => {
    const response = await SELF.fetch("https://example.com/checkin", {
      method: "POST",
      headers: { ...bearerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ feeling: "calm", intensity: 4 }),
    });
    expect(response.status).toBe(400);
    expect(await fetchRow()).toBeNull();
  });

  it("rejects observed_at older than the stated window", async () => {
    const response = await SELF.fetch("https://example.com/checkin", {
      method: "POST",
      headers: { ...bearerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        feeling: "calm",
        intensity: 4,
        observed_at: isoDaysAgo(8),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("observed_at out of range");
    expect(await fetchRow()).toBeNull();
  });

  it("rejects a future observed_at", async () => {
    const response = await SELF.fetch("https://example.com/checkin", {
      method: "POST",
      headers: { ...bearerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        feeling: "calm",
        intensity: 4,
        observed_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("observed_at out of range");
  });

  it("leaves the prompted path's observed_at bound to the prompt", async () => {
    const prompt: PromptRow = {
      id: "prompt-manual-isolation",
      scheduled_for: "2026-08-15T09:00:00.000Z",
      sent_at: "2026-08-15T09:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      response_token: "abcdefab",
      notification_id: null,
      status: "sent",
      created_at: "2026-08-15T09:00:00.000Z",
    };
    await insertPrompt(env.DB, prompt);

    const response = await SELF.fetch("http://example.com/c/abcdefab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feeling: "calm",
        intensity: 4,
        observed_at: "2026-08-10T00:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT prompt_id, observed_at FROM checkin_response WHERE prompt_id = ?",
    )
      .bind(prompt.id)
      .first<{ prompt_id: string; observed_at: string }>();
    expect(row?.prompt_id).toBe(prompt.id);
    expect(row?.observed_at).toBe(prompt.sent_at);
  });
});
