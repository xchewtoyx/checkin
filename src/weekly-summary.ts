import { getLondonParts, londonInstant } from "./london-time";
import { log } from "./logger";
import { Notifier } from "./notifier";
import {
  claimWeeklySummary,
  completeWeeklySummary,
  hasOpenSentPromptsBetween,
  listResponsesForSentPromptsBetween,
  listSentPromptsBetween,
  recordWeeklySummaryNotification,
  releaseWeeklySummary,
  storeWeeklySummaryMessage,
} from "./store";

/** Fewest answers that may be turned into a mean. Below this the push says so. */
export const MIN_ANSWERS_TO_SUMMARISE = 3;

/** Sunday 20:00 Europe/London — after the prompt day ends (20:00). */
export const WEEKLY_SUMMARY_START_MINUTES = 20 * 60;

/**
 * Monday 12:00 Europe/London — the last Sunday prompt (sent by 19:00, plus
 * the 16h answer window) stays answerable until ~11:00; leave it room to
 * close, then stop retrying.
 */
export const WEEKLY_SUMMARY_RETRY_UNTIL_MINUTES = 12 * 60;

/** A dead tick's claim is taken over once it is this old. */
export const WEEKLY_SUMMARY_CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface WeeklySummaryEnv {
  DB: D1Database;
}

export interface WeekTally {
  sent: number;
  answered: number;
  meanIntensity: number | null;
}

export interface SummaryWeek {
  id: string;
  start: Date;
  end: Date;
  priorStart: Date;
  priorEnd: Date;
}

const WEEKDAY_MONDAY0: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function londonWeekdayMonday0(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(date);
  const index = WEEKDAY_MONDAY0[weekday];
  if (index === undefined) {
    throw new Error(`Unexpected London weekday: ${weekday}`);
  }
  return index;
}

export function shiftDateKey(dateKey: string, days: number, reference: Date): string {
  const noon = londonInstant(dateKey, 12 * 60, reference);
  return getLondonParts(new Date(noon.getTime() + days * 86_400_000)).dateKey;
}

/**
 * ISO-8601 week id from a Monday civil date (`YYYY-MM-DD`).
 * Thursday of the week owns the ISO year.
 */
export function isoWeekIdFromMonday(mondayDateKey: string): string {
  const [year, month, day] = mondayDateKey.split("-").map(Number);
  const mondayUtc = Date.UTC(year, month - 1, day);
  const thursdayUtc = mondayUtc + 3 * 86_400_000;
  const isoYear = new Date(thursdayUtc).getUTCFullYear();

  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay();
  const daysFromMonday = jan4Dow === 0 ? 6 : jan4Dow - 1;
  const week1Monday = Date.UTC(isoYear, 0, 4 - daysFromMonday);
  const week = Math.round((mondayUtc - week1Monday) / (7 * 86_400_000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * True on Sunday from 20:00 London, and on Monday before 12:00 so a missed
 * 15-minute tick — or a week whose prompts were still answerable — can
 * still send once. Idempotency is the week row, not the window.
 */
export function shouldRunWeeklySummary(now: Date): boolean {
  const weekday = londonWeekdayMonday0(now);
  const minutes = getLondonParts(now).minutesOfDay;
  if (weekday === 6 && minutes >= WEEKLY_SUMMARY_START_MINUTES) {
    return true;
  }
  if (weekday === 0 && minutes < WEEKLY_SUMMARY_RETRY_UNTIL_MINUTES) {
    return true;
  }
  return false;
}

/**
 * Monday 00:00–next Monday 00:00 Europe/London of the week that has just
 * finished its prompt day. Monday-morning retries still name Sunday's week.
 */
export function summaryWeekBounds(now: Date): SummaryWeek {
  const today = getLondonParts(now).dateKey;
  const weekday = londonWeekdayMonday0(now);
  const sundayKey = weekday === 0 ? shiftDateKey(today, -1, now) : today;
  const mondayKey = shiftDateKey(sundayKey, -6, now);
  const nextMondayKey = shiftDateKey(mondayKey, 7, now);
  const priorMondayKey = shiftDateKey(mondayKey, -7, now);

  const start = londonInstant(mondayKey, 0, now);
  const end = londonInstant(nextMondayKey, 0, now);
  const priorStart = londonInstant(priorMondayKey, 0, now);

  return {
    id: `weekly-${isoWeekIdFromMonday(mondayKey)}`,
    start,
    end,
    priorStart,
    priorEnd: start,
  };
}

export function tallyWeek(sent: number, intensities: number[]): WeekTally {
  const answered = intensities.length;
  return {
    sent,
    answered,
    meanIntensity:
      answered === 0
        ? null
        : intensities.reduce((sum, value) => sum + value, 0) / answered,
  };
}

export function roundedMean(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatMean(value: number): string {
  return roundedMean(value).toFixed(1);
}

export function hasEnoughAnswers(tally: WeekTally): boolean {
  return tally.answered >= MIN_ANSWERS_TO_SUMMARISE && tally.meanIntensity !== null;
}

export type MoodDirection = "up" | "down" | "same";

export function moodDirection(current: number, prior: number): MoodDirection {
  const a = roundedMean(current);
  const b = roundedMean(prior);
  if (a > b) {
    return "up";
  }
  if (a < b) {
    return "down";
  }
  return "same";
}

/**
 * Lock-screen line: answer rate with denominator, mean intensity when it is
 * honest, and direction against the prior week. Mean intensity is the mood
 * number because it is the instrument's comparable scalar; a modal feeling
 * cannot carry up/down.
 */
export function formatWeeklySummaryMessage(current: WeekTally, prior: WeekTally): string {
  const rate = `${current.answered}/${current.sent}`;
  if (!hasEnoughAnswers(current) || current.meanIntensity === null) {
    return `Too little data to summarise (${rate}).`;
  }

  const mood = formatMean(current.meanIntensity);
  if (!hasEnoughAnswers(prior) || prior.meanIntensity === null) {
    return `${rate} answered. Mood ${mood}. No prior week to compare.`;
  }

  const direction = moodDirection(current.meanIntensity, prior.meanIntensity);
  if (direction === "same") {
    return `${rate} answered. Mood ${mood}, same as last week.`;
  }
  return `${rate} answered. Mood ${mood}, ${direction} from ${formatMean(prior.meanIntensity)}.`;
}

export type WeeklySummaryResult =
  | { skipped: true; reason: string }
  | { skipped: false; weekId: string; message: string };

async function tallyRange(
  db: D1Database,
  from: Date,
  to: Date,
): Promise<WeekTally> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const prompts = await listSentPromptsBetween(db, fromIso, toIso);
  const responses = await listResponsesForSentPromptsBetween(db, fromIso, toIso);
  return tallyWeek(
    prompts.length,
    responses.map((row) => row.intensity),
  );
}

export async function runWeeklySummary(
  env: WeeklySummaryEnv,
  notifier: Notifier,
  now: Date,
): Promise<WeeklySummaryResult> {
  if (!shouldRunWeeklySummary(now)) {
    return { skipped: true, reason: "outside_window" };
  }

  const week = summaryWeekBounds(now);
  const nowIso = now.toISOString();

  // The push reports the finished week: every sent prompt must be past its
  // answer window, or answers landing after delivery would supersede the
  // numbers on the lock screen. An open week defers to the next tick.
  if (
    await hasOpenSentPromptsBetween(
      env.DB,
      week.start.toISOString(),
      week.end.toISOString(),
      nowIso,
    )
  ) {
    log("info", "weekly_summary_deferred", { week_id: week.id, reason: "prompts_open" });
    return { skipped: true, reason: "prompts_open" };
  }

  const staleBeforeIso = new Date(
    now.getTime() - WEEKLY_SUMMARY_CLAIM_LEASE_MS,
  ).toISOString();
  const claim = await claimWeeklySummary(env.DB, week.id, nowIso, staleBeforeIso);
  if (claim === "skip") {
    log("info", "weekly_summary_skipped", { week_id: week.id, reason: "already_sent" });
    return { skipped: true, reason: "already_sent" };
  }
  if (claim === "reconcile") {
    // An earlier tick delivered the push but never stamped sent_at; finish
    // the record without sending again.
    await completeWeeklySummary(env.DB, week.id, nowIso);
    log("info", "weekly_summary_reconciled", { week_id: week.id });
    return { skipped: true, reason: "reconciled" };
  }

  let deliveredId: string | null = null;
  try {
    const current = await tallyRange(env.DB, week.start, week.end);
    const prior = await tallyRange(env.DB, week.priorStart, week.priorEnd);
    const message = formatWeeklySummaryMessage(current, prior);
    await storeWeeklySummaryMessage(env.DB, week.id, message);
    const notification = await notifier.sendWeeklySummary(message);
    deliveredId = notification.id;
    // Record the accepted push before the completion stamp: a row carrying
    // notification_id is reconciled by later ticks, never resent.
    await recordWeeklySummaryNotification(env.DB, week.id, notification.id);
    await completeWeeklySummary(env.DB, week.id, nowIso);

    log("info", "weekly_summary_sent", {
      week_id: week.id,
      answered: current.answered,
      sent: current.sent,
      sufficient: hasEnoughAnswers(current),
    });

    return { skipped: false, weekId: week.id, message };
  } catch (error) {
    if (deliveredId !== null) {
      // The push is already out; releasing the claim would resend it. Persist
      // the evidence again so later ticks reconcile. If this also fails, a
      // lease-expired tick may resend — after an ambiguous accepted send the
      // reachable guarantee is at-most-once-claimed, not exactly-once.
      try {
        await recordWeeklySummaryNotification(env.DB, week.id, deliveredId);
      } catch {
        log("error", "weekly_summary_delivery_unrecorded", {
          week_id: week.id,
          notification_id: deliveredId,
        });
      }
    } else {
      await releaseWeeklySummary(env.DB, week.id);
    }
    throw error;
  }
}
