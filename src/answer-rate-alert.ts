import {
  ANSWER_RATE_ALERT_ID,
  ANSWER_RATE_MIN_SENT_PROMPTS,
  ANSWER_RATE_THRESHOLD,
  ANSWER_RATE_WINDOW_DAYS,
} from "./config";
import { getLondonParts } from "./london-time";
import { log } from "./logger";
import { Notifier } from "./notifier";
import {
  AlertNotifiedStatus,
  PromptStatusRow,
  getAlertState,
  listPromptsInIdRange,
  upsertAlertState,
} from "./store";

export interface AnswerRateAlertEnv {
  DB: D1Database;
}

export type AnswerRateStatus = "ok" | "breach" | "unevaluable";

export type AnswerRateVerdict =
  | {
      status: "unevaluable";
      reason: "too_few_prompts";
      answered: number;
      sent: number;
      rate: null;
    }
  | {
      status: "ok" | "breach";
      answered: number;
      sent: number;
      rate: number;
    };

export type AlertNotice = "breach" | "recovery";

export function addDateKeyDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function rollingFortnight(dateKey: string): { from: string; to: string } {
  return {
    from: addDateKeyDays(dateKey, -(ANSWER_RATE_WINDOW_DAYS - 1)),
    to: dateKey,
  };
}

/**
 * G1 metric: answered / sent, expired (and overdue sent) in the
 * denominator, `failed` excluded. Still-open `sent` and `scheduled` are
 * not yet a hit or a miss, so they stay out — a mid-window cron tick
 * must not flap the standing alert.
 */
export function evaluateAnswerRate(
  prompts: PromptStatusRow[],
  now: Date,
): AnswerRateVerdict {
  const nowIso = now.toISOString();
  let answered = 0;
  let sent = 0;

  for (const prompt of prompts) {
    if (!countsTowardSent(prompt, nowIso)) {
      continue;
    }
    sent += 1;
    if (prompt.status === "answered") {
      answered += 1;
    }
  }

  if (sent < ANSWER_RATE_MIN_SENT_PROMPTS) {
    return { status: "unevaluable", reason: "too_few_prompts", answered, sent, rate: null };
  }

  const rate = answered / sent;
  return {
    status: rate >= ANSWER_RATE_THRESHOLD ? "ok" : "breach",
    answered,
    sent,
    rate,
  };
}

function countsTowardSent(prompt: PromptStatusRow, nowIso: string): boolean {
  if (prompt.status === "failed" || prompt.status === "scheduled") {
    return false;
  }
  if (prompt.status === "sent") {
    return prompt.expires_at !== null && prompt.expires_at < nowIso;
  }
  return prompt.status === "answered" || prompt.status === "expired";
}

export function noticeForTransition(
  previous: AlertNotifiedStatus | null,
  current: AnswerRateStatus,
): AlertNotice | null {
  if (current === "unevaluable") {
    return null;
  }
  if (current === "breach" && previous !== "breach") {
    return "breach";
  }
  if (current === "ok" && previous === "breach") {
    return "recovery";
  }
  return null;
}

export function formatRatePercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatAlertMessage(
  notice: AlertNotice,
  verdict: Extract<AnswerRateVerdict, { rate: number }>,
  window: { from: string; to: string },
): string {
  const figure = `${verdict.answered}/${verdict.sent} (${formatRatePercent(verdict.rate)})`;
  const span = `${window.from} → ${window.to}`;
  const threshold = formatRatePercent(ANSWER_RATE_THRESHOLD);
  if (notice === "breach") {
    return `Answer rate ${figure} over ${span} is below the G1 ${threshold} threshold.`;
  }
  return `Answer rate ${figure} over ${span} recovered above the G1 ${threshold} threshold.`;
}

export async function runAnswerRateAlert(
  env: AnswerRateAlertEnv,
  notifier: Notifier,
  now: Date,
): Promise<AnswerRateVerdict> {
  const today = getLondonParts(now).dateKey;
  const window = rollingFortnight(today);
  const prompts = await listPromptsInIdRange(
    env.DB,
    `prompt-${window.from}`,
    `prompt-${addDateKeyDays(window.to, 1)}`,
  );
  const verdict = evaluateAnswerRate(prompts, now);
  const previous = await getAlertState(env.DB, ANSWER_RATE_ALERT_ID);
  const previousStatus = previous?.notified_status ?? null;
  const notice = noticeForTransition(previousStatus, verdict.status);

  log("info", "answer_rate_evaluated", {
    status: verdict.status,
    answered: verdict.answered,
    sent: verdict.sent,
    rate: verdict.rate ?? -1,
    window_from: window.from,
    window_to: window.to,
  });

  let notifiedStatus = previousStatus;
  if (notice && verdict.rate !== null) {
    try {
      await notifier.sendAlert("checkin answer rate", formatAlertMessage(notice, verdict, window));
      notifiedStatus = notice === "breach" ? "breach" : "ok";
      log("info", "answer_rate_alert_sent", { notice });
    } catch (error) {
      log("error", "answer_rate_alert_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  } else if (verdict.status !== "unevaluable") {
    notifiedStatus = verdict.status;
  }

  await upsertAlertState(env.DB, {
    id: ANSWER_RATE_ALERT_ID,
    notified_status: notifiedStatus,
    evaluated_at: now.toISOString(),
    answered: verdict.answered,
    sent: verdict.sent,
    rate: verdict.rate,
    window_from: window.from,
    window_to: window.to,
  });

  return verdict;
}
