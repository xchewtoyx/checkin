-- Idempotency for the weekly mood-summary push (CCP-680).
-- One row per summarised ISO week. INSERT OR IGNORE is the claim;
-- sent_at is stamped only after Pushover accepts the message, so a
-- failed send can be retried on the next cron tick.
CREATE TABLE IF NOT EXISTS weekly_summary (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    sent_at         TEXT,
    notification_id TEXT,
    message         TEXT
);
