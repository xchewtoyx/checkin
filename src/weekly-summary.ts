import { WHEEL, type Valence } from "./feelings-wheel";
import { getLondonParts, londonInstant } from "./london-time";
import { log } from "./logger";
import { Notifier } from "./notifier";
import {
  deleteWeeklySummary,
  insertWeeklySummary,
  listResponsesForSentPromptsBetween,
  listSentPromptsBetween,
} from "./store";

/** Fewest valenced answers that may be turned into a mean. */
export const MIN_ANSWERS_TO_SUMMARISE = 3;

/** Sunday 20:00 Europe/London — after the prompt day ends. */
const WINDOW_OPENS = 20 * 60;

/** Monday 08:00 Europe/London — next prompt day starts; stop retrying. */
const WINDOW_CLOSES = 8 * 60;

export interface WeeklySummaryEnv {
  DB: D1Database;
}

export interface Answer {
  feeling: string;
  intensity: number;
}

export interface WeekTally {
  sent: number;
  answered: number;
  scored: number;
  meanSigned: number | null;
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

function londonWeekdayMonday0(date: Date): number {
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

function addDateKeyDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function valenceOf(feeling: string): Valence | null {
  for (const sector of WHEEL) {
    if (sector.core === feeling) {
      return sector.valence;
    }
    for (const node of sector.feelings) {
      if (node.word === feeling || node.finer.includes(feeling)) {
        return sector.valence;
      }
    }
  }
  return null;
}

/** Pleasant intensity is positive; unpleasant is negative. Intensity alone is not mood. */
export function signedMood(feeling: string, intensity: number): number | null {
  const valence = valenceOf(feeling);
  if (!valence) {
    return null;
  }
  return valence === "pleasant" ? intensity : -intensity;
}

export function shouldRunWeeklySummary(now: Date): boolean {
  const weekday = londonWeekdayMonday0(now);
  const minutes = getLondonParts(now).minutesOfDay;
  return (
    (weekday === 6 && minutes >= WINDOW_OPENS) ||
    (weekday === 0 && minutes < WINDOW_CLOSES)
  );
}

export function summaryWeekBounds(now: Date): {
  id: string;
  start: Date;
  end: Date;
  priorStart: Date;
} {
  const today = getLondonParts(now).dateKey;
  const weekday = londonWeekdayMonday0(now);
  const sundayKey = weekday === 0 ? addDateKeyDays(today, -1) : today;
  const mondayKey = addDateKeyDays(sundayKey, -6);
  return {
    id: `weekly-${mondayKey}`,
    start: londonInstant(mondayKey, 0, now),
    end: londonInstant(addDateKeyDays(mondayKey, 7), 0, now),
    priorStart: londonInstant(addDateKeyDays(mondayKey, -7), 0, now),
  };
}

export function tallyWeek(sent: number, answers: Answer[]): WeekTally {
  const scores = answers
    .map((answer) => signedMood(answer.feeling, answer.intensity))
    .filter((score): score is number => score !== null);
  return {
    sent,
    answered: answers.length,
    scored: scores.length,
    meanSigned:
      scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatSigned(value: number): string {
  const rounded = round1(value);
  if (rounded === 0) {
    return "0.0";
  }
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function hasEnough(tally: WeekTally): boolean {
  return tally.scored >= MIN_ANSWERS_TO_SUMMARISE && tally.meanSigned !== null;
}

export function formatWeeklySummaryMessage(current: WeekTally, prior: WeekTally): string {
  const rate = `${current.answered}/${current.sent}`;
  if (!hasEnough(current) || current.meanSigned === null) {
    return `Too little data to summarise (${rate}).`;
  }

  const mood = formatSigned(current.meanSigned);
  if (!hasEnough(prior) || prior.meanSigned === null) {
    return `${rate} answered. ${mood}. No prior week to compare.`;
  }

  const a = round1(current.meanSigned);
  const b = round1(prior.meanSigned);
  if (a === b) {
    return `${rate} answered. ${mood}, same as last week.`;
  }
  const direction = a > b ? "up" : "down";
  return `${rate} answered. ${mood}, ${direction} from ${formatSigned(prior.meanSigned)}.`;
}

async function tallyRange(db: D1Database, from: Date, to: Date): Promise<WeekTally> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const prompts = await listSentPromptsBetween(db, fromIso, toIso);
  const responses = await listResponsesForSentPromptsBetween(db, fromIso, toIso);
  return tallyWeek(prompts.length, responses);
}

export async function runWeeklySummary(
  env: WeeklySummaryEnv,
  notifier: Notifier,
  now: Date,
): Promise<{ skipped: true; reason: string } | { skipped: false; weekId: string; message: string }> {
  if (!shouldRunWeeklySummary(now)) {
    return { skipped: true, reason: "outside_window" };
  }

  const week = summaryWeekBounds(now);
  const claimed = await insertWeeklySummary(env.DB, week.id, now.toISOString());
  if (!claimed) {
    return { skipped: true, reason: "already_sent" };
  }

  try {
    const current = await tallyRange(env.DB, week.start, week.end);
    const prior = await tallyRange(env.DB, week.priorStart, week.start);
    const message = formatWeeklySummaryMessage(current, prior);
    await notifier.sendWeeklySummary(message);
    log("info", "weekly_summary_sent", {
      week_id: week.id,
      answered: current.answered,
      sent: current.sent,
    });
    return { skipped: false, weekId: week.id, message };
  } catch (error) {
    await deleteWeeklySummary(env.DB, week.id);
    throw error;
  }
}
