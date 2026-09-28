import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateAnswerRate,
  formatAlertMessage,
  noticeForTransition,
  rollingFortnight,
  runAnswerRateAlert,
} from "../src/answer-rate-alert";
import {
  ANSWER_RATE_ALERT_ID,
  ANSWER_RATE_MIN_SENT_PROMPTS,
  ANSWER_RATE_THRESHOLD,
} from "../src/config";
import { NotificationResult, Notifier } from "../src/notifier";
import { PromptRow, PromptStatus, PromptStatusRow, getAlertState, insertPrompt } from "../src/store";

function row(status: PromptStatus, expiresAt: string | null = "2026-09-15T20:00:00.000Z"): PromptStatusRow {
  return { id: "prompt-test", status, expires_at: expiresAt };
}

function closed(answered: number, expired: number): PromptStatusRow[] {
  return [
    ...Array.from({ length: answered }, () => row("answered")),
    ...Array.from({ length: expired }, () => row("expired")),
  ];
}

class RecordingNotifier implements Notifier {
  readonly alerts: { title: string; message: string }[] = [];
  failNext = false;

  async sendCheckin(_url: string): Promise<NotificationResult> {
    return { id: "noop" };
  }

  async sendAlert(title: string, message: string): Promise<NotificationResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("pushover down");
    }
    this.alerts.push({ title, message });
    return { id: `alert-${this.alerts.length}` };
  }
}

describe("evaluateAnswerRate", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("reproduces the G1 fortnight as a pass against 75%", () => {
    const verdict = evaluateAnswerRate(closed(35, 6), now);
    expect(verdict).toEqual({
      status: "ok",
      answered: 35,
      sent: 41,
      rate: 35 / 41,
    });
    expect(verdict.status === "ok" && verdict.rate >= ANSWER_RATE_THRESHOLD).toBe(true);
  });

  it("breaches when the same denominator falls below 75%", () => {
    const verdict = evaluateAnswerRate(closed(30, 11), now);
    expect(verdict.status).toBe("breach");
    expect(verdict.sent).toBe(41);
    expect(verdict.answered).toBe(30);
    expect(verdict.rate).toBeCloseTo(30 / 41);
  });

  it("treats exactly 75% as ok, not a breach", () => {
    const verdict = evaluateAnswerRate(closed(3, 1), now);
    expect(verdict.status).toBe("unevaluable");

    const evaluable = evaluateAnswerRate(closed(21, 7), now);
    expect(evaluable).toEqual({
      status: "ok",
      answered: 21,
      sent: 28,
      rate: 0.75,
    });
  });

  it("reports unevaluable rather than breach when sent prompts are below the floor", () => {
    const tooFew = ANSWER_RATE_MIN_SENT_PROMPTS - 1;
    const verdict = evaluateAnswerRate(closed(0, tooFew), now);
    expect(verdict).toEqual({
      status: "unevaluable",
      reason: "too_few_prompts",
      answered: 0,
      sent: tooFew,
      rate: null,
    });
  });

  it("reports unevaluable for an empty window", () => {
    expect(evaluateAnswerRate([], now).status).toBe("unevaluable");
  });

  it("excludes failed and scheduled prompts from the denominator", () => {
    const prompts = [
      ...closed(14, 0),
      row("failed"),
      row("scheduled"),
    ];
    const verdict = evaluateAnswerRate(prompts, now);
    expect(verdict.status).toBe("ok");
    expect(verdict.sent).toBe(14);
    expect(verdict.answered).toBe(14);
  });

  it("excludes still-open sent prompts so a mid-window tick cannot flap", () => {
    const prompts = [
      ...closed(14, 0),
      row("sent", "2026-09-29T12:00:00.000Z"),
      row("sent", null),
    ];
    const verdict = evaluateAnswerRate(prompts, now);
    expect(verdict.sent).toBe(14);
    expect(verdict.answered).toBe(14);
  });

  it("counts overdue sent as unanswered", () => {
    const prompts = [
      ...closed(13, 0),
      row("sent", "2026-09-28T11:00:00.000Z"),
    ];
    const verdict = evaluateAnswerRate(prompts, now);
    expect(verdict.status).toBe("ok");
    expect(verdict.sent).toBe(14);
    expect(verdict.answered).toBe(13);
  });
});

describe("noticeForTransition", () => {
  it("notifies once on first breach and not again while it holds", () => {
    expect(noticeForTransition(null, "breach")).toBe("breach");
    expect(noticeForTransition("ok", "breach")).toBe("breach");
    expect(noticeForTransition("breach", "breach")).toBeNull();
  });

  it("notifies once on recovery and not again while ok", () => {
    expect(noticeForTransition("breach", "ok")).toBe("recovery");
    expect(noticeForTransition("ok", "ok")).toBeNull();
    expect(noticeForTransition(null, "ok")).toBeNull();
  });

  it("does not treat unevaluable as breach or recovery", () => {
    expect(noticeForTransition(null, "unevaluable")).toBeNull();
    expect(noticeForTransition("ok", "unevaluable")).toBeNull();
    expect(noticeForTransition("breach", "unevaluable")).toBeNull();
  });
});

describe("rollingFortnight", () => {
  it("is fourteen London calendar days inclusive, matching G1", () => {
    expect(rollingFortnight("2026-08-26")).toEqual({
      from: "2026-08-13",
      to: "2026-08-26",
    });
  });
});

describe("formatAlertMessage", () => {
  it("names the rate with its denominator", () => {
    const verdict = { status: "breach" as const, answered: 30, sent: 41, rate: 30 / 41 };
    expect(formatAlertMessage("breach", verdict, { from: "2026-09-15", to: "2026-09-28" })).toBe(
      "Answer rate 30/41 (73.2%) over 2026-09-15 → 2026-09-28 is below the G1 75.0% threshold.",
    );
    expect(formatAlertMessage("recovery", { ...verdict, status: "ok", answered: 35, rate: 35 / 41 }, {
      from: "2026-09-15",
      to: "2026-09-28",
    })).toBe(
      "Answer rate 35/41 (85.4%) over 2026-09-15 → 2026-09-28 recovered above the G1 75.0% threshold.",
    );
  });
});

describe("runAnswerRateAlert", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_alert_state").run();
    await env.DB.prepare("DELETE FROM checkin_response").run();
    await env.DB.prepare("DELETE FROM checkin_prompt").run();
  });

  async function seed(
    dateKey: string,
    windowIndex: number,
    status: PromptStatus,
    expiresAt = "2026-09-15T20:00:00.000Z",
  ): Promise<void> {
    const id = `prompt-${dateKey}-w${windowIndex}`;
    const row: PromptRow = {
      id,
      scheduled_for: `${dateKey}T08:00:00.000Z`,
      sent_at: `${dateKey}T08:00:00.000Z`,
      expires_at: expiresAt,
      response_token: `tok-${id}`,
      notification_id: "n",
      status,
      created_at: `${dateKey}T08:00:00.000Z`,
    };
    const inserted = await insertPrompt(env.DB, row);
    expect(inserted).toBe(true);
  }

  async function seedClosed(answered: number, expired: number): Promise<void> {
    // 2026-09-15 is the first day of the 2026-09-28 fortnight.
    let remainingAnswered = answered;
    let remainingExpired = expired;
    for (let day = 15; day <= 28 && (remainingAnswered > 0 || remainingExpired > 0); day += 1) {
      const dateKey = `2026-09-${String(day).padStart(2, "0")}`;
      for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
        if (remainingAnswered > 0) {
          await seed(dateKey, windowIndex, "answered");
          remainingAnswered -= 1;
          continue;
        }
        if (remainingExpired > 0) {
          await seed(dateKey, windowIndex, "expired");
          remainingExpired -= 1;
        }
      }
    }
  }

  it("sends one breach notice and does not re-notify on the next run", async () => {
    await seedClosed(30, 11);
    const notifier = new RecordingNotifier();

    const first = await runAnswerRateAlert(env, notifier, now);
    expect(first.status).toBe("breach");
    expect(notifier.alerts).toHaveLength(1);
    expect(notifier.alerts[0].title).toBe("checkin answer rate");
    expect(notifier.alerts[0].message).toContain("30/41");
    expect(notifier.alerts[0].message).toContain("below the G1 75.0% threshold");

    const second = await runAnswerRateAlert(env, notifier, now);
    expect(second.status).toBe("breach");
    expect(notifier.alerts).toHaveLength(1);

    const state = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
    expect(state?.notified_status).toBe("breach");
  });

  it("sends one recovery notice after a recorded breach", async () => {
    await seedClosed(30, 11);
    const notifier = new RecordingNotifier();
    await runAnswerRateAlert(env, notifier, now);
    expect(notifier.alerts).toHaveLength(1);

    await env.DB.prepare("UPDATE checkin_prompt SET status = 'answered' WHERE status = 'expired'").run();

    const recovered = await runAnswerRateAlert(env, notifier, now);
    expect(recovered.status).toBe("ok");
    expect(notifier.alerts).toHaveLength(2);
    expect(notifier.alerts[1].message).toContain("recovered above the G1 75.0% threshold");

    const again = await runAnswerRateAlert(env, notifier, now);
    expect(again.status).toBe("ok");
    expect(notifier.alerts).toHaveLength(2);
  });

  it("does not notify or flip hysteresis when the window is unevaluable", async () => {
    await seed("2026-09-28", 0, "expired");
    const notifier = new RecordingNotifier();

    const verdict = await runAnswerRateAlert(env, notifier, now);
    expect(verdict.status).toBe("unevaluable");
    expect(notifier.alerts).toHaveLength(0);

    const state = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
    expect(state?.notified_status).toBeNull();
    expect(state?.sent).toBe(1);
  });

  it("keeps a recorded breach across an unevaluable window", async () => {
    await seedClosed(30, 11);
    const notifier = new RecordingNotifier();
    await runAnswerRateAlert(env, notifier, now);
    expect(notifier.alerts).toHaveLength(1);

    await env.DB.prepare("DELETE FROM checkin_prompt").run();
    await seed("2026-09-28", 0, "expired");

    const thin = await runAnswerRateAlert(env, notifier, now);
    expect(thin.status).toBe("unevaluable");
    expect(notifier.alerts).toHaveLength(1);

    const state = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
    expect(state?.notified_status).toBe("breach");
  });

  it("ignores prompts outside the rolling fortnight", async () => {
    await seedClosed(14, 0);
    await seed("2026-09-14", 0, "expired");
    await seed("2026-09-29", 0, "expired");
    const notifier = new RecordingNotifier();

    const verdict = await runAnswerRateAlert(env, notifier, now);
    expect(verdict.status).toBe("ok");
    expect(verdict.sent).toBe(14);
    expect(notifier.alerts).toHaveLength(0);
  });

  it("does not record a breach if the notice fails to send", async () => {
    await seedClosed(30, 11);
    const notifier = new RecordingNotifier();
    notifier.failNext = true;

    const verdict = await runAnswerRateAlert(env, notifier, now);
    expect(verdict.status).toBe("breach");
    expect(notifier.alerts).toHaveLength(0);

    const state = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
    expect(state?.notified_status).toBeNull();

    await runAnswerRateAlert(env, notifier, now);
    expect(notifier.alerts).toHaveLength(1);
    const retried = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
    expect(retried?.notified_status).toBe("breach");
  });
});
