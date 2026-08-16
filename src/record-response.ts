import { TOKEN_TTL_HOURS } from "./config";
import { log } from "./logger";
import {
  Confidence,
  PromptRow,
  getPromptByToken,
  upsertResponse,
  updatePromptStatus,
} from "./store";

const CONFIDENCE_VALUES: Confidence[] = ["weak", "strong"];

export interface RecordResponseInput {
  token: string;
  feeling: string;
  intensity: number;
  note?: string;
  confidence?: string | null;
  now: Date;
}

export type RecordResponseResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "invalid" };

export async function recordResponse(
  db: D1Database,
  input: RecordResponseInput,
): Promise<RecordResponseResult> {
  const prompt = await getPromptByToken(db, input.token);
  if (!prompt) {
    log("warn", "response_rejected", { reason: "not_found" });
    return { ok: false, reason: "not_found" };
  }

  if (prompt.status === "expired") {
    log("warn", "response_rejected", { reason: "expired", prompt_id: prompt.id });
    return { ok: false, reason: "expired" };
  }

  if (prompt.expires_at && prompt.expires_at < input.now.toISOString()) {
    await updatePromptStatus(db, prompt.id, "expired");
    log("warn", "response_rejected", { reason: "expired", prompt_id: prompt.id });
    return { ok: false, reason: "expired" };
  }

  if (input.intensity < 1 || input.intensity > 10) {
    return { ok: false, reason: "invalid" };
  }

  if (
    input.confidence != null &&
    !CONFIDENCE_VALUES.includes(input.confidence as Confidence)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const submittedAt = input.now.toISOString();
  await upsertResponse(db, {
    id: `response-${prompt.id}`,
    prompt_id: prompt.id,
    feeling: input.feeling,
    intensity: input.intensity,
    note: input.note?.trim() || null,
    confidence: (input.confidence as Confidence) ?? null,
    observed_at: prompt.sent_at ?? submittedAt,
    submitted_at: submittedAt,
  });
  await updatePromptStatus(db, prompt.id, "answered");

  log("info", "response_accepted", { prompt_id: prompt.id });
  return { ok: true };
}

export function isPromptUsable(prompt: PromptRow, now: Date): boolean {
  if (prompt.status === "expired") {
    return false;
  }
  if (prompt.expires_at && prompt.expires_at < now.toISOString()) {
    return false;
  }
  return prompt.status === "sent" || prompt.status === "answered";
}

export function expiresAtFrom(sentAt: Date): string {
  return new Date(sentAt.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
}
