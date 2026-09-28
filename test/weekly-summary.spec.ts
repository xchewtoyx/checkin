import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { NotificationResult, Notifier } from "../src/notifier";
import { insertPrompt, PromptRow, upsertResponse } from "../src/store";
import {
  formatWeeklySummaryMessage,
  isoWeekIdFromMonday,
  MIN_ANSWERS_TO_SUMMARISE,
  moodDirection,
  runWeeklySummary,
  shouldRunWeeklySummary,
  summaryWeekBounds,
  tallyWeek,
} from "../src/weekly-summary";

class RecordingNotifier implements Notifier {
  readonly checkins: string[] = [];
  readonly summaries: string[] = [];
  failNextSummary = false;

  async sendCheckin(url: string): Promise<NotificationResult> {
    this.checkins.push(url);
    return { id: `checkin-${this.checkins.length}` };
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

/** Sunday 2026-06-07 20:00 BST = 19:00 UTC. */
const SUNDAY_SEND = new Date("2026-06-07T19:00:00.000Z");
/** Monday 2026-06-08 07:59 BST. */
const MONDAY_RETRY = new Date("2026-06-08T06:59:00.000Z");
/** Monday 2026-06-08 08:00 BST — retry window closed. */
const MONDAY_TOO_LATE = new Date("2026-06-08T07:00:00.000Z");
/** Sunday 2026-06-07 19:59 BST — still inside prompt day. */
const SUNDAY_TOO_EARLY = new Date("2026-06-07T18:59:00.000Z");

async function seedPrompt(
  id: string,
  scheduledFor: string,
  options: { sent?: boolean; intensity?: number } = {},
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
      feeling: "calm",
      intensity: options.intensity,
      note: null,
      confidence: null,
      vocab_era: "E5",
      observed_at: scheduledFor,
      submitted_at: scheduledFor,
    });
  }
}

describe("weekly summary message", () => {
  it("carries answer rate, mean mood, and direction when both weeks have enough data", () => {
    const current = tallyWeek(21, [7, 7, 6, 8]);
    const prior = tallyWeek(21, [5, 5, 5, 6]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "4/21 answered. Mood 7.0, up from 5.3.",
    );
  });

  it("says down when this week's rounded mean is lower", () => {
    const current = tallyWeek(18, [4, 4, 5]);
    const prior = tallyWeek(18, [6, 6, 7]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "3/18 answered. Mood 4.3, down from 6.3.",
    );
  });

  it("says same when rounded means match", () => {
    const current = tallyWeek(21, [6, 6, 6]);
    const prior = tallyWeek(21, [5.96, 6.04, 6].map(Math.round));
    expect(moodDirection(6.04, 5.96)).toBe("same");
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "3/21 answered. Mood 6.0, same as last week.",
    );
  });

  it("omits direction when the prior week is too thin", () => {
    const current = tallyWeek(21, [6, 7, 8]);
    const prior = tallyWeek(21, [3, 4]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "3/21 answered. Mood 7.0. No prior week to compare.",
    );
  });

  it("refuses a mean when there are fewer than MIN_ANSWERS_TO_SUMMARISE answers", () => {
    expect(MIN_ANSWERS_TO_SUMMARISE).toBe(3);
    const current = tallyWeek(21, [9, 9]);
    const prior = tallyWeek(21, [1, 2, 3]);
    expect(formatWeeklySummaryMessage(current, prior)).toBe(
      "Too little data to summarise (2/21).",
    );
  });

  it("treats a week with no sent prompts as too little data", () => {
    expect(formatWeeklySummaryMessage(tallyWeek(0, []), tallyWeek(0, []))).toBe(
      "Too little data to summarise (0/0).",
    );
  });
});

describe("weekly summary window", () => {
  it("opens Sunday 20:00 London and stays open until Monday 08:00", () => {
    expect(shouldRunWeeklySummary(SUNDAY_TOO_EARLY)).toBe(false);
    expect(shouldRunWeeklySummary(SUNDAY_SEND)).toBe(true);
    expect(shouldRunWeeklySummary(MONDAY_RETRY)).toBe(true);
    expect(shouldRunWeeklySummary(MONDAY_TOO_LATE)).toBe(false);
    expect(shouldRunWeeklySummary(new Date("2026-06-10T19:00:00.000Z"))).toBe(false);
  });

  it("still opens on the spring-forward Sunday at 20:00 London", () => {
    // 2026-03-29 20:00 BST = 19:00 UTC
    expect(shouldRunWeeklySummary(new Date("2026-03-29T19:00:00.000Z"))).toBe(true);
    expect(shouldRunWeeklySummary(new Date("2026-03-29T18:59:00.000Z"))).toBe(false);
  });

  it("still opens on the autumn-fallback Sunday at 20:00 London", () => {
    // 2026-10-25 20:00 GMT = 20:00 UTC
    expect(shouldRunWeeklySummary(new Date("2026-10-25T20:00:00.000Z"))).toBe(true);
    expect(shouldRunWeeklySummary(new Date("2026-10-25T19:59:00.000Z"))).toBe(false);
  });
});

describe("weekly summary bounds", () => {
  it("names the ISO week ending that Sunday", () => {
    const week = summaryWeekBounds(SUNDAY_SEND);
    expect(week.id).toBe("weekly-2026-W23");
    expect(isoWeekIdFromMonday("2026-06-01")).toBe("2026-W23");
    expect(week.start.toISOString()).toBe(
      // 2026-06-01 00:00 BST = 2026-05-31T23:00:00.000Z
      "2026-05-31T23:00:00.000Z",
    );
    expect(week.end.toISOString()).toBe("2026-06-07T23:00:00.000Z");
    expect(week.priorStart.toISOString()).toBe("2026-05-24T23:00:00.000Z");
    expect(week.priorEnd.toISOString()).toBe(week.start.toISOString());
  });

  it("Monday-morning retry still names Sunday's week", () => {
    const sunday = summaryWeekBounds(SUNDAY_SEND);
    const monday = summaryWeekBounds(MONDAY_RETRY);
    expect(monday.id).toBe(sunday.id);
    expect(monday.start.toISOString()).toBe(sunday.start.toISOString());
  });

  it("puts a New Year Sunday in the ISO week Thursday owns", () => {
    // 2026-01-04 is Sunday of 2026-W01 (Thu 2026-01-01).
    const week = summaryWeekBounds(new Date("2026-01-04T20:00:00.000Z"));
    expect(week.id).toBe("weekly-2026-W01");
    expect(isoWeekIdFromMonday("2025-12-29")).toBe("2026-W01");
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
    const result = await runWeeklySummary(env, notifier, SUNDAY_TOO_EARLY);
    expect(result).toEqual({ skipped: true, reason: "outside_window" });
    expect(notifier.summaries).toEqual([]);
  });

  it("sends one lock-screen line for the past seven days", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { intensity: 7 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z", { intensity: 7 });
    await seedPrompt("w23-c", "2026-06-03T09:00:00.000Z", { intensity: 8 });
    await seedPrompt("w23-d", "2026-06-04T09:00:00.000Z");
    await seedPrompt("w23-failed", "2026-06-05T09:00:00.000Z", { sent: false });
    await seedPrompt("w22-a", "2026-05-25T09:00:00.000Z", { intensity: 5 });
    await seedPrompt("w22-b", "2026-05-26T09:00:00.000Z", { intensity: 5 });
    await seedPrompt("w22-c", "2026-05-27T09:00:00.000Z", { intensity: 4 });

    const notifier = new RecordingNotifier();
    const result = await runWeeklySummary(env, notifier, SUNDAY_SEND);

    expect(result).toEqual({
      skipped: false,
      weekId: "weekly-2026-W23",
      message: "3/4 answered. Mood 7.3, up from 4.7.",
    });
    expect(notifier.summaries).toEqual(["3/4 answered. Mood 7.3, up from 4.7."]);
    expect(notifier.checkins).toEqual([]);
  });

  it("does not send twice for the same week", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z", { intensity: 6 });
    await seedPrompt("w23-c", "2026-06-03T09:00:00.000Z", { intensity: 6 });

    const notifier = new RecordingNotifier();
    await runWeeklySummary(env, notifier, SUNDAY_SEND);
    const second = await runWeeklySummary(env, notifier, MONDAY_RETRY);

    expect(second).toEqual({ skipped: true, reason: "already_sent" });
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

  it("says so when the week is too thin to summarise", async () => {
    await seedPrompt("w23-a", "2026-06-01T09:00:00.000Z", { intensity: 9 });
    await seedPrompt("w23-b", "2026-06-02T09:00:00.000Z");

    const notifier = new RecordingNotifier();
    const result = await runWeeklySummary(env, notifier, SUNDAY_SEND);

    expect(result).toEqual({
      skipped: false,
      weekId: "weekly-2026-W23",
      message: "Too little data to summarise (1/2).",
    });
  });
});
