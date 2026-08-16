import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const exportToken = "test-export-token";

describe("responses export API", () => {
  it("returns 401 without bearer token", async () => {
    const response = await SELF.fetch("http://example.com/api/responses");
    expect(response.status).toBe(401);
  });

  it("returns filtered JSON with bearer token", async () => {
    await env.DB.prepare(
      `INSERT INTO checkin_prompt
       (id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "prompt-export-1",
        "2026-08-13T09:00:00.000Z",
        "2026-08-13T10:00:00.000Z",
        "2026-08-14T02:00:00.000Z",
        "abc123",
        "noop",
        "answered",
        "2026-08-13T09:00:00.000Z",
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO checkin_response (id, prompt_id, feeling, intensity, note, confidence, observed_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "response-export-1",
        "prompt-export-1",
        "calm",
        6,
        "on the train",
        "strong",
        "2026-08-13T10:00:00.000Z",
        "2026-08-13T10:01:00.000Z",
      )
      .run();

    const response = await SELF.fetch(
      "http://example.com/api/responses?from=2026-08-13T00:00:00.000Z&to=2026-08-13T23:59:59.000Z",
      {
        headers: { authorization: `Bearer ${exportToken}` },
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{
      feeling: string;
      note: string | null;
      confidence: string | null;
    }>;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
    expect(payload[0].feeling).toBe("calm");
    expect(payload[0].note).toBe("on the train");
    expect(payload[0].confidence).toBe("strong");
  });

  it("exports legacy concatenated rows unchanged, with note null", async () => {
    await env.DB.prepare(
      `INSERT INTO checkin_prompt
       (id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "prompt-export-legacy",
        "2026-08-12T09:00:00.000Z",
        "2026-08-12T10:00:00.000Z",
        "2026-08-13T02:00:00.000Z",
        "legacyabc123",
        "noop",
        "answered",
        "2026-08-12T09:00:00.000Z",
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO checkin_response (id, prompt_id, feeling, intensity, observed_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "response-export-legacy",
        "prompt-export-legacy",
        "anxious: before the meeting",
        8,
        "2026-08-12T10:00:00.000Z",
        "2026-08-12T10:01:00.000Z",
      )
      .run();

    const response = await SELF.fetch(
      "http://example.com/api/responses?from=2026-08-12T00:00:00.000Z&to=2026-08-12T23:59:59.000Z",
      {
        headers: { authorization: `Bearer ${exportToken}` },
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{
      feeling: string;
      note: string | null;
      confidence: string | null;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0].feeling).toBe("anxious: before the meeting");
    expect(payload[0].note).toBeNull();
    expect(payload[0].confidence).toBeNull();
  });
});
