import {
  DEFAULT_WINDOWS,
  PROMPT_DAY_END,
  PROMPT_DAY_START,
  ScheduleWindow,
  parseClock,
  parseWindows,
} from "./config";
import { getLondonParts, londonInstant } from "./london-time";
import { log } from "./logger";
import { Notifier } from "./notifier";
import { createResponseToken } from "./token";
import {
  PromptRow,
  expireStalePrompts,
  getPromptById,
  insertPrompt,
  promptId,
  updatePromptStatus,
} from "./store";
import { expiresAtFrom } from "./record-response";

export interface SchedulerEnv {
  DB: D1Database;
  SCHEDULE_WINDOWS?: string;
  BASE_URL: string;
  PUSHOVER_TOKEN?: string;
  PUSHOVER_USER?: string;
}

export function pickTargetMinutes(window: ScheduleWindow, dateKey: string): number {
  const span = Math.max(window.endMinutes - window.startMinutes, 1);
  const input = `${dateKey}:${window.index}`;
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % span;
  }
  return window.startMinutes + hash;
}

export function isWithinPromptDay(minutesOfDay: number): boolean {
  const start = parseClock(PROMPT_DAY_START);
  const end = parseClock(PROMPT_DAY_END);
  return minutesOfDay >= start && minutesOfDay < end;
}

async function sendPrompt(
  env: SchedulerEnv,
  notifier: Notifier,
  row: PromptRow,
  now: Date,
): Promise<void> {
  const checkinUrl = `${env.BASE_URL.replace(/\/$/, "")}/c/${row.response_token}`;
  try {
    const notification = await notifier.sendCheckin(checkinUrl);
    const sentAt = now.toISOString();
    await updatePromptStatus(env.DB, row.id, "sent", {
      sent_at: sentAt,
      expires_at: expiresAtFrom(now),
      notification_id: notification.id,
    });
    log("info", "prompt_sent", { prompt_id: row.id, notification_id: notification.id });
  } catch (error) {
    await updatePromptStatus(env.DB, row.id, "failed");
    log("error", "notification_failed", {
      prompt_id: row.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function runScheduler(
  env: SchedulerEnv,
  notifier: Notifier,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const expired = await expireStalePrompts(env.DB, nowIso);
  if (expired > 0) {
    log("info", "prompts_expired", { count: expired });
  }

  const london = getLondonParts(now);
  if (!isWithinPromptDay(london.minutesOfDay)) {
    log("info", "scheduler_skipped", { reason: "outside_active_hours" });
    return;
  }

  const windows = parseWindows(env.SCHEDULE_WINDOWS ?? DEFAULT_WINDOWS);

  for (const window of windows) {
    if (london.minutesOfDay < window.startMinutes || london.minutesOfDay >= window.endMinutes) {
      continue;
    }

    const targetMinutes = pickTargetMinutes(window, london.dateKey);
    if (london.minutesOfDay < targetMinutes) {
      continue;
    }

    const id = promptId(london.dateKey, window.index);
    const existing = await getPromptById(env.DB, id);
    if (existing && existing.status !== "scheduled") {
      continue;
    }

    if (existing?.status === "scheduled") {
      await sendPrompt(env, notifier, existing, now);
      continue;
    }

    const scheduledFor = londonInstant(london.dateKey, targetMinutes, now).toISOString();
    const row: PromptRow = {
      id,
      scheduled_for: scheduledFor,
      sent_at: null,
      expires_at: null,
      response_token: createResponseToken(),
      notification_id: null,
      status: "scheduled",
      created_at: nowIso,
    };

    const inserted = await insertPrompt(env.DB, row);
    if (!inserted) {
      continue;
    }

    await sendPrompt(env, notifier, row, now);
  }
}
