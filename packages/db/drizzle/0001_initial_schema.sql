-- CodeVault initial schema.
--
-- Written by hand rather than generated so that the parts a generator cannot
-- express -- generated tsvector columns, partial unique indexes, trigram
-- indexes and check constraints -- live in the same reviewable place as the
-- tables they protect.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Authentication
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'MEMBER',
  disabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'MEMBER', 'VIEWER'))
);

-- Email comparison is case-insensitive, so uniqueness must be too.
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES users (id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_role_check CHECK (role IN ('ADMIN', 'MEMBER', 'VIEWER'))
);

CREATE UNIQUE INDEX invites_token_hash_key ON invites (token_hash);
CREATE INDEX invites_email_idx ON invites (lower(email));

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE login_attempts (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  source_key text NOT NULL,
  successful boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
CREATE INDEX login_attempts_source_idx ON login_attempts (source_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- Reference sequences
-- ---------------------------------------------------------------------------

CREATE TABLE reference_sequences (
  kind text NOT NULL,
  year integer NOT NULL,
  value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

CREATE TABLE cases (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  title text NOT NULL,
  summary text,
  profile text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  owner_id uuid NOT NULL REFERENCES users (id),
  restricted boolean NOT NULL DEFAULT false,
  disclosure_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(ref, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'C')
  ) STORED,
  archived_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cases_profile_check CHECK (
    profile IN ('STANDARD', 'COORDINATED_DISCLOSURE', 'CRITICAL_ZERO_DAY', 'PROGRAM')
  ),
  CONSTRAINT cases_status_check CHECK (
    status IN ('OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED')
  )
);

CREATE UNIQUE INDEX cases_ref_key ON cases (ref);
CREATE INDEX cases_owner_idx ON cases (owner_id);
CREATE INDEX cases_status_idx ON cases (status);
CREATE INDEX cases_search_idx ON cases USING GIN (search_vector);
CREATE INDEX cases_title_trgm_idx ON cases USING GIN (title gin_trgm_ops);

CREATE TABLE case_members (
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access text NOT NULL,
  added_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id),
  CONSTRAINT case_members_access_check CHECK (access IN ('READ', 'WRITE'))
);

CREATE INDEX case_members_user_idx ON case_members (user_id);

CREATE TABLE case_notes (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  title text,
  body_markdown text NOT NULL,
  author_id uuid NOT NULL REFERENCES users (id),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_markdown, '')), 'B')
  ) STORED,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_notes_case_idx ON case_notes (case_id);
CREATE INDEX case_notes_search_idx ON case_notes USING GIN (search_vector);

CREATE TABLE policy_packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  profile text NOT NULL,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  built_in boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX policy_packs_profile_idx ON policy_packs (profile);

CREATE TABLE case_policy_packs (
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  policy_pack_id text NOT NULL REFERENCES policy_packs (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, policy_pack_id)
);

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  vendor text,
  version text,
  notes text,
  normalized_vendor text,
  normalized_product text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(ref, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(vendor, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(version, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) STORED,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_kind_check CHECK (
    kind IN (
      'SOFTWARE_COMPONENT', 'APPLICATION', 'SERVICE', 'API', 'DEVICE',
      'FIRMWARE', 'HARDWARE', 'HOST_SYSTEM', 'CLOUD_RESOURCE',
      'NETWORK_SERVICE', 'REPOSITORY', 'CONTAINER_IMAGE'
    )
  )
);

CREATE UNIQUE INDEX assets_ref_key ON assets (ref);
CREATE INDEX assets_kind_idx ON assets (kind);
CREATE INDEX assets_normalized_product_idx ON assets (normalized_product);
CREATE INDEX assets_search_idx ON assets USING GIN (search_vector);
CREATE INDEX assets_name_trgm_idx ON assets USING GIN (name gin_trgm_ops);
CREATE INDEX assets_vendor_trgm_idx ON assets USING GIN (vendor gin_trgm_ops);

CREATE TABLE asset_identifiers (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  scheme text NOT NULL,
  value text NOT NULL,
  "primary" boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_identifiers_scheme_check CHECK (
    scheme IN (
      'CPE23', 'PURL', 'SWID', 'REPOSITORY_URL', 'VENDOR_PRODUCT',
      'MODEL', 'SERIAL', 'CUSTOM'
    )
  )
);

CREATE UNIQUE INDEX asset_identifiers_unique
  ON asset_identifiers (asset_id, scheme, value);
CREATE INDEX asset_identifiers_value_idx ON asset_identifiers (scheme, value);
-- At most one primary identifier per asset.
CREATE UNIQUE INDEX asset_identifiers_primary_key
  ON asset_identifiers (asset_id) WHERE "primary";

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  version text NOT NULL,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX asset_versions_unique ON asset_versions (asset_id, version);

CREATE TABLE asset_relationships (
  id uuid PRIMARY KEY,
  from_asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  to_asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  relationship text NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_relationships_not_self CHECK (from_asset_id <> to_asset_id),
  CONSTRAINT asset_relationships_kind_check CHECK (
    relationship IN (
      'CONTAINS', 'DEPENDS_ON', 'RUNS_ON', 'EXPOSES', 'DEPLOYS_AS',
      'FIRMWARE_FOR', 'BUILT_FROM', 'RELATED_TO'
    )
  )
);

CREATE UNIQUE INDEX asset_relationships_unique
  ON asset_relationships (from_asset_id, to_asset_id, relationship);
CREATE INDEX asset_relationships_to_idx ON asset_relationships (to_asset_id);

CREATE TABLE case_assets (
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, asset_id)
);

CREATE INDEX case_assets_asset_idx ON case_assets (asset_id);

-- ---------------------------------------------------------------------------
-- Findings
-- ---------------------------------------------------------------------------

CREATE TABLE findings (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  title text NOT NULL,
  summary_markdown text,
  technical_markdown text,
  preconditions_markdown text,
  attack_path_markdown text,
  impact_markdown text,
  reproduction_markdown text,
  remediation_markdown text,
  researcher_notes_markdown text,
  validation_state text NOT NULL DEFAULT 'DRAFT',
  remediation_state text NOT NULL DEFAULT 'UNKNOWN',
  disclosure_state text NOT NULL DEFAULT 'PRIVATE',
  external_id_state text NOT NULL DEFAULT 'NONE',
  prior_art_state text NOT NULL DEFAULT 'UNCHECKED',
  visibility text NOT NULL DEFAULT 'INTERNAL',
  cwe_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text,
  score double precision,
  owner_id uuid NOT NULL REFERENCES users (id),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(ref, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_markdown, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(technical_markdown, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(impact_markdown, '')), 'C')
  ) STORED,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT findings_validation_check CHECK (
    validation_state IN ('DRAFT', 'REPRODUCED', 'PEER_REVIEWED', 'CONFIRMED', 'DISPUTED', 'INVALID')
  ),
  CONSTRAINT findings_remediation_check CHECK (
    remediation_state IN ('UNKNOWN', 'UNFIXED', 'FIX_PROPOSED', 'FIX_AVAILABLE', 'FIXED', 'FIX_VERIFIED', 'REGRESSED', 'NOT_APPLICABLE')
  ),
  CONSTRAINT findings_disclosure_check CHECK (
    disclosure_state IN ('PRIVATE', 'CONTACT_PREPARED', 'VENDOR_CONTACTED', 'ACKNOWLEDGED', 'COORDINATING', 'EMBARGOED', 'PUBLIC')
  ),
  CONSTRAINT findings_external_id_check CHECK (
    external_id_state IN ('NONE', 'CVE_REQUESTED', 'CVE_RESERVED', 'CVE_PUBLISHED', 'VENDOR_ID_ASSIGNED')
  ),
  CONSTRAINT findings_prior_art_check CHECK (
    prior_art_state IN ('UNCHECKED', 'NO_PRIOR_ART_FOUND', 'POSSIBLE_MATCH', 'LIKELY_KNOWN', 'CONFIRMED_KNOWN', 'HUMAN_CONFIRMED_NOVEL')
  ),
  CONSTRAINT findings_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  ),
  CONSTRAINT findings_severity_check CHECK (
    severity IS NULL OR severity IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  )
);

CREATE UNIQUE INDEX findings_ref_key ON findings (ref);
CREATE INDEX findings_case_idx ON findings (case_id);
CREATE INDEX findings_validation_idx ON findings (validation_state);
CREATE INDEX findings_disclosure_idx ON findings (disclosure_state);
CREATE INDEX findings_prior_art_idx ON findings (prior_art_state);
CREATE INDEX findings_severity_idx ON findings (severity);
CREATE INDEX findings_search_idx ON findings USING GIN (search_vector);
CREATE INDEX findings_title_trgm_idx ON findings USING GIN (title gin_trgm_ops);

CREATE TABLE finding_assets (
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  "primary" boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (finding_id, asset_id)
);

CREATE INDEX finding_assets_asset_idx ON finding_assets (asset_id);
-- A finding has at most one primary asset.
CREATE UNIQUE INDEX finding_assets_primary_key
  ON finding_assets (finding_id) WHERE "primary";

CREATE TABLE affected_ranges (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  kind text NOT NULL,
  expression text NOT NULL,
  status text NOT NULL,
  fixed_in text,
  evidence_note text,
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affected_ranges_kind_check CHECK (
    kind IN ('EXACT_VERSION', 'SEMVER_RANGE', 'VENDOR_EXPRESSION')
  ),
  CONSTRAINT affected_ranges_status_check CHECK (
    status IN ('CONFIRMED_VULNERABLE', 'INFERRED_AFFECTED', 'CONFIRMED_FIXED', 'CONFIRMED_NOT_VULNERABLE', 'UNKNOWN')
  )
);

CREATE INDEX affected_ranges_finding_idx ON affected_ranges (finding_id);
CREATE INDEX affected_ranges_asset_idx ON affected_ranges (asset_id);

CREATE TABLE finding_identifiers (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  scheme text NOT NULL,
  value text NOT NULL,
  url text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX finding_identifiers_unique
  ON finding_identifiers (finding_id, scheme, value);
CREATE INDEX finding_identifiers_value_idx ON finding_identifiers (value);

CREATE TABLE finding_scores (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  scheme text NOT NULL,
  vector text,
  score double precision,
  severity text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL,
  reasoning_markdown text,
  review_state text NOT NULL DEFAULT 'PROPOSED',
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  source_name text,
  retrieved_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finding_scores_source_check CHECK (
    source IN ('HUMAN', 'AI_PROPOSAL', 'EXTERNAL')
  ),
  CONSTRAINT finding_scores_review_check CHECK (
    review_state IN ('PROPOSED', 'APPROVED', 'SUPERSEDED')
  )
);

CREATE INDEX finding_scores_finding_idx ON finding_scores (finding_id, scheme);
CREATE INDEX finding_scores_review_idx ON finding_scores (review_state);
-- One approved score per scheme per finding; older ones become SUPERSEDED.
CREATE UNIQUE INDEX finding_scores_approved_key
  ON finding_scores (finding_id, scheme) WHERE review_state = 'APPROVED';

CREATE TABLE claims (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  key text NOT NULL,
  statement_markdown text NOT NULL,
  value jsonb,
  source_type text NOT NULL,
  source_ref text,
  confidence text NOT NULL,
  visibility text NOT NULL,
  reviewed_by uuid REFERENCES users (id),
  retrieved_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_source_type_check CHECK (
    source_type IN ('EVIDENCE', 'EXTERNAL', 'HUMAN', 'AI_PROPOSAL')
  ),
  CONSTRAINT claims_confidence_check CHECK (
    confidence IN ('LOW', 'MEDIUM', 'HIGH', 'AUTHORITATIVE')
  ),
  CONSTRAINT claims_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  )
);

CREATE INDEX claims_finding_idx ON claims (finding_id);
CREATE INDEX claims_key_idx ON claims (key);

CREATE TABLE external_references (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  finding_id uuid REFERENCES findings (id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases (id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  note text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_references_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  )
);

CREATE UNIQUE INDEX external_references_ref_key ON external_references (ref);
CREATE INDEX external_references_finding_idx ON external_references (finding_id);

CREATE TABLE prior_art_checks (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'QUEUED',
  sources_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis jsonb,
  human_conclusion text,
  concluded_by uuid REFERENCES users (id),
  concluded_at timestamptz,
  conclusion_note text,
  failure_reason text,
  started_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT prior_art_checks_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')
  )
);

CREATE INDEX prior_art_checks_finding_idx ON prior_art_checks (finding_id, created_at DESC);

CREATE TABLE prior_art_matches (
  id uuid PRIMARY KEY,
  check_id uuid NOT NULL REFERENCES prior_art_checks (id) ON DELETE CASCADE,
  origin text NOT NULL,
  provider text NOT NULL,
  external_id text,
  matched_finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  title text NOT NULL,
  url text,
  publisher text,
  published_at timestamptz,
  affected_identity text,
  summary text NOT NULL,
  query text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  similarity real NOT NULL DEFAULT 0,
  ai_relationship text,
  ai_reasoning text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prior_art_matches_origin_check CHECK (origin IN ('INTERNAL', 'EXTERNAL')),
  CONSTRAINT prior_art_matches_relationship_check CHECK (
    ai_relationship IS NULL OR ai_relationship IN ('SAME', 'RELATED', 'DIFFERENT')
  )
);

CREATE INDEX prior_art_matches_check_idx ON prior_art_matches (check_id);
CREATE INDEX prior_art_matches_external_idx ON prior_art_matches (external_id);

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

CREATE TABLE artifacts (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  filename text NOT NULL,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  artifact_kind text NOT NULL,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  status text NOT NULL DEFAULT 'PENDING',
  upload_id text,
  captured_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_kind text,
  preview_object_key text,
  preview_text text,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifacts_status_check CHECK (
    status IN ('PENDING', 'STORED', 'QUARANTINED', 'DELETED')
  ),
  CONSTRAINT artifacts_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  ),
  CONSTRAINT artifacts_preview_check CHECK (
    preview_kind IS NULL OR preview_kind IN ('IMAGE_THUMBNAIL', 'TEXT_EXCERPT', 'NONE')
  )
);

CREATE UNIQUE INDEX artifacts_object_key_key ON artifacts (object_key);
CREATE INDEX artifacts_case_idx ON artifacts (case_id);
CREATE INDEX artifacts_finding_idx ON artifacts (finding_id);
CREATE INDEX artifacts_sha256_idx ON artifacts (sha256);

CREATE TABLE evidence (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  title text NOT NULL,
  description_markdown text,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  captured_at timestamptz,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(ref, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description_markdown, '')), 'C')
  ) STORED,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  )
);

CREATE UNIQUE INDEX evidence_ref_key ON evidence (ref);
CREATE INDEX evidence_case_idx ON evidence (case_id);
CREATE INDEX evidence_finding_idx ON evidence (finding_id);
CREATE INDEX evidence_search_idx ON evidence USING GIN (search_vector);

CREATE TABLE evidence_artifacts (
  evidence_id uuid NOT NULL REFERENCES evidence (id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evidence_id, artifact_id)
);

CREATE TABLE pocs (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  finding_id uuid NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions_markdown text NOT NULL,
  preconditions_markdown text,
  expected_result_markdown text,
  status text NOT NULL DEFAULT 'DRAFT',
  tested_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  tested_version text,
  last_verified_at timestamptz,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pocs_status_check CHECK (
    status IN ('DRAFT', 'VERIFIED', 'FAILED', 'RETIRED')
  ),
  CONSTRAINT pocs_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  )
);

CREATE UNIQUE INDEX pocs_ref_key ON pocs (ref);
CREATE INDEX pocs_finding_idx ON pocs (finding_id);

CREATE TABLE poc_artifacts (
  poc_id uuid NOT NULL REFERENCES pocs (id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poc_id, artifact_id)
);

CREATE TABLE poc_runs (
  id uuid PRIMARY KEY,
  poc_id uuid NOT NULL REFERENCES pocs (id) ON DELETE CASCADE,
  outcome text NOT NULL,
  notes_markdown text,
  environment text,
  tested_version text,
  ran_at timestamptz NOT NULL,
  ran_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poc_runs_outcome_check CHECK (
    outcome IN ('SUCCESS', 'FAILURE', 'PARTIAL')
  )
);

CREATE INDEX poc_runs_poc_idx ON poc_runs (poc_id, ran_at DESC);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE TABLE report_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  audience text NOT NULL,
  default_tlp text NOT NULL,
  visibility_ceiling text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  version text NOT NULL,
  built_in boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_templates_audience_check CHECK (
    audience IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  )
);

CREATE INDEX report_templates_audience_idx ON report_templates (audience);

CREATE TABLE reports (
  id uuid PRIMARY KEY,
  ref text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  audience text NOT NULL,
  template_id text NOT NULL REFERENCES report_templates (id),
  title text NOT NULL,
  tlp text NOT NULL,
  visibility_ceiling text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_audience_check CHECK (
    audience IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  ),
  CONSTRAINT reports_status_check CHECK (
    status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED')
  ),
  CONSTRAINT reports_tlp_check CHECK (
    tlp IN ('TLP:RED', 'TLP:AMBER+STRICT', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR')
  )
);

CREATE UNIQUE INDEX reports_ref_key ON reports (ref);
CREATE UNIQUE INDEX reports_case_audience_key ON reports (case_id, audience);

CREATE TABLE report_sections (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  position integer NOT NULL,
  required boolean NOT NULL DEFAULT false,
  content_markdown text NOT NULL DEFAULT '',
  review_state text NOT NULL DEFAULT 'NOT_WRITTEN',
  prompt_purpose text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  approved_revision integer,
  last_edited_by uuid REFERENCES users (id),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_markdown, '')), 'C')
  ) STORED,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_sections_review_check CHECK (
    review_state IN ('NOT_WRITTEN', 'AI_DRAFT', 'RESEARCHER_EDITED', 'NEEDS_REVIEW', 'APPROVED', 'LOCKED')
  )
);

CREATE UNIQUE INDEX report_sections_key ON report_sections (report_id, key);
CREATE INDEX report_sections_report_idx ON report_sections (report_id, position);
CREATE INDEX report_sections_search_idx ON report_sections USING GIN (search_vector);

CREATE TABLE report_revisions (
  id uuid PRIMARY KEY,
  section_id uuid NOT NULL REFERENCES report_sections (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  content_markdown text NOT NULL,
  review_state text NOT NULL,
  authored_by uuid NOT NULL REFERENCES users (id),
  ai_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX report_revisions_unique ON report_revisions (section_id, revision);

CREATE TABLE report_approvals (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  approved_by uuid NOT NULL REFERENCES users (id),
  approved_revision integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_approvals_report_idx ON report_approvals (report_id);

CREATE TABLE report_exports (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  artifact_id uuid REFERENCES artifacts (id) ON DELETE SET NULL,
  sha256 text,
  tlp text NOT NULL,
  template_version text NOT NULL,
  lint_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  requested_by uuid NOT NULL REFERENCES users (id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_exports_format_check CHECK (format IN ('PDF', 'MARKDOWN')),
  CONSTRAINT report_exports_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')
  )
);

CREATE INDEX report_exports_report_idx ON report_exports (report_id);

-- ---------------------------------------------------------------------------
-- Disclosure
-- ---------------------------------------------------------------------------

CREATE TABLE stakeholders (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  name text NOT NULL,
  organisation text,
  role text NOT NULL,
  email text,
  secure_channel text,
  notes text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stakeholders_role_check CHECK (
    role IN ('VENDOR_SECURITY', 'VENDOR_ENGINEERING', 'CNA', 'CERT', 'PROGRAM', 'OTHER')
  )
);

CREATE INDEX stakeholders_case_idx ON stakeholders (case_id);

CREATE TABLE disclosure_events (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  type text NOT NULL,
  label text,
  occurred_at timestamptz NOT NULL,
  detail_markdown text,
  stakeholder_id uuid REFERENCES stakeholders (id) ON DELETE SET NULL,
  artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disclosure_events_type_check CHECK (
    type IN (
      'DISCOVERED', 'REPRODUCED', 'PEER_REVIEWED', 'VENDOR_CONTACTED',
      'VENDOR_ACKNOWLEDGED', 'DETAILS_SENT', 'POC_SENT', 'PATCH_RECEIVED',
      'PATCH_VERIFIED', 'CVE_REQUESTED', 'CVE_RESERVED',
      'PUBLICATION_SCHEDULED', 'PUBLISHED', 'CUSTOM'
    )
  ),
  CONSTRAINT disclosure_events_visibility_check CHECK (
    visibility IN ('INTERNAL', 'VENDOR', 'PUBLIC')
  ),
  CONSTRAINT disclosure_events_custom_label CHECK (
    type <> 'CUSTOM' OR label IS NOT NULL
  )
);

CREATE INDEX disclosure_events_case_idx ON disclosure_events (case_id, occurred_at);
CREATE INDEX disclosure_events_finding_idx ON disclosure_events (finding_id);

CREATE TABLE embargoes (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  starts_at timestamptz,
  ends_at timestamptz,
  planned_disclosure_at timestamptz,
  expected_response_at timestamptz,
  agreement_note text,
  updated_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embargoes_window_check CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at
  )
);

CREATE UNIQUE INDEX embargoes_case_key ON embargoes (case_id);

-- ---------------------------------------------------------------------------
-- AI
-- ---------------------------------------------------------------------------

CREATE TABLE ai_runs (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  provider_version text,
  status text NOT NULL DEFAULT 'PREPARED',
  context_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_sha256 text NOT NULL,
  prompt_text text,
  raw_output text,
  failure_reason text,
  duration_ms integer,
  started_by uuid NOT NULL REFERENCES users (id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_runs_target_type_check CHECK (
    target_type IN ('FINDING', 'SCORE', 'CLAIM', 'REPORT_SECTION')
  ),
  CONSTRAINT ai_runs_status_check CHECK (
    status IN ('PREPARED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
  )
);

CREATE INDEX ai_runs_case_idx ON ai_runs (case_id, created_at DESC);
CREATE INDEX ai_runs_target_idx ON ai_runs (target_type, target_id);

CREATE TABLE ai_proposals (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  patch jsonb NOT NULL,
  rationale_markdown text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  base_revision integer NOT NULL,
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_proposals_status_check CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REJECTED')
  ),
  CONSTRAINT ai_proposals_target_type_check CHECK (
    target_type IN ('FINDING', 'SCORE', 'CLAIM', 'REPORT_SECTION')
  )
);

CREATE INDEX ai_proposals_target_idx ON ai_proposals (target_type, target_id, status);
CREATE INDEX ai_proposals_run_idx ON ai_proposals (run_id);

CREATE TABLE ai_provider_policies (
  provider_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  allowed_visibility jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_restricted_cases boolean NOT NULL DEFAULT false,
  retain_full_prompts boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  case_id uuid,
  actor_id uuid REFERENCES users (id),
  session_id uuid,
  request_id text,
  ai_run_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_case_idx ON audit_events (case_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, created_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, created_at DESC);

-- Audit history is append-only through the application. The rules below reject
-- UPDATE and DELETE for every role, including the owner, so a bug or a
-- compromised API cannot rewrite what happened.
CREATE RULE audit_events_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
