import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { NotificationResult, Notifier } from "../src/notifier";
import { insertPrompt, PromptRow, upsertResponse } from "../src/store";
import {
  formatWeeklySummaryMessage,
  MIN_ANSWERS_TO_SUMMARISE,
  runWeeklySummary,
  shouldRunWeeklySummary,
  signedMood,
  summaryWeekBounds,
  tallyWeek,
} from "../src/weekly-summary";

class RecordingNotifier implements Notifier {
  readonly deliversNotifications = true;
  readonly summaries: string[] = [];
  failNextSummary = false;

  async sendCheckin(_url: string): Promise<NotificationResult> {
    return { id: "checkin" };
  }

  async sendAlert(_title: string, _message: string): Promise<NotificationResult> {
    return { id: "alert" };
  }

  async sendWeeklySummary(message: string): Promise<NotificationResult> {
    if (this.failNextSummary) {
      this.failNextSummary = false;
      throw new Error("pushover_unavailable");
    }
    this.summaries.push(message);
    return { id: `weekly-${this.summaries.length}` };
  }
}

const SUNDAY_SEND = new Date("2026-06-07T19:00:00.000Z");
const MONDAY_RETRY = new Date("2026-06-08T06:59:00.000Z");
const MONDAY_TOO_LATE = new Date("2026-06-08T07:00:00.000Z");
const SUNDAY_TOO_EARLY = new Date("2026-06-07T18:59:00.000Z");

async function seedPrompt(
  id: string,
  scheduledFor: string,
  options: { sent?: boolean; feeling?: string; intensity?: number } = {},
): Promise<void> {
  const sent = options.sent !== false;
  const row: PromptRow = {
    id,
    scheduled_for: scheduledFor,
    sent_at: sent ? scheduledFor : null,
    expires_at: sent ? "2026-06-08T12:00:00.000Z" : null,
    response_token: id.replace(/[^a-f0-9]/g, "").padEnd(8, "a").slice(0, 8),
    notification_id: sent ? "n1" : null,
    status: sent ? (options.intensity !== undefined ? "answered" : "expired") : "failed",
    created_at: scheduledFor,
  };
  await insertPrompt(env.DB, row);
  if (options.intensity !== undefined) {
    await upsertResponse(env.DB, {
      id: `response-${id}`,
      prompt_id: id,
      feeling: options.feeling ?? "calm",
      intensity: options.intensity,
      note: null,
      confidence: null,
      vocab_era: "E5",
      observed_at: scheduledFor,
      submitted_at: scheduledFor,
    });
  }
}

describe("signed mood", () => {
  it("treats intense anger as worse than mild contentment", () => {
    expect(signedMood("furious", 9)).toBe(-9);
    expect(signedMood("calm", 3)).toBe(3);
    const angry = tallyWeek(3, [
      { feeling: "furious", intensity: 9 },
      { feeling: "furious", intensity: 9 },
      { feeling: "furious", intensity: 8 },
    ]);
    const calm = tallyWeek(3, [
      { feeling: "calm", intensity: 3 },
      { feeling: "calm", intensity: 3 },
      { feeling: "calm", intensity: 2 },
    ]);
    expect(formatWeeklySummaryMessage(angry, calm)).toBe(
      "3/3 answered. -8.7, down from +2.7.",
    );
  });
});

describe("weekly summary message", () => {
  it("carries answer rate, signed mood, and direction", () => {
    const current = tallyWeek(21, [
      { feeling: "calm", intensity: 7 },
      { feeling: "grateful", intensity: 7 },
      { feeling: "hopeful", intensity: 6 },
      { feeling: "anxious", intensity: 4 },
    ]);
    const prior = tallyWeek(21, [
      { feeling: "anxious", intensity: 6 },
      { feeling: "anxious", intensity: 6 },
      { feeling: "sad", intensity: 5 },
    ]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "4/21 answered. +4.0, up from -5.7.",
    );
  });

  it("says same when rounded signed means match", () => {
    const current = tallyWeek(21, [
      { feeling: "calm", intensity: 4 },
      { feeling: "calm", intensity: 4 },
      { feeling: "calm", intensity: 4 },
    ]);
    const prior = tallyWeek(21, [
      { feeling: "calm", intensity: 4 },
      { feeling: "calm", intensity: 4 },
      { feeling: "calm", intensity: 4 },
    ]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "3/21 answered. +4.0, same as last week.",
    );
  });

  it("omits direction when the prior week is too thin", () => {
    const current = tallyWeek(21, [
      { feeling: "calm", intensity: 6 },
      { feeling: "calm", intensity: 7 },
      { feeling: "calm", intensity: 8 },
    ]);
    const prior = tallyWeek(21, [
      { feeling: "calm", intensity: 3 },
      { feeling: "calm", intensity: 4 },
    ]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "3/21 answered. +7.0. No prior week to compare.",
    );
  });

  it("refuses a mean below MIN_ANSWERS_TO_SUMMARISE", () => {
    expect(MIN_ANSWERS_TO_SUMMARISE).toBe(3);
    const current = tallyWeek(21, [
      { feeling: "calm", intensity: 9 },
      { feeling: "calm", intensity: 9 },
    ]);
    expect(formatWeeklySummaryMessage(current, tallyWeek(21, []))).toBe(
      "Too little data to summarise (2/21).",
    );
  });
});

describe("weekly summary window", () => {
  it("opens Sunday 20:00 London and closes Monday 08:00", () => {
    expect(shouldRunWeeklySummary(SUNDAY_TOO_EARLY)).toBe(false);
    expect(shouldRunWeeklySummary(SUNDAY_SEND)).toBe(true);
    expect(shouldRunWeeklySummary(MONDAY_RETRY)).toBe(true);
    expect(shouldRunWeeklySummary(MONDAY_TOO_LATE)).toBe(false);
  });

  it("names the London week ending that Sunday", () => {
    const week = summaryWeekBounds(SUNDAY_SEND);
    expect(week.id).toBe("weekly-2026-06-01");
    expect(week.start.toISOString()).toBe("2026-05-31T23:00:00.000Z");
    expect(summaryWeekBounds(MONDAY_RETRY).id).toBe(week.id);
  });
});

describe("runWeeklySummary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
    await env.DB.prepare("DELETE FROM weekly_summary").run();
  });

  it("skips outside the Sunday/Monday window", async () => {
    const notifier = new RecordingNotifier();
    expect(await runWeeklySummary(env, notifier, SUNDAY_TOO_EARLY)).toEqual({
      skipped: true,
      reason: "outside_window",
    });
    expect(notifier.summaries).toEqual([]);
  });

  it("sends one lock-screen line for the past seven days", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { feeling: "calm", intensity: 7 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z", { feeling: "calm", intensity: 7 });
    await seedPrompt("w23-c", "2026-06-03T09:00:00.000Z", { feeling: "furious", intensity: 8 });
    await seedPrompt("w23-d", "2026-06-04T09:00:00.000Z");
    await seedPrompt("w23-failed", "2026-06-05T09:00:00.000Z", { sent: false });
    await seedPrompt("w22-a", "2026-05-25T09:00:00.000Z", { feeling: "anxious", intensity: 5 });
    await seedPrompt("w22-b", "2026-05-26T09:00:00.000Z", { feeling: "anxious", intensity: 5 });
    await seedPrompt("w22-c", "2026-05-27T09:00:00.000Z", { feeling: "sad", intensity: 4 });

    const notifier = new RecordingNotifier();
    const result = await runWeeklySummary(env, notifier, SUNDAY_SEND);

    expect(result).toEqual({
      skipped: false,
      weekId: "weekly-2026-06-01",
      message: "3/4 answered. +2.0, up from -4.7.",
    });
    expect(notifier.summaries).toEqual(["3/4 answered. +2.0, up from -4.7."]);
  });

  it("does not send twice for the same week", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-c", "2026-06-03T09:00:00.000Z", { intensity: 6 });

    const notifier = new RecordingNotifier();
    await runWeeklySummary(env, notifier, SUNDAY_SEND);
    expect(await runWeeklySummary(env, notifier, MONDAY_RETRY)).toEqual({
      skipped: true,
      reason: "already_sent",
    });
    expect(notifier.summaries).toHaveLength(1);
  });

  it("retries after a failed send", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-c", "2026-06-03T09:00:00.000Z", { intensity: 6 });

    const notifier = new RecordingNotifier();
    notifier.failNextSummary = true;
    await expect(runWeeklySummary(env, notifier, SUNDAY_SEND)).rejects.toThrow(
      "pushover_unavailable",
    );

    const retry = await runWeeklySummary(env, notifier, MONDAY_RETRY);
    expect(retry.skipped).toBe(false);
    expect(notifier.summaries).toHaveLength(1);
  });
});
