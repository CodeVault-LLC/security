ALTER TABLE sessions DROP CONSTRAINT sessions_mfa_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_mfa_method_check
  CHECK (mfa_method IN ('PASSWORD', 'TOTP', 'WEBAUTHN'));
