-- Additive columns on checkin_response (#1 §4 D1 evolution rule).
-- note: the optional check-in note, split out of `feeling` (#27). Rows
--   recorded before this migration keep their note embedded in `feeling`
--   as "word: note" and have note = NULL — see docs/analytics-extract.md.
-- confidence: optional weak/strong self-rating on the recorded feeling (#32).
ALTER TABLE checkin_response ADD COLUMN note TEXT;
ALTER TABLE checkin_response ADD COLUMN confidence TEXT
    CHECK (confidence IS NULL OR confidence IN ('weak', 'strong'));
