ALTER TABLE sessions DROP CONSTRAINT sessions_mfa_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_mfa_method_check
  CHECK (mfa_method IN ('TOTP', 'WEBAUTHN'));

CREATE TABLE webauthn_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  device_type text NOT NULL,
  backed_up boolean NOT NULL,
  name text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_credentials_counter_check CHECK (counter >= 0),
  CONSTRAINT webauthn_credentials_device_type_check
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  CONSTRAINT webauthn_credentials_name_length_check
    CHECK (char_length(name) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX webauthn_credentials_credential_id_key
  ON webauthn_credentials (credential_id);
CREATE INDEX webauthn_credentials_user_idx
  ON webauthn_credentials (user_id, created_at DESC);

CREATE TABLE webauthn_ceremonies (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL,
  token_hash text NOT NULL,
  challenge text NOT NULL,
  source_key text NOT NULL,
  mfa_challenge_id uuid REFERENCES mfa_challenges (id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions (id) ON DELETE CASCADE,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_ceremonies_purpose_check
    CHECK (purpose IN ('LOGIN', 'REGISTRATION')),
  CONSTRAINT webauthn_ceremonies_attempts_check
    CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT webauthn_ceremonies_binding_check CHECK (
    (purpose = 'LOGIN' AND mfa_challenge_id IS NOT NULL AND session_id IS NULL)
    OR
    (purpose = 'REGISTRATION' AND session_id IS NOT NULL AND mfa_challenge_id IS NULL)
  )
);
CREATE UNIQUE INDEX webauthn_ceremonies_token_hash_key
  ON webauthn_ceremonies (token_hash);
CREATE INDEX webauthn_ceremonies_user_idx
  ON webauthn_ceremonies (user_id, created_at DESC);
