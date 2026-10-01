import { MANUAL_BACKDATE_DAYS, TOKEN_TTL_HOURS } from "./config";
import { WHEEL_ERA } from "./feelings-wheel";
import { getLondonParts, fromLondonWallClock, shiftDateKey } from "./london-time";
import { log } from "./logger";
import {
  Confidence,
  PromptRow,
  deleteResponseForPrompt,
  getPromptByToken,
  upsertResponse,
  updatePromptStatus,
} from "./store";
import { isAllowedFeeling } from "./vocabulary";

const CONFIDENCE_VALUES: Confidence[] = ["weak", "strong"];

// Shape of a vocabulary era (E1, E2, …). The era is provenance metadata,
// not user data: a malformed value is dropped to NULL (and logged) rather
// than rejecting the check-in that carries it. When the client omits it,
// recordResponse stamps WHEEL_ERA.
const VOCAB_ERA_PATTERN = /^E\d{1,3}$/;

export interface RecordResponseInput {
  token: string;
  feeling: string;
  intensity: number;
  note?: string;
  confidence?: string | null;
  vocabEra?: string | null;
  now: Date;
}

export type RecordResponseResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "invalid" };

export interface RecordManualResponseInput {
  feeling: string;
  intensity: number;
  note?: string;
  confidence?: string | null;
  vocabEra?: string | null;
  observedAt: string;
  now: Date;
  id?: string;
}

export type RecordManualResponseResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid" | "out_of_range" };

const NAIVE_OBSERVED_AT =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

async function resolveLivePrompt(
  db: D1Database,
  token: string,
  now: Date,
): Promise<{ ok: true; prompt: PromptRow } | { ok: false; reason: "not_found" | "expired" }> {
  const prompt = await getPromptByToken(db, token);
  if (!prompt) {
    log("warn", "response_rejected", { reason: "not_found" });
    return { ok: false, reason: "not_found" };
  }

  if (prompt.status === "expired") {
    log("warn", "response_rejected", { reason: "expired", prompt_id: prompt.id });
    return { ok: false, reason: "expired" };
  }

  if (prompt.expires_at && prompt.expires_at < now.toISOString()) {
    if (prompt.status === "sent") {
      await updatePromptStatus(db, prompt.id, "expired");
    }
    log("warn", "response_rejected", { reason: "expired", prompt_id: prompt.id });
    return { ok: false, reason: "expired" };
  }

  return { ok: true, prompt };
}

export async function recordResponse(
  db: D1Database,
  input: RecordResponseInput,
): Promise<RecordResponseResult> {
  const live = await resolveLivePrompt(db, input.token, input.now);
  if (!live.ok) {
    return live;
  }
  const prompt = live.prompt;

  if (input.intensity < 1 || input.intensity > 10) {
    return rejectInvalid(prompt.id);
  }

  if (!isAllowedFeeling(input.feeling)) {
    return rejectInvalid(prompt.id);
  }

  if (
    input.confidence != null &&
    !CONFIDENCE_VALUES.includes(input.confidence as Confidence)
  ) {
    return rejectInvalid(prompt.id);
  }

  const vocabEra = resolveVocabEra(input.vocabEra);
  if (input.vocabEra != null && vocabEra === null) {
    log("warn", "vocab_era_discarded", { prompt_id: prompt.id });
  }

  const submittedAt = input.now.toISOString();
  await upsertResponse(db, {
    id: `response-${prompt.id}`,
    prompt_id: prompt.id,
    feeling: input.feeling,
    intensity: input.intensity,
    note: input.note?.trim() || null,
    confidence: (input.confidence as Confidence) ?? null,
    vocab_era: vocabEra,
    observed_at: prompt.sent_at ?? submittedAt,
    submitted_at: submittedAt,
  });
  await updatePromptStatus(db, prompt.id, "answered");

  log("info", "response_accepted", { prompt_id: prompt.id });
  return { ok: true };
}

export async function recordManualResponse(
  db: D1Database,
  input: RecordManualResponseInput,
): Promise<RecordManualResponseResult> {
  if (input.intensity < 1 || input.intensity > 10) {
    return rejectManualInvalid();
  }

  if (!isAllowedFeeling(input.feeling)) {
    return rejectManualInvalid();
  }

  if (
    input.confidence != null &&
    !CONFIDENCE_VALUES.includes(input.confidence as Confidence)
  ) {
    return rejectManualInvalid();
  }

  const observedAt = parseObservedAt(input.observedAt);
  if (!observedAt) {
    return rejectManualInvalid();
  }

  if (!isObservedAtInManualWindow(observedAt, input.now)) {
    log("warn", "response_rejected", { reason: "out_of_range" });
    return { ok: false, reason: "out_of_range" };
  }

  const vocabEra = resolveVocabEra(input.vocabEra);
  if (input.vocabEra != null && vocabEra === null) {
    log("warn", "vocab_era_discarded", { source: "manual" });
  }

  const id = input.id ?? `manual-${crypto.randomUUID()}`;
  const submittedAt = input.now.toISOString();
  await upsertResponse(db, {
    id,
    prompt_id: null,
    feeling: input.feeling,
    intensity: input.intensity,
    note: input.note?.trim() || null,
    confidence: (input.confidence as Confidence) ?? null,
    vocab_era: vocabEra,
    observed_at: observedAt.toISOString(),
    submitted_at: submittedAt,
  });

  log("info", "manual_response_accepted", { response_id: id });
  return { ok: true, id };
}

/** Earliest allowed `observed_at`: 00:00 Europe/London, `days` calendar days before today. */
export function earliestManualObservedAt(
  now: Date,
  days: number = MANUAL_BACKDATE_DAYS,
): Date {
  const today = getLondonParts(now).dateKey;
  return fromLondonWallClock(shiftDateKey(today, -days), 0);
}

export function parseObservedAt(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const naive = NAIVE_OBSERVED_AT.exec(trimmed);
  if (naive) {
    const hour = Number(naive[2]);
    const minute = Number(naive[3]);
    if (hour > 23 || minute > 59) {
      return null;
    }
    return fromLondonWallClock(naive[1], hour * 60 + minute);
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms);
}

export function isObservedAtInManualWindow(observedAt: Date, now: Date): boolean {
  if (observedAt.getTime() > now.getTime()) {
    return false;
  }
  return observedAt.getTime() >= earliestManualObservedAt(now).getTime();
}

function rejectManualInvalid(): RecordManualResponseResult {
  log("warn", "response_rejected", { reason: "invalid", source: "manual" });
  return { ok: false, reason: "invalid" };
}

export async function recordDecline(
  db: D1Database,
  input: { token: string; now: Date },
): Promise<RecordResponseResult> {
  const live = await resolveLivePrompt(db, input.token, input.now);
  if (!live.ok) {
    return live;
  }
  const prompt = live.prompt;

  await deleteResponseForPrompt(db, prompt.id);
  await updatePromptStatus(db, prompt.id, "declined");
  log("info", "prompt_declined", { prompt_id: prompt.id });
  return { ok: true };
}

export function isPromptUsable(prompt: PromptRow, now: Date): boolean {
  if (prompt.status === "expired") {
    return false;
  }
  if (prompt.expires_at && prompt.expires_at < now.toISOString()) {
    return false;
  }
  return (
    prompt.status === "sent" ||
    prompt.status === "answered" ||
    prompt.status === "declined"
  );
}

export function expiresAtFrom(sentAt: Date): string {
  return new Date(sentAt.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

function resolveVocabEra(submitted: string | null | undefined): string | null {
  if (submitted == null) {
    return WHEEL_ERA;
  }
  return VOCAB_ERA_PATTERN.test(submitted) ? submitted : null;
}

function rejectInvalid(promptId: string): RecordResponseResult {
  // N4: log the rejection; never include the feeling value (or other
  // user-authored payload) — that belongs in the structured export only.
  log("warn", "response_rejected", { reason: "invalid", prompt_id: promptId });
  return { ok: false, reason: "invalid" };
}
