CREATE TABLE correspondence_message_attachments (
  message_id uuid NOT NULL REFERENCES correspondence_messages (id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX correspondence_message_attachments_artifact_key
  ON correspondence_message_attachments (message_id, artifact_id);
CREATE UNIQUE INDEX correspondence_message_attachments_position_key
  ON correspondence_message_attachments (message_id, position);
