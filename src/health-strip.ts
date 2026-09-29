import { getLondonParts } from "./london-time";
import {
  EXPORT_SLOT_WINDOW_MINUTES,
  EXPORT_SLOTS_UTC,
  ExportSlot,
  buildExportSlot,
} from "./analytics-extract";

export const ANSWER_WINDOW_DAYS = 14;
export const FRESHNESS_LOOKBACK_DAYS = 7;
export const FRESH_WITHIN_MS = 24 * 60 * 60 * 1000;
export const HEALTHY_FLOOR_PERCENT = 75;
export const FRICTION_FLOOR_PERCENT = 50;

export type DeliveredStatus = "sent" | "answered" | "expired";

export type DeliveredPrompt = {
  readonly dateKey: string;
  readonly status: DeliveredStatus;
  readonly expiresAt: string | null;
};

export type SlotId = {
  readonly extractionDate: string;
  readonly objectTimestamp: string;
};

export type ExtractIntegrity = "match" | "mismatch" | "unknown";

export type ManifestHead = {
  readonly slot: SlotId;
  readonly extractionTimestamp: string;
  readonly integrity: ExtractIntegrity;
};

export type ExtractFacts =
  | { readonly kind: "no-bucket" }
  | {
      readonly kind: "bucket";
      readonly manifests: readonly ManifestHead[];
      readonly unreadableKeys: readonly string[];
    };

export type HealthFacts = {
  readonly observedAt: string;
  readonly delivered: readonly DeliveredPrompt[];
  readonly extract: ExtractFacts;
};

export type RateBand = "healthy" | "friction" | "failure";

export type LondonDateWindow = {
  readonly start: string;
  readonly end: string;
  readonly dayCount: typeof ANSWER_WINDOW_DAYS;
};

export type AnswerReading =
  | { readonly kind: "absent"; readonly reason: "no-sends" }
  | {
      readonly kind: "measured";
      readonly answered: number;
      readonly sent: number;
      readonly percent: number;
      readonly band: RateBand;
    };

export type FreshnessCause =
  | { readonly kind: "missed-slot"; readonly slot: SlotId }
  | {
      readonly kind: "unreadable-manifest";
      readonly slot: SlotId | null;
      readonly key: string;
    }
  | { readonly kind: "older-than-24h" };

export type Freshness =
  | { readonly kind: "current" }
  | { readonly kind: "stale"; readonly causes: readonly FreshnessCause[] };

export type ExtractReading =
  | { readonly kind: "absent"; readonly reason: "no-bucket" | "no-manifest" }
  | { readonly kind: "unreadable"; readonly key: string }
  | {
      readonly kind: "landed";
      readonly refreshedAt: string;
      readonly slot: SlotId;
      readonly freshness: Freshness;
      readonly integrity: ExtractIntegrity;
    };

export type Glance = "healthy" | "attention" | "absent";

export type HealthStrip = {
  readonly window: LondonDateWindow;
  readonly observedAt: string;
  readonly answer: AnswerReading;
  readonly extract: ExtractReading;
  readonly glance: Glance;
};

const PROMPT_ID_RE = /^prompt-(\d{4}-\d{2}-\d{2})-w\d+$/;
const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_STAMP_RE = /^\d{6}$/;

export function parsePromptDateKey(id: string): string | null {
  const match = PROMPT_ID_RE.exec(id);
  return match ? match[1] : null;
}

export function deliveredPrompt(
  dateKey: string,
  status: DeliveredStatus,
  expiresAt: string | null = null,
): DeliveredPrompt {
  if (!CIVIL_DATE_RE.test(dateKey)) {
    throw new Error(`invalid London date key: ${dateKey}`);
  }
  return { dateKey, status, expiresAt };
}

export function manifestHead(
  extractionDate: string,
  objectTimestamp: string,
  extractionTimestamp: string,
  integrity: ExtractIntegrity,
): ManifestHead {
  if (!CIVIL_DATE_RE.test(extractionDate) || !SLOT_STAMP_RE.test(objectTimestamp)) {
    throw new Error("invalid manifest slot");
  }
  if (Number.isNaN(Date.parse(extractionTimestamp))) {
    throw new Error("invalid extraction timestamp");
  }
  return {
    slot: { extractionDate, objectTimestamp },
    extractionTimestamp,
    integrity,
  };
}

export function addCivilDays(dateKey: string, days: number): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function trailingLondonWindow(observedAt: Date): LondonDateWindow {
  const end = getLondonParts(observedAt).dateKey;
  return {
    start: addCivilDays(end, -(ANSWER_WINDOW_DAYS - 1)),
    end,
    dayCount: ANSWER_WINDOW_DAYS,
  };
}

export function recentExportSlots(now: Date, lookbackDays: number): ExportSlot[] {
  const slots: ExportSlot[] = [];
  const startMs = now.getTime() - lookbackDays * 86_400_000;
  for (let dayOffset = 0; dayOffset <= lookbackDays; dayOffset++) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset),
    );
    for (const { hour, minute } of EXPORT_SLOTS_UTC) {
      const slot = buildExportSlot(day, hour, minute);
      if (slot.scheduledAt.getTime() > startMs && slot.scheduledAt.getTime() <= now.getTime()) {
        slots.push(slot);
      }
    }
  }
  slots.sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime());
  return slots;
}

export function latestDueSlot(now: Date): SlotId | null {
  const due = dueExportSlots(now, 2);
  const latest = due[due.length - 1];
  return latest === undefined
    ? null
    : {
        extractionDate: latest.extractionDate,
        objectTimestamp: latest.objectTimestamp,
      };
}

export function dueExportSlots(now: Date, lookbackDays: number): ExportSlot[] {
  return recentExportSlots(now, lookbackDays)
    .filter(
      (slot) =>
        slot.scheduledAt.getTime() + EXPORT_SLOT_WINDOW_MINUTES * 60_000 <=
        now.getTime(),
    )
    .reverse();
}

const MANIFEST_KEY_RE =
  /extraction_date=(\d{4}-\d{2}-\d{2})\/(\d{6})\.json$/;

export function slotFromManifestKey(key: string): SlotId | null {
  const match = MANIFEST_KEY_RE.exec(key);
  if (!match) {
    return null;
  }
  return { extractionDate: match[1], objectTimestamp: match[2] };
}

export function slotKey(slot: SlotId): string {
  return `${slot.extractionDate}/${slot.objectTimestamp}`;
}

function isClosedBy(prompt: DeliveredPrompt, observedAt: string): boolean {
  if (prompt.status === "answered" || prompt.status === "expired") {
    return true;
  }
  if (prompt.status !== "sent" || prompt.expiresAt === null) {
    return false;
  }
  return Date.parse(prompt.expiresAt) <= Date.parse(observedAt);
}

function bandForPercent(percent: number): RateBand {
  if (percent >= HEALTHY_FLOOR_PERCENT) {
    return "healthy";
  }
  if (percent >= FRICTION_FLOOR_PERCENT) {
    return "friction";
  }
  return "failure";
}

function answerReading(
  delivered: readonly DeliveredPrompt[],
  window: LondonDateWindow,
  observedAt: string,
): AnswerReading {
  let answered = 0;
  let sent = 0;
  for (const prompt of delivered) {
    if (prompt.dateKey < window.start || prompt.dateKey > window.end) {
      continue;
    }
    if (!isClosedBy(prompt, observedAt)) {
      continue;
    }
    sent += 1;
    if (prompt.status === "answered") {
      answered += 1;
    }
  }
  if (sent === 0) {
    return { kind: "absent", reason: "no-sends" };
  }
  const percent = Math.floor((answered * 100) / sent);
  return {
    kind: "measured",
    answered,
    sent,
    percent,
    band: bandForPercent(percent),
  };
}

function sameSlot(left: SlotId, right: SlotId): boolean {
  return (
    left.extractionDate === right.extractionDate &&
    left.objectTimestamp === right.objectTimestamp
  );
}

function latestManifest(manifests: readonly ManifestHead[]): ManifestHead | null {
  if (manifests.length === 0) {
    return null;
  }
  return [...manifests].sort((left, right) => {
    if (left.extractionTimestamp !== right.extractionTimestamp) {
      return left.extractionTimestamp < right.extractionTimestamp ? 1 : -1;
    }
    const leftKey = slotKey(left.slot);
    const rightKey = slotKey(right.slot);
    return leftKey < rightKey ? 1 : -1;
  })[0];
}

function freshnessFor(
  latest: ManifestHead,
  extract: {
    readonly manifests: readonly ManifestHead[];
    readonly unreadableKeys: readonly string[];
  },
  observedAt: string,
): Freshness {
  const causes: FreshnessCause[] = [];
  const unreadable = extract.unreadableKeys.map((key) => ({
    key,
    slot: slotFromManifestKey(key),
    matched: false,
  }));
  const due = dueExportSlots(new Date(observedAt), FRESHNESS_LOOKBACK_DAYS);
  for (const slot of due) {
    const slotId: SlotId = {
      extractionDate: slot.extractionDate,
      objectTimestamp: slot.objectTimestamp,
    };
    if (extract.manifests.some((head) => sameSlot(head.slot, slotId))) {
      continue;
    }
    const bad = unreadable.find(
      (entry) => entry.slot !== null && sameSlot(entry.slot, slotId),
    );
    if (bad) {
      bad.matched = true;
      causes.push({
        kind: "unreadable-manifest",
        slot: bad.slot,
        key: bad.key,
      });
    } else {
      causes.push({ kind: "missed-slot", slot: slotId });
    }
  }
  for (const entry of unreadable) {
    if (!entry.matched) {
      causes.push({
        kind: "unreadable-manifest",
        slot: entry.slot,
        key: entry.key,
      });
    }
  }
  const age = Date.parse(observedAt) - Date.parse(latest.extractionTimestamp);
  if (age > FRESH_WITHIN_MS) {
    causes.push({ kind: "older-than-24h" });
  }
  return causes.length === 0
    ? { kind: "current" }
    : { kind: "stale", causes };
}

function extractReading(extract: ExtractFacts, observedAt: string): ExtractReading {
  if (extract.kind === "no-bucket") {
    return { kind: "absent", reason: "no-bucket" };
  }
  const latest = latestManifest(extract.manifests);
  if (!latest) {
    if (extract.unreadableKeys.length > 0) {
      const keys = [...extract.unreadableKeys].sort();
      return { kind: "unreadable", key: keys[keys.length - 1] };
    }
    return { kind: "absent", reason: "no-manifest" };
  }
  return {
    kind: "landed",
    refreshedAt: latest.extractionTimestamp,
    slot: latest.slot,
    freshness: freshnessFor(latest, extract, observedAt),
    integrity: latest.integrity,
  };
}

function glanceFor(answer: AnswerReading, extract: ExtractReading): Glance {
  if (answer.kind === "absent" && extract.kind === "absent") {
    return "absent";
  }
  if (
    answer.kind === "measured" &&
    answer.band === "healthy" &&
    extract.kind === "landed" &&
    extract.freshness.kind === "current" &&
    extract.integrity === "match"
  ) {
    return "healthy";
  }
  return "attention";
}

export function assessHealth(facts: HealthFacts): HealthStrip {
  const observed = new Date(facts.observedAt);
  const window = trailingLondonWindow(observed);
  const answer = answerReading(facts.delivered, window, facts.observedAt);
  const extract = extractReading(facts.extract, facts.observedAt);
  return {
    window,
    observedAt: facts.observedAt,
    answer,
    extract,
    glance: glanceFor(answer, extract),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bandLabel(band: RateBand): string {
  if (band === "healthy") {
    return "Healthy";
  }
  if (band === "friction") {
    return "Friction review";
  }
  return "Friction failure";
}

function slotTimeLabel(slot: SlotId): string {
  const hour = slot.objectTimestamp.slice(0, 2);
  const minute = slot.objectTimestamp.slice(2, 4);
  return `${slot.extractionDate} ${hour}:${minute} UTC`;
}

function freshnessCauses(freshness: Freshness): string[] {
  if (freshness.kind === "current") {
    return [];
  }
  const labels: string[] = [];
  let missedCount = 0;
  let firstMissedIndex = -1;
  for (const cause of freshness.causes) {
    if (cause.kind === "missed-slot") {
      missedCount += 1;
      if (missedCount === 1) {
        firstMissedIndex = labels.length;
        labels.push(`missed ${slotTimeLabel(cause.slot)}`);
      }
      continue;
    }
    if (cause.kind === "unreadable-manifest") {
      labels.push(
        cause.slot === null
          ? `unreadable manifest ${escapeHtml(cause.key)}`
          : `unreadable manifest ${slotTimeLabel(cause.slot)}`,
      );
      continue;
    }
    labels.push("older than 24h");
  }
  if (missedCount > 1) {
    labels[firstMissedIndex] = `${labels[firstMissedIndex]} +${
      missedCount - 1
    } more`;
  }
  return labels;
}

function answerCell(answer: AnswerReading): string {
  if (answer.kind === "absent") {
    return `<div data-answer="absent"><p class="eyebrow">Answer rate</p><p class="figure">Absent</p><p class="detail">No prompts closed in this window</p></div>`;
  }
  return `<div data-answer="measured" data-band="${answer.band}"><p class="eyebrow">Answer rate</p><p class="figure">${answer.answered}/${answer.sent} · ${answer.percent}% · ${bandLabel(answer.band)}</p><p class="detail">Closed delivered prompts. Target ≥ ${HEALTHY_FLOOR_PERCENT}%</p></div>`;
}

function extractCell(extract: ExtractReading): string {
  if (extract.kind === "absent") {
    const reason =
      extract.reason === "no-bucket"
        ? "Extract bucket not configured"
        : "No extract manifest";
    return `<div data-extract="absent"><p class="eyebrow">Analytics extract</p><p class="figure">Absent</p><p class="detail">${reason}</p></div>`;
  }
  if (extract.kind === "unreadable") {
    return `<div data-extract="unreadable"><p class="eyebrow">Analytics extract</p><p class="figure">Unreadable</p><p class="detail">${escapeHtml(extract.key)}</p></div>`;
  }
  const causes = freshnessCauses(extract.freshness);
  const stalePrefix = causes.length > 0 ? `Stale · ${causes.join(" · ")} · ` : "";
  const mismatch =
    extract.integrity === "mismatch"
      ? " · Source count mismatch"
      : extract.integrity === "unknown"
        ? " · Source counts unverified"
        : "";
  return `<div data-extract="landed" data-freshness="${extract.freshness.kind}" data-integrity="${extract.integrity}"><p class="eyebrow">Analytics extract</p><p class="figure">${stalePrefix}Refreshed ${escapeHtml(extract.refreshedAt)}${mismatch}</p></div>`;
}

const STYLE = `
  :root {
    --ground: #faf9f7;
    --surface: #ffffff;
    --ink: #1f2328;
    --muted: #6b6f76;
    --line: #e4e1db;
    --ok: #2f6f4e;
    --warn: #8a5a12;
    --bad: #9b2c2c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #15171a;
      --surface: #1d2025;
      --ink: #e8eaed;
      --muted: #9aa0a8;
      --line: #2b2f36;
      --ok: #8fcead;
      --warn: #e0b36a;
      --bad: #e08b8b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.45;
  }
  main { max-width: 52rem; margin: 0 auto; padding: 1.2rem 1.1rem 2rem; }
  .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0;
  }
  h1 { font-size: 1.45rem; font-weight: 800; margin: 0.15rem 0 0.8rem; }
  .strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    padding: 1rem;
  }
  .figure { font-size: 1.05rem; font-weight: 700; margin: 0.25rem 0 0; }
  .detail, .window, .footnote { color: var(--muted); font-size: 0.9rem; margin: 0.25rem 0 0; }
  [data-glance="healthy"] .figure { color: var(--ok); }
  [data-glance="attention"] .figure { color: var(--bad); }
  [data-band="friction"] .figure { color: var(--warn); }
  [data-band="failure"] .figure { color: var(--bad); }
  [data-band="healthy"] .figure { color: var(--ok); }
  @media (max-width: 40rem) {
    .strip { grid-template-columns: 1fr; }
  }
`;

export function renderHealthStrip(strip: HealthStrip): string {
  const windowLine = `${strip.window.dayCount} London days · ${strip.window.start} – ${strip.window.end}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>checkin report</title>
  <style>${STYLE}</style>
</head>
<body>
<main>
  <p class="eyebrow">checkin · report</p>
  <h1>Is the instrument healthy?</h1>
  <section class="strip" data-glance="${strip.glance}">
    ${answerCell(strip.answer)}
    ${extractCell(strip.extract)}
  </section>
  <p class="window" data-window>${windowLine}</p>
  <p class="footnote">Closed delivered prompts are answered or expired. Failed sends are not in the denominator. An open link is not a miss yet.</p>
</main>
</body>
</html>`;
}
