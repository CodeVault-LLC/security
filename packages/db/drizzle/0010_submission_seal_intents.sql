CREATE TABLE submission_seal_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id),
  submission_revision integer NOT NULL CHECK (submission_revision > 0),
  artifact_id uuid NOT NULL REFERENCES artifacts(id),
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_seal_intents_manifest_object
    CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT submission_seal_intents_expiry_order
    CHECK (expires_at > created_at),
  CONSTRAINT submission_seal_intents_consumed_order
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX submission_seal_intents_submission_idx
  ON submission_seal_intents (submission_id, created_at);

-- A digest verifies bytes; it is not an identity. Different submissions may
-- legitimately produce identical packages, and rejecting those packages also
-- leaks whether the digest already exists in this workspace.
DROP INDEX submission_packages_sha256_key;
CREATE INDEX submission_packages_sha256_idx
  ON submission_packages (package_sha256);

CREATE FUNCTION submission_seal_intents_consume_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
    OR NEW.submission_revision IS DISTINCT FROM OLD.submission_revision
    OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'submission seal intents are immutable except for one-time consumption'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER submission_seal_intents_consume_once
  BEFORE UPDATE ON submission_seal_intents
  FOR EACH ROW EXECUTE FUNCTION submission_seal_intents_consume_once();

CREATE OR REPLACE RULE submission_seal_intents_no_delete AS
  ON DELETE TO submission_seal_intents DO INSTEAD NOTHING;
