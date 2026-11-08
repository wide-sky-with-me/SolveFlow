-- Provisional solver answer shown while verification runs.
-- Purely additive: run_results stays immutable and the draft row is removed when the
-- run finishes (or replaces nothing when it fails).
CREATE TABLE exam_app.answer_drafts (
  slot_id uuid NOT NULL,
  student_id uuid NOT NULL,
  run_id uuid NOT NULL,
  answer_text text NOT NULL CHECK(length(answer_text) BETWEEN 1 AND 4000),
  selected_options jsonb CHECK(selected_options IS NULL OR jsonb_typeof(selected_options) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(slot_id, student_id),
  FOREIGN KEY(slot_id, student_id) REFERENCES exam_app.question_slots(id, student_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id, slot_id, student_id) REFERENCES exam_app.answer_runs(id, slot_id, student_id) ON DELETE CASCADE
);

-- Persisted "answer revised" notice. Only when the published answer differs from
-- the provisional draft the student already saw (verification/revision or the
-- delivery policy rewrote it). One notice per run, hidden after a retake.
CREATE TABLE exam_app.answer_revisions (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  student_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE(run_id),
  FOREIGN KEY(slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  FOREIGN KEY(revision_id,slot_id,student_id) REFERENCES exam_app.question_revisions(id,slot_id,student_id),
  FOREIGN KEY(run_id,slot_id,student_id) REFERENCES exam_app.answer_runs(id,slot_id,student_id)
);
CREATE INDEX answer_revision_notices_unread ON exam_app.answer_revisions(attempt_id,created_at) WHERE read_at IS NULL;
