ALTER TABLE organization_security_policies
  ADD COLUMN phishing_resistant_mfa_required boolean NOT NULL DEFAULT false;
ALTER TABLE organization_security_policies
  ADD CONSTRAINT organization_security_policy_phishing_resistant_mfa_check
    CHECK (NOT phishing_resistant_mfa_required OR mfa_required);

ALTER TABLE webauthn_ceremonies
  DROP CONSTRAINT webauthn_ceremonies_purpose_check;
ALTER TABLE webauthn_ceremonies
  ADD CONSTRAINT webauthn_ceremonies_purpose_check
    CHECK (purpose IN ('LOGIN', 'REGISTRATION', 'STEP_UP'));

ALTER TABLE webauthn_ceremonies
  DROP CONSTRAINT webauthn_ceremonies_binding_check;
ALTER TABLE webauthn_ceremonies
  ADD CONSTRAINT webauthn_ceremonies_binding_check CHECK (
    (purpose = 'LOGIN' AND mfa_challenge_id IS NOT NULL AND session_id IS NULL)
    OR
    (purpose IN ('REGISTRATION', 'STEP_UP') AND session_id IS NOT NULL AND mfa_challenge_id IS NULL)
  );
