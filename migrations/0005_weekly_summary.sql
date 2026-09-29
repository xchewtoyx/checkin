-- One row per week the summary push has already sent (CCP-680).
CREATE TABLE IF NOT EXISTS weekly_summary (
    id      TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
);
