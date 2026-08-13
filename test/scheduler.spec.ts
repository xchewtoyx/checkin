import { describe, expect, it } from "vitest";
import { parseClock, parseWindows } from "../src/config";
import { getLondonParts } from "../src/london-time";
import { isWithinPromptDay, pickTargetMinutes } from "../src/scheduler";

describe("london time", () => {
  it("handles BST during summer", () => {
    const parts = getLondonParts(new Date("2026-07-15T10:30:00.000Z"));
    expect(parts.hour).toBe(11);
    expect(parts.minute).toBe(30);
  });

  it("handles GMT after autumn transition", () => {
    const parts = getLondonParts(new Date("2026-11-15T10:30:00.000Z"));
    expect(parts.hour).toBe(10);
    expect(parts.minute).toBe(30);
  });

  it("handles spring forward boundary day", () => {
    const parts = getLondonParts(new Date("2026-03-29T12:00:00.000Z"));
    expect(parts.dateKey).toBe("2026-03-29");
    expect(parts.minutesOfDay).toBeGreaterThanOrEqual(0);
  });

  it("handles autumn fallback boundary day", () => {
    const parts = getLondonParts(new Date("2026-10-25T12:00:00.000Z"));
    expect(parts.dateKey).toBe("2026-10-25");
    expect(parts.minutesOfDay).toBeGreaterThanOrEqual(0);
  });
});

describe("scheduler helpers", () => {
  it("parses configured windows", () => {
    const windows = parseWindows("09:00-11:00,13:00-15:00");
    expect(windows).toHaveLength(2);
    expect(windows[0].startMinutes).toBe(parseClock("09:00"));
  });

  it("picks a stable target minute within the window", () => {
    const windows = parseWindows("09:00-11:00");
    const first = pickTargetMinutes(windows[0], "2026-08-13");
    const second = pickTargetMinutes(windows[0], "2026-08-13");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(9 * 60);
    expect(first).toBeLessThan(11 * 60);
  });

  it("restricts active prompt hours to 08:00-20:00", () => {
    expect(isWithinPromptDay(parseClock("07:59"))).toBe(false);
    expect(isWithinPromptDay(parseClock("08:00"))).toBe(true);
    expect(isWithinPromptDay(parseClock("19:59"))).toBe(true);
    expect(isWithinPromptDay(parseClock("20:00"))).toBe(false);
  });
});
