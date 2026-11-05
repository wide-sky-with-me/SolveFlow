-- Read receipts belong to a resolved incident, never to its slot's next failure.
ALTER TABLE exam_app.verification_incidents ADD COLUMN resolution_read_at timestamptz;
ALTER TABLE exam_app.verification_incidents ADD CONSTRAINT resolution_read_after_resolved
  CHECK(resolution_read_at IS NULL OR resolved_at IS NOT NULL);
CREATE INDEX incident_unread_resolution ON exam_app.verification_incidents(attempt_id,resolved_at DESC,id)
  WHERE resolved_at IS NOT NULL AND resolution_read_at IS NULL;
CREATE INDEX incident_open_queue ON exam_app.verification_incidents(opened_at,id)
  WHERE resolved_at IS NULL;
