CREATE TABLE mail_oauth_states (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  capabilities jsonb NOT NULL,
  verifier_ciphertext bytea NOT NULL,
  verifier_nonce bytea NOT NULL,
  verifier_auth_tag bytea NOT NULL,
  key_version integer NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_oauth_states_provider_check CHECK (provider = 'gmail'),
  CONSTRAINT mail_oauth_states_capabilities_array CHECK (jsonb_typeof(capabilities) = 'array'),
  CONSTRAINT mail_oauth_states_envelope_check CHECK (
    octet_length(verifier_ciphertext) > 0
    AND octet_length(verifier_nonce) = 12
    AND octet_length(verifier_auth_tag) = 16
    AND key_version > 0
  ),
  CONSTRAINT mail_oauth_states_redirect_safe CHECK (
    redirect_uri <> '' AND redirect_uri !~ E'[\r\n]'
  )
);

CREATE INDEX mail_oauth_states_expiry_idx ON mail_oauth_states (expires_at);
