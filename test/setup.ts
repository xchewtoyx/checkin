import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS checkin_prompt (
      id TEXT PRIMARY KEY,
      scheduled_for TEXT NOT NULL,
      sent_at TEXT,
      expires_at TEXT,
      response_token TEXT NOT NULL UNIQUE,
      notification_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS checkin_response (
      id TEXT PRIMARY KEY,
      prompt_id TEXT REFERENCES checkin_prompt(id),
      feeling TEXT NOT NULL,
      intensity INTEGER NOT NULL CHECK (intensity >= 1 AND intensity <= 10),
      note TEXT,
      confidence TEXT CHECK (confidence IS NULL OR confidence IN ('weak', 'strong')),
      vocab_era TEXT,
      observed_at TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    )`,
  ).run();
});
