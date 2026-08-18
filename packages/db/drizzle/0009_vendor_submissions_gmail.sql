-- Vendor directory, disclosure submissions, and Gmail coordination.
--
-- Secrets are stored only as versioned AES-GCM envelopes. Immutable evidence
-- tables reject UPDATE and DELETE at the database layer. Route snapshots bind
-- a submission to the exact vendor/route facts a human reviewed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Vendor directory
-- ---------------------------------------------------------------------------

CREATE TABLE vendors (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  website_url text,
  built_in boolean NOT NULL DEFAULT false,
  built_in_modified_at timestamptz,
  source_url text,
  source_reviewed_at timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendors_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT vendors_normalized_name_not_blank CHECK (btrim(normalized_name) <> ''),
  CONSTRAINT vendors_source_https CHECK (source_url IS NULL OR source_url ~ '^https://'),
  CONSTRAINT vendors_website_https CHECK (website_url IS NULL OR website_url ~ '^https://')
);

CREATE UNIQUE INDEX vendors_ref_key ON vendors (ref);
CREATE UNIQUE INDEX vendors_slug_key ON vendors (slug);
CREATE UNIQUE INDEX vendors_normalized_name_key ON vendors (normalized_name);
CREATE INDEX vendors_active_name_idx ON vendors (archived_at, name);

CREATE TABLE vendor_public_keys (
  id uuid PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  armored_key text NOT NULL,
  fingerprint text NOT NULL,
  user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  algorithm text NOT NULL,
  key_created_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  source_url text NOT NULL,
  verified_by uuid REFERENCES users (id),
  verified_at timestamptz,
  superseded_by_id uuid,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_public_keys_fingerprint_check CHECK (
    fingerprint ~ '^(?:[0-9A-F]{40}|[0-9A-F]{64})$'
  ),
  CONSTRAINT vendor_public_keys_user_ids_array CHECK (jsonb_typeof(user_ids) = 'array'),
  CONSTRAINT vendor_public_keys_source_https CHECK (source_url ~ '^https://'),
  CONSTRAINT vendor_public_keys_verification_shape CHECK (
    (verified_at IS NULL AND verified_by IS NULL)
    OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)
  ),
  CONSTRAINT vendor_public_keys_expiry_order CHECK (
    expires_at IS NULL OR expires_at >= key_created_at
  )
);

ALTER TABLE vendor_public_keys
  ADD CONSTRAINT vendor_public_keys_superseded_by_fk
  FOREIGN KEY (superseded_by_id) REFERENCES vendor_public_keys (id);

CREATE UNIQUE INDEX vendor_public_keys_fingerprint_key
  ON vendor_public_keys (vendor_id, fingerprint);
CREATE INDEX vendor_public_keys_vendor_idx
  ON vendor_public_keys (vendor_id, created_at);

CREATE TABLE vendor_routes (
  id uuid PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  name text NOT NULL,
  type text NOT NULL,
  requirements jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  built_in boolean NOT NULL DEFAULT false,
  built_in_modified_at timestamptz,
  source_url text,
  source_reviewed_at timestamptz,
  created_by uuid REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_routes_type_check CHECK (type IN ('EMAIL', 'MANUAL')),
  CONSTRAINT vendor_routes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT vendor_routes_source_https CHECK (source_url IS NULL OR source_url ~ '^https://'),
  CONSTRAINT vendor_routes_requirements_object CHECK (jsonb_typeof(requirements) = 'object'),
  CONSTRAINT vendor_routes_requirements_type_check CHECK (
    (type = 'EMAIL'
      AND requirements ->> 'type' = 'EMAIL'
      AND jsonb_typeof(requirements -> 'to') = 'array'
      AND jsonb_array_length(requirements -> 'to') BETWEEN 1 AND 10
      AND requirements ->> 'encryptionPolicy' IN ('FORBIDDEN', 'OPTIONAL', 'REQUIRED')
      AND (
        requirements ->> 'encryptionPolicy' <> 'REQUIRED'
        OR nullif(requirements ->> 'publicKeyId', '') IS NOT NULL
      ))
    OR
    (type = 'MANUAL'
      AND requirements ->> 'type' = 'MANUAL'
      AND requirements ->> 'destinationUrl' ~ '^https://'
      AND jsonb_typeof(requirements -> 'fieldMappings') = 'array')
  )
);

CREATE UNIQUE INDEX vendor_routes_name_key ON vendor_routes (vendor_id, lower(name));
CREATE INDEX vendor_routes_vendor_idx ON vendor_routes (vendor_id, active);

-- Preserve free-text vendor names for one release while application writes move
-- to vendor_id. PostgreSQL updates the generated search expression when the
-- source column is renamed.
ALTER TABLE assets RENAME COLUMN vendor TO legacy_vendor_name;
ALTER TABLE assets ADD COLUMN vendor_id uuid;

WITH legacy_names AS (
  SELECT
    regexp_replace(lower(btrim(legacy_vendor_name)), '\s+', ' ', 'g') AS normalized_name,
    min(btrim(legacy_vendor_name)) AS display_name
  FROM assets
  WHERE nullif(btrim(legacy_vendor_name), '') IS NOT NULL
  GROUP BY regexp_replace(lower(btrim(legacy_vendor_name)), '\s+', ' ', 'g')
), numbered AS (
  SELECT
    normalized_name,
    display_name,
    row_number() OVER (ORDER BY normalized_name) AS sequence
  FROM legacy_names
)
INSERT INTO vendors (id, ref, slug, name, normalized_name)
SELECT
  gen_random_uuid(),
  'VND-' || lpad(sequence::text, 6, '0'),
  'legacy-' || substr(md5(normalized_name), 1, 20),
  display_name,
  normalized_name
FROM numbered;

UPDATE assets AS asset
SET vendor_id = vendor.id
FROM vendors AS vendor
WHERE nullif(btrim(asset.legacy_vendor_name), '') IS NOT NULL
  AND regexp_replace(lower(btrim(asset.legacy_vendor_name)), '\s+', ' ', 'g') = vendor.normalized_name;

ALTER TABLE assets
  ADD CONSTRAINT assets_vendor_id_fk FOREIGN KEY (vendor_id) REFERENCES vendors (id);
CREATE INDEX assets_vendor_id_idx ON assets (vendor_id);

INSERT INTO reference_sequences (organization_id, kind, year, value)
SELECT organization.id, 'vendor', 0, count(vendor.id)::integer
FROM organizations AS organization
LEFT JOIN vendors AS vendor ON true
GROUP BY organization.id
ON CONFLICT (organization_id, kind, year) DO UPDATE
SET value = greatest(reference_sequences.value, excluded.value);

INSERT INTO reference_sequences (organization_id, kind, year, value)
SELECT id, 'submission', 0, 0 FROM organizations
ON CONFLICT (organization_id, kind, year) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Per-user mailbox connections
-- ---------------------------------------------------------------------------

CREATE TABLE mailbox_connections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_account_id text NOT NULL,
  email_address text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_nonce bytea NOT NULL,
  refresh_token_auth_tag bytea NOT NULL,
  token_key_version integer NOT NULL,
  history_id text,
  watch_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_category text,
  last_error_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_connections_provider_check CHECK (
    provider IN ('gmail', 'outlook', 'smtp')
  ),
  CONSTRAINT mailbox_connections_status_check CHECK (
    status IN ('ACTIVE', 'REAUTH_REQUIRED', 'WATCH_EXPIRED', 'ERROR')
  ),
  CONSTRAINT mailbox_connections_capabilities_array CHECK (
    jsonb_typeof(capabilities) = 'array'
  ),
  CONSTRAINT mailbox_connections_scopes_array CHECK (
    jsonb_typeof(granted_scopes) = 'array'
  ),
  CONSTRAINT mailbox_connections_email_header_safe CHECK (
    email_address <> '' AND email_address !~ E'[\r\n]'
  ),
  CONSTRAINT mailbox_connections_token_envelope_check CHECK (
    octet_length(refresh_token_ciphertext) > 0
    AND octet_length(refresh_token_nonce) = 12
    AND octet_length(refresh_token_auth_tag) = 16
    AND token_key_version > 0
  )
);

CREATE UNIQUE INDEX mailbox_connections_provider_account_key
  ON mailbox_connections (provider, external_account_id);
CREATE INDEX mailbox_connections_user_idx
  ON mailbox_connections (user_id, provider);
CREATE INDEX mailbox_connections_watch_idx
  ON mailbox_connections (watch_expires_at);

CREATE TABLE mailbox_sync_events (
  id uuid PRIMARY KEY,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connections (id) ON DELETE CASCADE,
  notification_id text,
  email_address_hash text,
  history_id text,
  outcome text NOT NULL,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_sync_events_outcome_check CHECK (
    outcome IN ('ENQUEUED', 'DUPLICATE', 'PROCESSED', 'REJECTED', 'FAILED')
  ),
  CONSTRAINT mailbox_sync_events_email_hash_check CHECK (
    email_address_hash IS NULL OR email_address_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX mailbox_sync_events_notification_key
  ON mailbox_sync_events (mailbox_connection_id, notification_id)
  WHERE notification_id IS NOT NULL;
CREATE INDEX mailbox_sync_events_connection_idx
  ON mailbox_sync_events (mailbox_connection_id, created_at);

-- ---------------------------------------------------------------------------
-- Submission aggregate and immutable package evidence
-- ---------------------------------------------------------------------------

CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  route_id uuid NOT NULL REFERENCES vendor_routes (id),
  route_snapshot jsonb NOT NULL,
  mailbox_connection_id uuid REFERENCES mailbox_connections (id) ON DELETE SET NULL,
  report_export_id uuid REFERENCES report_exports (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  coordination_state text NOT NULL DEFAULT 'PREPARING',
  crypto_mode text NOT NULL DEFAULT 'PLAIN',
  subject text NOT NULL DEFAULT '',
  body_markdown text NOT NULL DEFAULT '',
  manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  planned_next_contact_at timestamptz,
  agreed_disclosure_at timestamptz,
  vendor_reference text,
  coordination_notes text,
  snoozed_until timestamptz,
  snooze_reason text,
  created_by uuid NOT NULL REFERENCES users (id),
  last_edited_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_status_check CHECK (
    status IN (
      'DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'SENDING', 'SENT',
      'SEND_FAILED', 'RECORDED_MANUALLY', 'CANCELLED'
    )
  ),
  CONSTRAINT submissions_coordination_state_check CHECK (
    coordination_state IN (
      'PREPARING', 'AWAITING_ACKNOWLEDGEMENT', 'ACKNOWLEDGED',
      'NEEDS_INFORMATION', 'IN_TRIAGE', 'IN_REMEDIATION', 'FIX_AVAILABLE',
      'COORDINATING_DISCLOSURE', 'RESOLVED', 'CLOSED'
    )
  ),
  CONSTRAINT submissions_crypto_mode_check CHECK (
    crypto_mode IN ('PLAIN', 'ENCRYPTED', 'SIGNED_AND_ENCRYPTED')
  ),
  CONSTRAINT submissions_subject_header_safe CHECK (subject !~ E'[\r\n]'),
  CONSTRAINT submissions_manual_fields_object CHECK (jsonb_typeof(manual_fields) = 'object'),
  CONSTRAINT submissions_route_snapshot_check CHECK (
    jsonb_typeof(route_snapshot) = 'object'
    AND route_snapshot ->> 'vendorId' = vendor_id::text
    AND route_snapshot ->> 'routeId' = route_id::text
    AND jsonb_typeof(route_snapshot -> 'route') = 'object'
  ),
  CONSTRAINT submissions_snooze_shape_check CHECK (
    (snoozed_until IS NULL AND snooze_reason IS NULL)
    OR (snoozed_until IS NOT NULL AND nullif(btrim(snooze_reason), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX submissions_ref_key ON submissions (ref);
CREATE INDEX submissions_case_idx ON submissions (case_id, created_at);
CREATE INDEX submissions_vendor_idx ON submissions (vendor_id, created_at);
CREATE INDEX submissions_attention_idx
  ON submissions (coordination_state, planned_next_contact_at);

CREATE TABLE submission_revisions (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  revision integer NOT NULL,
  subject text NOT NULL,
  body_markdown text NOT NULL,
  manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  crypto_mode text NOT NULL,
  authored_by uuid NOT NULL REFERENCES users (id),
  ai_run_id uuid REFERENCES ai_runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT submission_revisions_subject_header_safe CHECK (subject !~ E'[\r\n]'),
  CONSTRAINT submission_revisions_manual_fields_object CHECK (jsonb_typeof(manual_fields) = 'object'),
  CONSTRAINT submission_revisions_crypto_mode_check CHECK (
    crypto_mode IN ('PLAIN', 'ENCRYPTED', 'SIGNED_AND_ENCRYPTED')
  )
);

CREATE UNIQUE INDEX submission_revisions_unique
  ON submission_revisions (submission_id, revision);

CREATE TABLE submission_attachments (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  position integer NOT NULL,
  source_revision integer,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_attachments_position_check CHECK (position >= 0),
  CONSTRAINT submission_attachments_source_revision_check CHECK (
    source_revision IS NULL OR source_revision > 0
  )
);

CREATE UNIQUE INDEX submission_attachments_artifact_key
  ON submission_attachments (submission_id, artifact_id);
CREATE UNIQUE INDEX submission_attachments_position_key
  ON submission_attachments (submission_id, position);

CREATE TABLE submission_approvals (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  submission_revision integer NOT NULL,
  approved_by uuid NOT NULL REFERENCES users (id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_approvals_revision_check CHECK (submission_revision > 0)
);

CREATE UNIQUE INDEX submission_approvals_revision_key
  ON submission_approvals (submission_id, submission_revision);

CREATE TABLE submission_packages (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  intent_id uuid NOT NULL,
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL,
  package_sha256 text NOT NULL,
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  size_bytes bigint NOT NULL,
  rfc_message_id text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_packages_manifest_object CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT submission_packages_manifest_sha256_check CHECK (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT submission_packages_sha256_check CHECK (
    package_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT submission_packages_size_check CHECK (size_bytes > 0),
  CONSTRAINT submission_packages_message_id_safe CHECK (
    rfc_message_id IS NULL OR (rfc_message_id ~ '^<[^<>]+>$' AND rfc_message_id !~ E'[\r\n]')
  )
);

CREATE UNIQUE INDEX submission_packages_intent_key ON submission_packages (intent_id);
CREATE UNIQUE INDEX submission_packages_sha256_key ON submission_packages (package_sha256);
CREATE INDEX submission_packages_submission_idx
  ON submission_packages (submission_id, created_at);

CREATE TABLE submission_deliveries (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  package_id uuid NOT NULL REFERENCES submission_packages (id),
  mailbox_connection_id uuid REFERENCES mailbox_connections (id) ON DELETE SET NULL,
  provider text,
  status text NOT NULL,
  provider_message_id text,
  provider_thread_id text,
  sender_address text,
  recipients jsonb NOT NULL DEFAULT '{"to":[],"cc":[]}'::jsonb,
  route_snapshot jsonb NOT NULL,
  sent_at timestamptz,
  response_size_bytes bigint,
  error_category text,
  error_message text,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_deliveries_status_check CHECK (
    status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'RECORDED_MANUALLY')
  ),
  CONSTRAINT submission_deliveries_recipients_object CHECK (
    jsonb_typeof(recipients) = 'object'
    AND jsonb_typeof(recipients -> 'to') = 'array'
    AND jsonb_typeof(recipients -> 'cc') = 'array'
  ),
  CONSTRAINT submission_deliveries_route_snapshot_object CHECK (
    jsonb_typeof(route_snapshot) = 'object'
  ),
  CONSTRAINT submission_deliveries_response_size_check CHECK (
    response_size_bytes IS NULL OR response_size_bytes >= 0
  ),
  CONSTRAINT submission_deliveries_sent_shape_check CHECK (
    status <> 'SENT'
    OR (
      provider IS NOT NULL
      AND mailbox_connection_id IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND provider_thread_id IS NOT NULL
      AND sender_address IS NOT NULL
      AND sent_at IS NOT NULL
    )
  ),
  CONSTRAINT submission_deliveries_manual_shape_check CHECK (
    status <> 'RECORDED_MANUALLY'
    OR (provider IS NULL AND mailbox_connection_id IS NULL AND sent_at IS NOT NULL)
  )
);

CREATE INDEX submission_deliveries_submission_idx
  ON submission_deliveries (submission_id, created_at);
CREATE INDEX submission_deliveries_provider_thread_idx
  ON submission_deliveries (mailbox_connection_id, provider_thread_id)
  WHERE provider_thread_id IS NOT NULL;

CREATE TABLE submission_delivery_attempts (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES submission_deliveries (id),
  attempt_number integer NOT NULL,
  outcome text NOT NULL,
  provider_request_id text,
  error_category text,
  error_message text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_delivery_attempts_number_check CHECK (attempt_number > 0),
  CONSTRAINT submission_delivery_attempts_outcome_check CHECK (
    outcome IN ('SENDING', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN')
  ),
  CONSTRAINT submission_delivery_attempts_time_check CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);

CREATE UNIQUE INDEX submission_delivery_attempts_number_key
  ON submission_delivery_attempts (delivery_id, attempt_number);

CREATE TABLE correspondence_messages (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id),
  delivery_id uuid REFERENCES submission_deliveries (id),
  mailbox_connection_id uuid REFERENCES mailbox_connections (id) ON DELETE SET NULL,
  direction text NOT NULL,
  provider_message_id text,
  provider_thread_id text,
  rfc_message_id text NOT NULL,
  in_reply_to text,
  "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  from_address text NOT NULL,
  to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  body_text text,
  body_encrypted text NOT NULL DEFAULT 'PLAIN',
  raw_artifact_id uuid NOT NULL REFERENCES artifacts (id),
  classification text NOT NULL DEFAULT 'UNREVIEWED',
  visibility text NOT NULL DEFAULT 'VENDOR',
  received_at timestamptz,
  sent_at timestamptz,
  reviewed_plaintext_saved_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correspondence_messages_direction_check CHECK (
    direction IN ('OUTBOUND', 'INBOUND')
  ),
  CONSTRAINT correspondence_messages_direction_time_check CHECK (
    (direction = 'OUTBOUND' AND sent_at IS NOT NULL AND received_at IS NULL)
    OR (direction = 'INBOUND' AND received_at IS NOT NULL AND sent_at IS NULL)
  ),
  CONSTRAINT correspondence_messages_message_id_safe CHECK (
    rfc_message_id !~ E'[\r\n]'
  ),
  CONSTRAINT correspondence_messages_headers_safe CHECK (
    from_address !~ E'[\r\n]' AND subject !~ E'[\r\n]'
  ),
  CONSTRAINT correspondence_messages_arrays_check CHECK (
    jsonb_typeof("references") = 'array'
    AND jsonb_typeof(to_addresses) = 'array'
    AND jsonb_typeof(cc_addresses) = 'array'
  ),
  CONSTRAINT correspondence_messages_encryption_check CHECK (
    body_encrypted IN ('PLAIN', 'OPENPGP')
  ),
  CONSTRAINT correspondence_messages_ciphertext_check CHECK (
    body_encrypted <> 'OPENPGP' OR body_text IS NULL
  ),
  CONSTRAINT correspondence_messages_classification_check CHECK (
    classification IN (
      'UNREVIEWED', 'AUTO_REPLY', 'ACKNOWLEDGEMENT',
      'REQUEST_FOR_INFORMATION', 'STATUS_UPDATE', 'FIX_AVAILABLE',
      'REJECTION', 'OTHER'
    )
  ),
  CONSTRAINT correspondence_messages_visibility_check CHECK (
    visibility IN ('VENDOR', 'PUBLIC')
  )
);

CREATE UNIQUE INDEX correspondence_messages_provider_key
  ON correspondence_messages (mailbox_connection_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX correspondence_messages_submission_idx
  ON correspondence_messages (submission_id, created_at);
CREATE INDEX correspondence_messages_thread_idx
  ON correspondence_messages (mailbox_connection_id, provider_thread_id)
  WHERE provider_thread_id IS NOT NULL;

-- The route and owning identities are part of what approval means. They cannot
-- drift through an ordinary mutable-submission update.
CREATE FUNCTION preserve_submission_identity() RETURNS trigger AS $$
BEGIN
  IF (NEW.case_id, NEW.vendor_id, NEW.route_id, NEW.route_snapshot)
     IS DISTINCT FROM
     (OLD.case_id, OLD.vendor_id, OLD.route_id, OLD.route_snapshot) THEN
    RAISE EXCEPTION 'submission identity and route snapshot are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_preserve_identity
BEFORE UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION preserve_submission_identity();

-- Immutable evidence. These rules also prevent cascaded deletion through the
-- normal owner role; submissions are cancelled/archived rather than erased.
CREATE RULE submission_revisions_no_update AS
  ON UPDATE TO submission_revisions DO INSTEAD NOTHING;
CREATE RULE submission_revisions_no_delete AS
  ON DELETE TO submission_revisions DO INSTEAD NOTHING;
CREATE RULE submission_approvals_no_update AS
  ON UPDATE TO submission_approvals DO INSTEAD NOTHING;
CREATE RULE submission_approvals_no_delete AS
  ON DELETE TO submission_approvals DO INSTEAD NOTHING;
CREATE RULE submission_packages_no_update AS
  ON UPDATE TO submission_packages DO INSTEAD NOTHING;
CREATE RULE submission_packages_no_delete AS
  ON DELETE TO submission_packages DO INSTEAD NOTHING;
CREATE RULE submission_delivery_attempts_no_update AS
  ON UPDATE TO submission_delivery_attempts DO INSTEAD NOTHING;
CREATE RULE submission_delivery_attempts_no_delete AS
  ON DELETE TO submission_delivery_attempts DO INSTEAD NOTHING;
CREATE RULE mailbox_sync_events_no_update AS
  ON UPDATE TO mailbox_sync_events DO INSTEAD NOTHING;
CREATE RULE mailbox_sync_events_no_delete AS
  ON DELETE TO mailbox_sync_events DO INSTEAD NOTHING;

-- AI actions introduced by the submission workflow remain proposals. Expanding
-- the target enum does not grant any write authority by itself.
ALTER TABLE ai_runs DROP CONSTRAINT ai_runs_target_type_check;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_target_type_check CHECK (
  target_type IN (
    'FINDING', 'SCORE', 'CLAIM', 'REPORT_SECTION',
    'SUBMISSION', 'CORRESPONDENCE_MESSAGE'
  )
);

ALTER TABLE ai_proposals DROP CONSTRAINT ai_proposals_target_type_check;
ALTER TABLE ai_proposals ADD CONSTRAINT ai_proposals_target_type_check CHECK (
  target_type IN (
    'FINDING', 'SCORE', 'CLAIM', 'REPORT_SECTION',
    'SUBMISSION', 'CORRESPONDENCE_MESSAGE'
  )
);
