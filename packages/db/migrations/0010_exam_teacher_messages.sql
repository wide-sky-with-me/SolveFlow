-- Messages are independent of answer publication and do not resolve verification incidents.
CREATE TABLE exam_app.teacher_messages (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  student_id uuid NOT NULL,
  sender_id uuid NOT NULL REFERENCES exam_app.users(id),
  request_id uuid NOT NULL,
  material_revision integer NOT NULL CHECK(material_revision>=0),
  message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY(slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  UNIQUE(sender_id,request_id)
);
CREATE INDEX teacher_messages_unread ON exam_app.teacher_messages(student_id,created_at) WHERE read_at IS NULL;
CREATE INDEX teacher_messages_attempt ON exam_app.teacher_messages(attempt_id,created_at);
