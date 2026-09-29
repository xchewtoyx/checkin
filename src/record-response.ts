import { TOKEN_TTL_HOURS } from "./config";
import { WHEEL_ERA } from "./feelings-wheel";
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
