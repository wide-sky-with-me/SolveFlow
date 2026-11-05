-- Stable slots remain unchanged when students jump or leave a module unfinished.
ALTER TABLE exam_app.question_slots ADD COLUMN skipped_at timestamptz;
ALTER TABLE exam_app.exam_attempts ADD COLUMN navigation_version bigint NOT NULL DEFAULT 0 CHECK(navigation_version>=0);
ALTER TABLE exam_app.exam_attempts ADD COLUMN viewed_slot_id uuid;
ALTER TABLE exam_app.exam_attempts ADD CONSTRAINT viewed_slot_same_attempt
  FOREIGN KEY(viewed_slot_id,id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id);
UPDATE exam_app.exam_attempts SET viewed_slot_id=next_slot_id;
CREATE TABLE exam_app.student_navigation (
  id uuid PRIMARY KEY, attempt_id uuid NOT NULL, student_id uuid NOT NULL,
  request_id uuid NOT NULL, module_id uuid NOT NULL, slot_id uuid, target_slot_id uuid,
  action text NOT NULL CHECK(action IN ('select_slot','select_module','skip_slot','skip_module')),
  affected_count integer NOT NULL CHECK(affected_count BETWEEN 0 AND 4800),
  navigation_version bigint NOT NULL CHECK(navigation_version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(attempt_id,student_id) REFERENCES exam_app.exam_attempts(id,student_id),
  FOREIGN KEY(module_id,attempt_id,student_id) REFERENCES exam_app.attempt_modules(id,attempt_id,student_id),
  FOREIGN KEY(slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  FOREIGN KEY(target_slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  UNIQUE(student_id,request_id), UNIQUE(attempt_id,navigation_version)
);
CREATE INDEX student_navigation_attempt_time ON exam_app.student_navigation(attempt_id,navigation_version DESC);
CREATE TRIGGER student_navigation_immutable BEFORE UPDATE ON exam_app.student_navigation
  FOR EACH ROW EXECUTE FUNCTION exam_app.reject_overwrite();
-- The previous module gate is retired. Never label skipped/deferred work as answered.
UPDATE exam_app.attempt_modules m SET state=CASE
 WHEN NOT EXISTS(SELECT 1 FROM exam_app.question_slots q WHERE q.module_id=m.id AND q.completed_once_at IS NULL) THEN 'completed'
 WHEN EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.question_slots q ON q.id=x.next_slot_id WHERE x.id=m.attempt_id AND q.module_id=m.id) THEN 'in_progress'
 ELSE 'available' END,
 completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM exam_app.question_slots q WHERE q.module_id=m.id AND q.completed_once_at IS NULL) THEN coalesce(m.completed_at,now()) ELSE NULL END;
