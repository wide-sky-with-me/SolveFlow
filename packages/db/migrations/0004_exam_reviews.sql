-- Durable, scoped verification incidents. Retrying or replacing images never dismisses one.
ALTER TABLE exam_app.question_slots ADD COLUMN deferred_at timestamptz;
ALTER TABLE exam_app.answer_runs ADD COLUMN initiated_by uuid REFERENCES exam_app.users(id);
ALTER TABLE exam_app.answer_runs ADD COLUMN review_deadline timestamptz;
ALTER TABLE exam_app.answer_runs ADD CONSTRAINT teacher_review_deadline CHECK ((initiated_by IS NULL)=(review_deadline IS NULL));
CREATE TABLE exam_app.verification_incidents (
  id uuid PRIMARY KEY, slot_id uuid NOT NULL, attempt_id uuid NOT NULL, student_id uuid NOT NULL,
  revision_id uuid NOT NULL, source_run_id uuid NOT NULL,
  reason text NOT NULL CHECK(reason IN ('verification_failed','verification_unknown','verification_unavailable','answer_failed','image_incomplete','interrupted','response_mismatch')),
  opened_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, resolution text CHECK(resolution IN ('ai_pass','human_confirmed')), resolved_by uuid REFERENCES exam_app.users(id),
  FOREIGN KEY(slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  FOREIGN KEY(revision_id,slot_id,student_id) REFERENCES exam_app.question_revisions(id,slot_id,student_id),
  FOREIGN KEY(source_run_id,slot_id,student_id) REFERENCES exam_app.answer_runs(id,slot_id,student_id),
  CHECK ((resolved_at IS NULL)=(resolution IS NULL)),
  CHECK (resolution IS DISTINCT FROM 'human_confirmed' OR resolved_by IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_verification_incident ON exam_app.verification_incidents(slot_id) WHERE resolved_at IS NULL;
CREATE INDEX incident_attempt_open ON exam_app.verification_incidents(attempt_id,opened_at) WHERE resolved_at IS NULL;
CREATE TABLE exam_app.teacher_reviews (
  id uuid PRIMARY KEY, slot_id uuid NOT NULL, student_id uuid NOT NULL, revision_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES exam_app.users(id), source_run_id uuid,
  answer_text text NOT NULL CHECK(length(answer_text)>0), selected_options jsonb,
  note text NOT NULL CHECK(length(note)>0), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(revision_id,slot_id,student_id) REFERENCES exam_app.question_revisions(id,slot_id,student_id),
  FOREIGN KEY(source_run_id,slot_id,student_id) REFERENCES exam_app.answer_runs(id,slot_id,student_id),
  CHECK(selected_options IS NULL OR jsonb_typeof(selected_options)='array'),
  UNIQUE(id,slot_id,student_id)
);
CREATE TRIGGER teacher_reviews_immutable BEFORE UPDATE ON exam_app.teacher_reviews
  FOR EACH ROW EXECUTE FUNCTION exam_app.reject_overwrite();
CREATE INDEX teacher_reviews_slot_time ON exam_app.teacher_reviews(slot_id,created_at DESC);
CREATE INDEX run_results_slot_time ON exam_app.run_results(slot_id,created_at DESC);
ALTER TABLE exam_app.question_slots ADD COLUMN published_review_id uuid;
ALTER TABLE exam_app.question_slots ADD CONSTRAINT slot_review_scope FOREIGN KEY(published_review_id,id,student_id) REFERENCES exam_app.teacher_reviews(id,slot_id,student_id);
-- Backfill existing failed/unverified results without changing original outcomes.
INSERT INTO exam_app.verification_incidents(id,slot_id,attempt_id,student_id,revision_id,source_run_id,reason)
SELECT gen_random_uuid(),q.id,q.attempt_id,q.student_id,q.current_revision_id,r.id,
CASE WHEN r.status='needs_clarification' THEN 'image_incomplete' WHEN r.status='interrupted' THEN 'interrupted'
WHEN r.status='failed' THEN 'answer_failed' WHEN o.outcome#>>'{verification,verdict}'='fail' THEN 'verification_failed'
WHEN o.outcome#>>'{verification,verdict}'='unknown' THEN 'verification_unknown' ELSE 'verification_unavailable' END
FROM exam_app.question_slots q JOIN exam_app.answer_runs r ON r.id=q.current_run_id LEFT JOIN exam_app.run_results o ON o.run_id=r.id
WHERE r.status IN ('failed','needs_clarification','interrupted') OR (r.status='completed' AND NOT coalesce(o.verified,false));
