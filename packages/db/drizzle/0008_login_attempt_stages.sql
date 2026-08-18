ALTER TABLE login_attempts
  ADD COLUMN stage text NOT NULL DEFAULT 'PASSWORD',
  ADD CONSTRAINT login_attempts_stage_check
    CHECK (stage IN ('PASSWORD', 'MFA'));

CREATE INDEX login_attempts_email_stage_idx
  ON login_attempts (lower(email), stage, created_at DESC);

CREATE INDEX login_attempts_source_stage_idx
  ON login_attempts (source_key, stage, created_at DESC);
