-- Idempotency for the weekly mood-summary push (CCP-680).
-- One row per summarised ISO week. claimed_at is the send lease: the
-- atomic upsert in claimWeeklySummary only hands the week to a tick
-- with no rival claim. notification_id is written the moment Pushover
-- accepts the message — a row carrying it is reconciled, never resent.
-- sent_at marks the finished record.
CREATE TABLE IF NOT EXISTS weekly_summary (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    claimed_at      TEXT,
    notification_id TEXT,
    sent_at         TEXT,
    message         TEXT
);
