export const TIMEZONE = "Europe/London";
export const PROMPT_DAY_START = "08:00";
export const PROMPT_DAY_END = "20:00";
export const TOKEN_TTL_HOURS = 16;
export const DEFAULT_WINDOWS = "09:00-11:00,13:00-15:00,17:00-19:00";

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
