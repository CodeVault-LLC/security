CREATE TABLE correspondence_message_revisions (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES correspondence_messages (id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  body_text text NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX correspondence_message_revisions_key
  ON correspondence_message_revisions (message_id, revision);
