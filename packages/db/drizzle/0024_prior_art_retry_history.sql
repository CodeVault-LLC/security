-- Preserve the exact user-controlled options for every prior-art run and link
-- explicit retries to the failed or partially failed run they repeat.

ALTER TABLE prior_art_checks
  ADD COLUMN request_options jsonb NOT NULL
    DEFAULT '{"keywords":[],"skipAiSynthesis":false}'::jsonb,
  ADD COLUMN retry_of_check_id uuid
    REFERENCES prior_art_checks (id) ON DELETE SET NULL;

CREATE INDEX prior_art_checks_retry_idx
  ON prior_art_checks (retry_of_check_id);
