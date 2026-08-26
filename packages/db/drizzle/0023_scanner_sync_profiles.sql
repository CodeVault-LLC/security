-- Reusable, case-scoped synchronization policy for scanner finding exchanges.
-- Profiles record when a source is due without granting the server access to a
-- local scanner output directory or silently accepting imported findings.

CREATE TABLE scanner_sync_profiles (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL,
  source_label text NOT NULL,
  deduplication_policy text NOT NULL,
  cadence_hours integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanner_sync_profiles_format_check CHECK (
    format IN ('JSON', 'CSV', 'SARIF')
  ),
  CONSTRAINT scanner_sync_profiles_deduplication_check CHECK (
    deduplication_policy IN ('STAGE_ALL', 'SKIP_MATCHING_TITLES')
  ),
  CONSTRAINT scanner_sync_profiles_cadence_check CHECK (
    cadence_hours BETWEEN 1 AND 8760
  ),
  CONSTRAINT scanner_sync_profiles_run_order_check CHECK (
    last_run_at IS NULL OR next_run_at > last_run_at
  )
);

CREATE UNIQUE INDEX scanner_sync_profiles_case_name_key
  ON scanner_sync_profiles (case_id, name);
CREATE INDEX scanner_sync_profiles_due_idx
  ON scanner_sync_profiles (enabled, next_run_at);
CREATE INDEX scanner_sync_profiles_case_idx
  ON scanner_sync_profiles (case_id, created_at);
