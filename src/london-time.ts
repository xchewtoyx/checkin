export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  minutesOfDay: number;
  dateKey: string;
}

export function getLondonParts(date: Date): LondonParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** Shift a `YYYY-MM-DD` calendar key by a whole number of days. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function londonDateTimeLocal(date: Date): string {
  const parts = getLondonParts(date);
  return `${parts.dateKey}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function londonInstant(
  dateKey: string,
  minutesOfDay: number,
  reference: Date,
): Date {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guess = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  const parts = getLondonParts(guess);
  const offsetMinutes = parts.minutesOfDay - minutesOfDay;
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}
