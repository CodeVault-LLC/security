ALTER TABLE organization_security_policies
  ADD COLUMN mcp_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE mcp_access_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  name text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_access_tokens_name_length_check
    CHECK (char_length(name) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX mcp_access_tokens_token_hash_key
  ON mcp_access_tokens (token_hash);
CREATE INDEX mcp_access_tokens_user_id_idx
  ON mcp_access_tokens (user_id, created_at DESC);
