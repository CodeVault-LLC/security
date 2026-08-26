CREATE TABLE evidence_custody_events (
  id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES evidence (id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES artifacts (id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('COLLECTED', 'TRANSFERRED', 'VERIFIED', 'SEALED', 'RELEASED')
  ),
  custodian text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL,
  previous_event_hash text,
  event_hash text NOT NULL UNIQUE,
  attested_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_custody_events_evidence_idx
  ON evidence_custody_events (evidence_id, occurred_at);
