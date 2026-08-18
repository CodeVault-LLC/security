ALTER TABLE submissions
  ADD COLUMN reply_to_message_id uuid REFERENCES correspondence_messages (id) ON DELETE SET NULL;

CREATE INDEX submissions_reply_to_message_idx ON submissions (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
