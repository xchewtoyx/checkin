export const TIMEZONE = "Europe/London";
export const PROMPT_DAY_START = "08:00";
export const PROMPT_DAY_END = "20:00";
export const TOKEN_TTL_HOURS = 16;
export const DEFAULT_WINDOWS = "09:00-11:00,13:00-15:00,17:00-19:00";

/**
 * G1 live-gate pass line (#1 §5 / docs/g1-gate-report.md). Answer rate
 * below this is a breach. The 50% "friction failure" band is a stronger
 * signal; this standing check uses the pass threshold the gate was
 * decided on. Not revised after seeing data.
 */
export const ANSWER_RATE_THRESHOLD = 0.75;

/** Inclusive London-calendar length of the G1 fortnight. */
export const ANSWER_RATE_WINDOW_DAYS = 14;

/**
 * Closed sent prompts (answered + expired + overdue sent) required
 * before a fortnight rate is evaluable. Fewer than one closed prompt
 * per day of the window is "too few" — a handful of slots is not a
 * fortnight's evidence, and must not count as a breach.
 */
export const ANSWER_RATE_MIN_SENT_PROMPTS = 14;

export const ANSWER_RATE_ALERT_ID = "answer_rate_g1";

export interface ScheduleWindow {
  index: number;
  startMinutes: number;
  endMinutes: number;
}

export function parseWindows(raw: string): ScheduleWindow[] {
  return raw.split(",").map((part, index) => {
    const [start, end] = part.trim().split("-");
    if (!start || !end) {
      throw new Error(`Invalid schedule window: ${part}`);
    }
    return {
      index,
      startMinutes: parseClock(start),
      endMinutes: parseClock(end),
    };
  });
}

export function parseClock(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (
    hour === undefined ||
    minute === undefined ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    throw new Error(`Invalid clock value: ${value}`);
  }
  return hour * 60 + minute;
}
