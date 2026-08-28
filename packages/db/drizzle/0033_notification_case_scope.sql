ALTER TABLE security_notifications
  ADD COLUMN case_id uuid REFERENCES cases (id) ON DELETE CASCADE;

UPDATE security_notifications AS notification
SET case_id = case_record.id
FROM cases AS case_record
WHERE notification.details->>'caseId' = case_record.id::text;

CREATE INDEX security_notifications_user_case_idx
  ON security_notifications (user_id, case_id);
