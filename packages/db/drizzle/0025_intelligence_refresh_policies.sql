-- User-controlled recurring refresh policy for retrieved EPSS and KEV facts.

CREATE TABLE intelligence_refresh_policies (
  finding_id uuid PRIMARY KEY REFERENCES findings (id) ON DELETE CASCADE,
  cadence text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_queued_at timestamptz,
  next_run_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_refresh_policies_cadence_check CHECK (
    cadence IN ('DAILY', 'WEEKLY')
  ),
  CONSTRAINT intelligence_refresh_policies_enabled_shape_check CHECK (
    (enabled AND next_run_at IS NOT NULL) OR
    (NOT enabled AND next_run_at IS NULL)
  )
);

CREATE INDEX intelligence_refresh_policies_due_idx
  ON intelligence_refresh_policies (enabled, next_run_at);
