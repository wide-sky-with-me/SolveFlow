-- Preserve existing concrete exams as one parent event each. Old API versions can
-- continue inserting sittings during a rolling upgrade: the trigger supplies the parent.
CREATE TABLE exam_app.exam_events (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES exam_app.exam_templates(id),
  manager_id uuid NOT NULL REFERENCES exam_app.users(id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
ALTER TABLE exam_app.exam_sittings ADD COLUMN event_id uuid REFERENCES exam_app.exam_events(id);
ALTER TABLE exam_app.exam_sittings ADD COLUMN archived_at timestamptz;
INSERT INTO exam_app.exam_events(id,template_id,manager_id,title,created_at)
SELECT id,template_id,manager_id,title,created_at FROM exam_app.exam_sittings;
UPDATE exam_app.exam_sittings SET event_id=id;
ALTER TABLE exam_app.exam_sittings ALTER COLUMN event_id SET NOT NULL;
CREATE INDEX exam_sittings_event ON exam_app.exam_sittings(event_id,created_at);
CREATE INDEX exam_events_manager ON exam_app.exam_events(manager_id,created_at) WHERE archived_at IS NULL;
CREATE FUNCTION exam_app.ensure_sitting_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id IS NULL THEN
    INSERT INTO exam_app.exam_events(id,template_id,manager_id,title,created_at)
    VALUES(NEW.id,NEW.template_id,NEW.manager_id,NEW.title,NEW.created_at);
    NEW.event_id=NEW.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM exam_app.exam_events e WHERE e.id=NEW.event_id AND e.template_id=NEW.template_id AND e.manager_id=NEW.manager_id AND e.archived_at IS NULL) THEN
    RAISE EXCEPTION 'EXAM_EVENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ensure_sitting_event BEFORE INSERT OR UPDATE OF event_id,template_id ON exam_app.exam_sittings FOR EACH ROW EXECUTE FUNCTION exam_app.ensure_sitting_event();
