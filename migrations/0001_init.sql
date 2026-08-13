CREATE TABLE IF NOT EXISTS checkin_prompt (
    id                TEXT PRIMARY KEY,
    scheduled_for     TEXT NOT NULL,
    sent_at           TEXT,
    expires_at        TEXT,
    response_token    TEXT NOT NULL UNIQUE,
    notification_id   TEXT,
    status            TEXT NOT NULL,
    created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkin_response (
    id                TEXT PRIMARY KEY,
    prompt_id         TEXT REFERENCES checkin_prompt(id),
    feeling           TEXT NOT NULL,
    intensity         INTEGER NOT NULL CHECK (intensity >= 1 AND intensity <= 10),
    observed_at       TEXT NOT NULL,
    submitted_at      TEXT NOT NULL
);
