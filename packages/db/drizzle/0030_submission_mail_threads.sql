CREATE TABLE submission_mail_threads (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connections (id) ON DELETE CASCADE,
  provider_thread_id text NOT NULL,
  linked_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX submission_mail_threads_submission_key
  ON submission_mail_threads (submission_id);

CREATE UNIQUE INDEX submission_mail_threads_provider_key
  ON submission_mail_threads (mailbox_connection_id, provider_thread_id);

CREATE INDEX submission_mail_threads_connection_idx
  ON submission_mail_threads (mailbox_connection_id, created_at);
