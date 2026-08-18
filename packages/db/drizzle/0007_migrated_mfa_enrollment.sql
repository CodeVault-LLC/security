ALTER TABLE mfa_recovery_enrollments
  ADD COLUMN purpose text NOT NULL DEFAULT 'RECOVERY';

ALTER TABLE mfa_recovery_enrollments
  ADD CONSTRAINT mfa_recovery_enrollments_purpose_check
  CHECK (purpose IN ('RECOVERY', 'MIGRATED_ENROLLMENT'));
