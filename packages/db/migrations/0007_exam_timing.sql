-- Backfills may queue deferred slot foreign keys; flush them before changing this table.
-- This setting belongs only to the migration transaction and does not change the schema default.
SET CONSTRAINTS ALL IMMEDIATE;

-- Unlimited schedules keep a real start but have no closing deadline.
ALTER TABLE exam_app.exam_sittings ALTER COLUMN closes_at DROP NOT NULL;
ALTER TABLE exam_app.exam_assignments ALTER COLUMN closes_at DROP NOT NULL;

-- finished_at describes answer completion; ended_at seals the student's sitting.
ALTER TABLE exam_app.exam_attempts ADD COLUMN ended_at timestamptz;
ALTER TABLE exam_app.exam_attempts ADD COLUMN end_reason text CHECK(end_reason IN ('student','teacher','deadline','system'));
ALTER TABLE exam_app.exam_attempts ADD COLUMN ended_by uuid REFERENCES exam_app.users(id);
UPDATE exam_app.exam_attempts SET started_at=created_at WHERE started_at IS NULL AND state<>'ready';
UPDATE exam_app.exam_attempts SET ended_at=greatest(coalesce(finished_at,created_at),started_at),end_reason='system' WHERE state IN ('completed','closed','cancelled');
ALTER TABLE exam_app.exam_attempts ADD CONSTRAINT exam_attempt_end_consistent CHECK((ended_at IS NULL)=(end_reason IS NULL));
DROP INDEX exam_app.one_in_progress_attempt_per_student;
CREATE UNIQUE INDEX one_unfinished_attempt_per_student ON exam_app.exam_attempts(student_id) WHERE state IN ('in_progress','completed') AND ended_at IS NULL;
ALTER TABLE exam_app.exam_attempts ADD CONSTRAINT exam_attempt_time_order CHECK(ended_at IS NULL OR started_at IS NULL OR ended_at>=started_at);
