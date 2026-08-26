CREATE TABLE remediation_slas (
  finding_id uuid PRIMARY KEY REFERENCES findings (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  target_at timestamptz NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX remediation_slas_target_idx ON remediation_slas (target_at);
