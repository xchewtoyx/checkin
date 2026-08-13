import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { NoopNotifier } from "../src/notifier";
import { runScheduler } from "../src/scheduler";

describe("scheduler idempotency", () => {
  it("creates at most one prompt per window per day", async () => {
    const notifier = new NoopNotifier();
    const now = new Date("2026-08-13T09:45:00.000Z");

    await runScheduler(env, notifier, now);
    await runScheduler(env, notifier, now);

    const result = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM checkin_prompt WHERE id = ?",
    )
      .bind("prompt-2026-08-13-w0")
      .first<{ count: number }>();

    expect(result?.count).toBe(1);
  });
});
