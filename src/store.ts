export type PromptStatus =
  | "scheduled"
  | "sent"
  | "answered"
  | "expired"
  | "failed";

export interface PromptRow {
  id: string;
  scheduled_for: string;
  sent_at: string | null;
  expires_at: string | null;
  response_token: string;
  notification_id: string | null;
  status: PromptStatus;
  created_at: string;
}

export type Confidence = "weak" | "strong";

export interface ResponseRow {
  id: string;
  prompt_id: string;
  feeling: string;
  intensity: number;
  note: string | null;
  confidence: Confidence | null;
  vocab_era: string | null;
  observed_at: string;
  submitted_at: string;
}

/** Prompt columns exported to analytics (F4 excludes credentials). */
export interface ExportedPromptRow {
  id: string;
  scheduled_for: string;
  sent_at: string | null;
  expires_at: string | null;
  status: PromptStatus;
  created_at: string;
}

export type ExportedResponseRow = ResponseRow;

export function promptId(dateKey: string, windowIndex: number): string {
  return `prompt-${dateKey}-w${windowIndex}`;
}

export async function getPromptById(
  db: D1Database,
  id: string,
): Promise<PromptRow | null> {
  return db
    .prepare(
      "SELECT id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at FROM checkin_prompt WHERE id = ?",
    )
    .bind(id)
    .first<PromptRow>();
}

export async function getPromptByToken(
  db: D1Database,
  token: string,
): Promise<PromptRow | null> {
  return db
    .prepare(
      "SELECT id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at FROM checkin_prompt WHERE response_token = ?",
    )
    .bind(token)
    .first<PromptRow>();
}

export async function insertPrompt(
  db: D1Database,
  row: PromptRow,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO checkin_prompt
      (id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.scheduled_for,
      row.sent_at,
      row.expires_at,
      row.response_token,
      row.notification_id,
      row.status,
      row.created_at,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updatePromptStatus(
  db: D1Database,
  id: string,
  status: PromptStatus,
  fields: Partial<Pick<PromptRow, "sent_at" | "expires_at" | "notification_id">> = {},
): Promise<void> {
  await db
    .prepare(
      `UPDATE checkin_prompt
       SET status = ?, sent_at = COALESCE(?, sent_at), expires_at = COALESCE(?, expires_at), notification_id = COALESCE(?, notification_id)
       WHERE id = ?`,
    )
    .bind(
      status,
      fields.sent_at ?? null,
      fields.expires_at ?? null,
      fields.notification_id ?? null,
      id,
    )
    .run();
}

export async function upsertResponse(
  db: D1Database,
  row: ResponseRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkin_response (id, prompt_id, feeling, intensity, note, confidence, vocab_era, observed_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         feeling = excluded.feeling,
         intensity = excluded.intensity,
         note = excluded.note,
         confidence = excluded.confidence,
         vocab_era = excluded.vocab_era,
         observed_at = excluded.observed_at,
         submitted_at = excluded.submitted_at`,
    )
    .bind(
      row.id,
      row.prompt_id,
      row.feeling,
      row.intensity,
      row.note,
      row.confidence,
      row.vocab_era,
      row.observed_at,
      row.submitted_at,
    )
    .run();
}

export async function expireStalePrompts(
  db: D1Database,
  nowIso: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE checkin_prompt
       SET status = 'expired'
       WHERE status = 'sent' AND expires_at IS NOT NULL AND expires_at < ?`,
    )
    .bind(nowIso)
    .run();
  return result.meta.changes ?? 0;
}

export async function listResponses(
  db: D1Database,
  from?: string,
  to?: string,
): Promise<ResponseRow[]> {
  let query =
    "SELECT id, prompt_id, feeling, intensity, note, confidence, vocab_era, observed_at, submitted_at FROM checkin_response";
  const conditions: string[] = [];
  const bindings: string[] = [];

  if (from) {
    conditions.push("observed_at >= ?");
    bindings.push(from);
  }
  if (to) {
    conditions.push("observed_at <= ?");
    bindings.push(to);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += " ORDER BY observed_at ASC";

  const statement = db.prepare(query);
  const result = await statement.bind(...bindings).all<ResponseRow>();
  return result.results ?? [];
}

/**
 * `checkin_prompt` is bounded by a watermark — the manifest's
 * extraction_timestamp — rather than read as "everything right now". The
 * scheduled handler captures that instant before it does any work, so rows can
 * land while the run is still in progress; without the bound the snapshot would
 * include rows stamped after the timestamp the manifest claims. `created_at` is
 * never rewritten, so the bound only ever excludes rows that did not exist at
 * the watermark. In practice it excludes nothing mid-run: the scheduler stamps
 * created_at from the same `now` the watermark comes from, so prompts it creates
 * during this run sit exactly on the boundary and are included.
 *
 * `checkin_response` is deliberately NOT bounded. Its only candidate column,
 * submitted_at, is mutable: re-answering upserts the row and moves submitted_at
 * forward, so a bound on it drops responses that existed long before the
 * watermark and makes them look deleted for that slot — worse than the
 * over-inclusion it would prevent, and invisible to every count check, since
 * the COUNT carries the same predicate. observed_at is no better: it derives
 * from prompt.sent_at and would admit responses that did not exist yet.
 * Bounding responses correctly needs an immutable creation or commit column
 * (issue #62). Until then a response written mid-run lands in this slot while
 * falling outside the manifest's timestamp.
 */
export async function listAllPromptsForExport(
  db: D1Database,
  watermark: string,
): Promise<ExportedPromptRow[]> {
  const result = await db
    .prepare(
      `SELECT id, scheduled_for, sent_at, expires_at, status, created_at
       FROM checkin_prompt
       WHERE created_at <= ?
       ORDER BY created_at ASC`,
    )
    .bind(watermark)
    .all<ExportedPromptRow>();
  return result.results ?? [];
}

export async function listAllResponsesForExport(
  db: D1Database,
): Promise<ExportedResponseRow[]> {
  const result = await db
    .prepare(
      `SELECT id, prompt_id, feeling, intensity, note, confidence, vocab_era, observed_at, submitted_at
       FROM checkin_response
       ORDER BY observed_at ASC`,
    )
    .all<ExportedResponseRow>();
  return result.results ?? [];
}

export async function countAllPromptsForExport(
  db: D1Database,
  watermark: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS row_count FROM checkin_prompt WHERE created_at <= ?")
    .bind(watermark)
    .first<{ row_count: number }>();
  return row?.row_count ?? 0;
}

export async function countAllResponsesForExport(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS row_count FROM checkin_response")
    .first<{ row_count: number }>();
  return row?.row_count ?? 0;
}

export async function listSentPromptsBetween(
  db: D1Database,
  fromIso: string,
  toIsoExclusive: string,
): Promise<PromptRow[]> {
  const result = await db
    .prepare(
      `SELECT id, scheduled_for, sent_at, expires_at, response_token, notification_id, status, created_at
       FROM checkin_prompt
       WHERE scheduled_for >= ? AND scheduled_for < ? AND sent_at IS NOT NULL
       ORDER BY scheduled_for ASC`,
    )
    .bind(fromIso, toIsoExclusive)
    .all<PromptRow>();
  return result.results ?? [];
}

export async function listResponsesForSentPromptsBetween(
  db: D1Database,
  fromIso: string,
  toIsoExclusive: string,
): Promise<ResponseRow[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.prompt_id, r.feeling, r.intensity, r.note, r.confidence, r.vocab_era, r.observed_at, r.submitted_at
       FROM checkin_response r
       WHERE r.prompt_id IN (
         SELECT id FROM checkin_prompt
         WHERE scheduled_for >= ? AND scheduled_for < ? AND sent_at IS NOT NULL
       )
       ORDER BY r.observed_at ASC`,
    )
    .bind(fromIso, toIsoExclusive)
    .all<ResponseRow>();
  return result.results ?? [];
}

export interface WeeklySummaryRow {
  id: string;
  created_at: string;
  claimed_at: string | null;
  sent_at: string | null;
  notification_id: string | null;
  message: string | null;
}

export async function getWeeklySummary(
  db: D1Database,
  id: string,
): Promise<WeeklySummaryRow | null> {
  return db
    .prepare(
      "SELECT id, created_at, claimed_at, sent_at, notification_id, message FROM weekly_summary WHERE id = ?",
    )
    .bind(id)
    .first<WeeklySummaryRow>();
}

export type WeeklySummaryClaim = "send" | "reconcile" | "skip";

/**
 * Lease the week for sending in one atomic statement: a fresh insert wins,
 * and an existing row only yields when its claim is stale and no push was
 * ever accepted. A row that already recorded a Pushover acceptance returns
 * "reconcile" so the tick finishes the record instead of resending; a sent
 * or live-claimed row returns "skip".
 */
export async function claimWeeklySummary(
  db: D1Database,
  id: string,
  nowIso: string,
  staleBeforeIso: string,
): Promise<WeeklySummaryClaim> {
  const result = await db
    .prepare(
      `INSERT INTO weekly_summary (id, created_at, claimed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET claimed_at = excluded.claimed_at
       WHERE weekly_summary.sent_at IS NULL
         AND weekly_summary.notification_id IS NULL
         AND (weekly_summary.claimed_at IS NULL OR weekly_summary.claimed_at < ?)`,
    )
    .bind(id, nowIso, nowIso, staleBeforeIso)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return "send";
  }

  const existing = await getWeeklySummary(db, id);
  if (existing && existing.sent_at === null && existing.notification_id !== null) {
    return "reconcile";
  }
  return "skip";
}

export async function storeWeeklySummaryMessage(
  db: D1Database,
  id: string,
  message: string,
): Promise<void> {
  await db
    .prepare("UPDATE weekly_summary SET message = ? WHERE id = ?")
    .bind(message, id)
    .run();
}

export async function recordWeeklySummaryNotification(
  db: D1Database,
  id: string,
  notificationId: string,
): Promise<void> {
  await db
    .prepare("UPDATE weekly_summary SET notification_id = ? WHERE id = ?")
    .bind(notificationId, id)
    .run();
}

export async function completeWeeklySummary(
  db: D1Database,
  id: string,
  sentAt: string,
): Promise<void> {
  await db
    .prepare("UPDATE weekly_summary SET sent_at = ? WHERE id = ?")
    .bind(sentAt, id)
    .run();
}

export async function releaseWeeklySummary(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("DELETE FROM weekly_summary WHERE id = ? AND sent_at IS NULL")
    .bind(id)
    .run();
}

/**
 * True while a sent prompt in the range can still be answered: a response
 * (or a re-answer overwriting one) is accepted until expires_at. A summary
 * taken before every prompt closes would be superseded by later answers.
 */
export async function hasOpenSentPromptsBetween(
  db: D1Database,
  fromIso: string,
  toIsoExclusive: string,
  nowIso: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM checkin_prompt
       WHERE scheduled_for >= ? AND scheduled_for < ?
         AND sent_at IS NOT NULL
         AND expires_at IS NOT NULL
         AND expires_at > ?
       LIMIT 1`,
    )
    .bind(fromIso, toIsoExclusive, nowIso)
    .first<{ id: string }>();
  return row !== null;
}
