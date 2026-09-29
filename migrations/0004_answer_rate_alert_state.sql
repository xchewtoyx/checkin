-- Standing G1 answer-rate alert hysteresis (CCP-682 / #73).
-- notified_status is the last *notified* band (ok|breach), not the last
-- evaluation: unevaluable windows must not flip it, and a sustained
-- breach must not re-notify.
CREATE TABLE IF NOT EXISTS checkin_alert_state (
    id               TEXT PRIMARY KEY,
    notified_status  TEXT CHECK (notified_status IS NULL OR notified_status IN ('ok', 'breach')),
    evaluated_at     TEXT NOT NULL,
    answered         INTEGER NOT NULL,
    sent             INTEGER NOT NULL,
    rate             REAL,
    window_from      TEXT NOT NULL,
    window_to        TEXT NOT NULL
);
