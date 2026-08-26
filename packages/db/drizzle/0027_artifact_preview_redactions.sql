CREATE TABLE artifact_preview_redactions (
  artifact_id uuid PRIMARY KEY REFERENCES artifacts (id) ON DELETE CASCADE,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid NOT NULL REFERENCES users (id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
