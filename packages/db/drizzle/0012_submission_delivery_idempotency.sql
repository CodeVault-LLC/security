CREATE UNIQUE INDEX submission_deliveries_active_key
  ON submission_deliveries (submission_id)
  WHERE status IN ('QUEUED', 'SENDING', 'DELIVERY_UNKNOWN');
