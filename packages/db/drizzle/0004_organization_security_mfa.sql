-- The organization is the deployment's top-level security boundary. This
-- migration intentionally aborts before changing data if a legacy install has
-- accounts but no enabled administrator to take ownership of it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users)
     AND NOT EXISTS (
       SELECT 1 FROM users WHERE role = 'ADMIN' AND disabled = false
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'existing installation has no active administrator';
  END IF;
END
$$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  singleton_key smallint NOT NULL DEFAULT 1,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_singleton_key_check CHECK (singleton_key = 1),
  CONSTRAINT organizations_name_check CHECK (
    length(btrim(name)) BETWEEN 2 AND 120
  )
);

CREATE UNIQUE INDEX organizations_singleton_key ON organizations (singleton_key);

CREATE TABLE organization_security_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  mfa_required boolean NOT NULL DEFAULT true,
  invite_ttl_hours integer NOT NULL DEFAULT 72,
  session_idle_minutes integer NOT NULL DEFAULT 30,
  session_absolute_hours integer NOT NULL DEFAULT 12,
  recent_mfa_minutes integer NOT NULL DEFAULT 10,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_security_policy_mfa_check CHECK (mfa_required),
  CONSTRAINT organization_security_policy_invite_ttl_check
    CHECK (invite_ttl_hours BETWEEN 1 AND 72),
  CONSTRAINT organization_security_policy_idle_check
    CHECK (session_idle_minutes BETWEEN 5 AND 120),
  CONSTRAINT organization_security_policy_absolute_check
    CHECK (session_absolute_hours BETWEEN 1 AND 24),
  CONSTRAINT organization_security_policy_recent_mfa_check
    CHECK (recent_mfa_minutes BETWEEN 5 AND 30)
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_memberships_role_check
    CHECK (role IN ('ADMIN', 'MEMBER', 'VIEWER'))
);

CREATE UNIQUE INDEX organization_memberships_user_key
  ON organization_memberships (user_id);

INSERT INTO organizations (id, singleton_key, name)
SELECT gen_random_uuid(), 1, 'CodeVault Organization'
WHERE EXISTS (SELECT 1 FROM users);

INSERT INTO organization_security_policies (organization_id)
SELECT id FROM organizations;

INSERT INTO organization_memberships (organization_id, user_id, role, joined_at)
SELECT organizations.id, users.id, users.role, users.created_at
FROM organizations
CROSS JOIN users;

DO $$
DECLARE
  user_count bigint;
  membership_count bigint;
BEGIN
  SELECT count(*) INTO user_count FROM users;
  SELECT count(*) INTO membership_count FROM organization_memberships;

  IF user_count <> membership_count THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'organization membership backfill was incomplete';
  END IF;
END
$$;

ALTER TABLE organization_security_policies
  ADD CONSTRAINT organization_security_policies_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE invites ADD COLUMN organization_id uuid;
UPDATE invites
SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE invites ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invites
  ADD CONSTRAINT invites_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
CREATE INDEX invites_organization_idx ON invites (organization_id, created_at DESC);

ALTER TABLE sessions
  ADD COLUMN mfa_verified_at timestamptz,
  ADD COLUMN mfa_method text;
UPDATE sessions
SET revoked_at = coalesce(revoked_at, now()),
    mfa_verified_at = created_at,
    mfa_method = 'TOTP';
ALTER TABLE sessions
  ALTER COLUMN mfa_verified_at SET NOT NULL,
  ALTER COLUMN mfa_method SET NOT NULL,
  ALTER COLUMN mfa_method SET DEFAULT 'TOTP';
ALTER TABLE sessions
  ADD CONSTRAINT sessions_mfa_method_check CHECK (mfa_method = 'TOTP');

CREATE TABLE totp_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  key_id text NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  auth_tag text NOT NULL,
  last_accepted_counter bigint,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  CONSTRAINT totp_credentials_counter_check
    CHECK (last_accepted_counter IS NULL OR last_accepted_counter >= 0),
  CONSTRAINT totp_credentials_envelope_check CHECK (
    length(key_id) BETWEEN 1 AND 64
    AND length(nonce) BETWEEN 16 AND 32
    AND length(ciphertext) >= 1
    AND length(auth_tag) BETWEEN 16 AND 32
  )
);

CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_id text NOT NULL,
  digest text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_recovery_codes_digest_check
    CHECK (digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (user_id, digest)
);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);

CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  source_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_challenges_purpose_check
    CHECK (purpose IN ('LOGIN', 'MIGRATED_ENROLLMENT', 'STEP_UP', 'RECOVERY')),
  CONSTRAINT mfa_challenges_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mfa_challenges_attempts_check CHECK (attempt_count BETWEEN 0 AND 5)
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges (user_id, created_at DESC);

CREATE TABLE invite_enrollments (
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL UNIQUE REFERENCES invites (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  key_id text NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  auth_tag text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_enrollments_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invite_enrollments_attempts_check CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT invite_enrollments_display_name_check
    CHECK (length(btrim(display_name)) BETWEEN 1 AND 120)
);

CREATE TABLE mfa_recovery_enrollments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  key_id text NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  auth_tag text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_recovery_enrollments_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mfa_recovery_enrollments_attempts_check
    CHECK (attempt_count BETWEEN 0 AND 5)
);

CREATE TABLE security_notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT security_notifications_details_object_check
    CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX security_notifications_user_unread_idx
  ON security_notifications (user_id, read_at, occurred_at DESC);

ALTER TABLE cases ADD COLUMN organization_id uuid;
UPDATE cases SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE cases ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE cases ADD CONSTRAINT cases_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT;
CREATE INDEX cases_organization_idx ON cases (organization_id);

ALTER TABLE assets ADD COLUMN organization_id uuid;
UPDATE assets SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE assets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE assets ADD CONSTRAINT assets_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT;
CREATE INDEX assets_organization_idx ON assets (organization_id);

ALTER TABLE reference_sequences ADD COLUMN organization_id uuid;
UPDATE reference_sequences
SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE reference_sequences ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reference_sequences DROP CONSTRAINT reference_sequences_pkey;
ALTER TABLE reference_sequences
  ADD CONSTRAINT reference_sequences_pkey
  PRIMARY KEY (organization_id, kind, year);
ALTER TABLE reference_sequences
  ADD CONSTRAINT reference_sequences_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;

ALTER TABLE ai_provider_policies ADD COLUMN organization_id uuid;
UPDATE ai_provider_policies
SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE ai_provider_policies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ai_provider_policies DROP CONSTRAINT ai_provider_policies_pkey;
ALTER TABLE ai_provider_policies
  ADD CONSTRAINT ai_provider_policies_pkey
  PRIMARY KEY (organization_id, provider_id);
ALTER TABLE ai_provider_policies
  ADD CONSTRAINT ai_provider_policies_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;

DROP RULE audit_events_no_update ON audit_events;
DROP RULE audit_events_no_delete ON audit_events;
ALTER TABLE audit_events ADD COLUMN organization_id uuid;
UPDATE audit_events
SET organization_id = (SELECT id FROM organizations WHERE singleton_key = 1);
ALTER TABLE audit_events ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT;
CREATE INDEX audit_events_organization_idx
  ON audit_events (organization_id, created_at DESC);
CREATE RULE audit_events_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

ALTER TABLE artifacts DROP CONSTRAINT artifacts_status_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_status_check CHECK (
  status IN ('PENDING', 'VERIFYING', 'STORED', 'QUARANTINED', 'REJECTED', 'DELETED')
);

CREATE TABLE avatar_images (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target text NOT NULL,
  target_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  target_organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'AWAITING_UPLOAD',
  original_filename text NOT NULL,
  declared_size_bytes bigint NOT NULL,
  declared_sha256 text NOT NULL,
  observed_size_bytes bigint,
  observed_sha256 text,
  quarantine_object_key text NOT NULL UNIQUE,
  sanitized_object_key text,
  sanitized_sha256 text,
  width integer,
  height integer,
  rejection_code text,
  requested_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_images_target_check CHECK (target IN ('ORGANIZATION', 'USER')),
  CONSTRAINT avatar_images_status_check CHECK (
    status IN ('AWAITING_UPLOAD', 'QUARANTINED', 'PROCESSING', 'READY', 'REJECTED', 'SUPERSEDED')
  ),
  CONSTRAINT avatar_images_target_shape_check CHECK (
    (target = 'USER' AND target_user_id IS NOT NULL AND target_organization_id IS NULL)
    OR (target = 'ORGANIZATION' AND target_user_id IS NULL AND target_organization_id IS NOT NULL)
  ),
  CONSTRAINT avatar_images_declared_size_check
    CHECK (declared_size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT avatar_images_declared_sha_check
    CHECK (declared_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT avatar_images_observed_size_check
    CHECK (observed_size_bytes IS NULL OR observed_size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT avatar_images_dimensions_check CHECK (
    (width IS NULL AND height IS NULL)
    OR (width BETWEEN 1 AND 512 AND height BETWEEN 1 AND 512)
  )
);
CREATE UNIQUE INDEX avatar_images_ready_user_key ON avatar_images (target_user_id)
  WHERE status = 'READY' AND target_user_id IS NOT NULL;
CREATE UNIQUE INDEX avatar_images_ready_organization_key
  ON avatar_images (target_organization_id)
  WHERE status = 'READY' AND target_organization_id IS NOT NULL;
CREATE INDEX avatar_images_organization_idx
  ON avatar_images (organization_id, created_at DESC);

CREATE TABLE media_jobs (
  id uuid PRIMARY KEY,
  purpose text NOT NULL,
  target_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED',
  input_object_key text NOT NULL,
  output_object_key text,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  failure_code text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_jobs_purpose_check CHECK (
    purpose IN ('AVATAR_SANITIZE', 'ARTIFACT_INTEGRITY', 'ARTIFACT_PREVIEW')
  ),
  CONSTRAINT media_jobs_state_check CHECK (
    state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')
  ),
  CONSTRAINT media_jobs_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX media_jobs_active_target_key ON media_jobs (purpose, target_id)
  WHERE state IN ('QUEUED', 'RUNNING');
CREATE INDEX media_jobs_claim_idx ON media_jobs (state, available_at);

-- Evaluate the invariant at transaction commit so bootstrap, role swaps and
-- administrator replacement can be atomic. Scanning the singleton table is
-- intentional and avoids trigger-shape mistakes on cascaded user changes.
CREATE FUNCTION assert_single_active_organization_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      JOIN public.users AS account ON account.id = membership.user_id
      WHERE membership.organization_id = organization.id
        AND membership.role = 'ADMIN'
        AND account.disabled = false
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'organization must retain an active administrator',
      CONSTRAINT = 'organization_requires_active_admin';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER organizations_require_active_admin
AFTER INSERT OR UPDATE OR DELETE ON organizations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_single_active_organization_admin();

CREATE CONSTRAINT TRIGGER memberships_require_active_admin
AFTER INSERT OR UPDATE OR DELETE ON organization_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_single_active_organization_admin();

CREATE CONSTRAINT TRIGGER users_require_active_admin
AFTER UPDATE OF disabled OR DELETE ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_single_active_organization_admin();

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users DROP COLUMN role;
