-- Non-canonical finding intake. Sources may draft rows here, but only a human
-- review transition may create or associate a canonical finding.

CREATE TABLE ai_intake_batches (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  source text NOT NULL,
  source_label text NOT NULL,
  run_id uuid REFERENCES ai_runs (id) ON DELETE SET NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_intake_batches_source_check CHECK (
    source IN ('MANUAL', 'FOLDER_SCAN', 'EXTERNAL_AGENT')
  )
);

CREATE INDEX ai_intake_batches_case_idx
  ON ai_intake_batches (case_id, created_at);
CREATE INDEX ai_intake_batches_run_idx ON ai_intake_batches (run_id);

CREATE TABLE ai_intake_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES ai_intake_batches (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  draft jsonb NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text,
  created_finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  merged_into_finding_id uuid REFERENCES findings (id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  rejection_reason text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_intake_items_status_check CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'MERGED')
  ),
  CONSTRAINT ai_intake_items_confidence_check CHECK (
    confidence IS NULL OR confidence IN ('LOW', 'MEDIUM', 'HIGH')
  ),
  CONSTRAINT ai_intake_items_terminal_shape_check CHECK (
    (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND created_finding_id IS NULL AND merged_into_finding_id IS NULL
      AND rejection_reason IS NULL)
    OR (status = 'ACCEPTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND created_finding_id IS NOT NULL AND merged_into_finding_id IS NULL
      AND rejection_reason IS NULL)
    OR (status = 'MERGED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND created_finding_id IS NULL AND merged_into_finding_id IS NOT NULL
      AND rejection_reason IS NULL)
    OR (status = 'REJECTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND created_finding_id IS NULL AND merged_into_finding_id IS NULL
      AND rejection_reason IS NOT NULL)
  )
);

CREATE INDEX ai_intake_items_batch_idx
  ON ai_intake_items (batch_id, created_at);
CREATE INDEX ai_intake_items_status_idx ON ai_intake_items (status);
CREATE INDEX ai_intake_items_created_finding_idx
  ON ai_intake_items (created_finding_id);
CREATE INDEX ai_intake_items_merged_finding_idx
  ON ai_intake_items (merged_into_finding_id);
