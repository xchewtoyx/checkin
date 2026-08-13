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

export interface ResponseRow {
  id: string;
  prompt_id: string;
  feeling: string;
  intensity: number;
  observed_at: string;
  submitted_at: string;
}

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
      `INSERT INTO checkin_response (id, prompt_id, feeling, intensity, observed_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         feeling = excluded.feeling,
         intensity = excluded.intensity,
         observed_at = excluded.observed_at,
         submitted_at = excluded.submitted_at`,
    )
    .bind(
      row.id,
      row.prompt_id,
      row.feeling,
      row.intensity,
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
    "SELECT id, prompt_id, feeling, intensity, observed_at, submitted_at FROM checkin_response";
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
