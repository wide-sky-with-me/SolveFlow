-- Private model configurations are authenticated ciphertext; public metadata is separate.
CREATE TABLE exam_app.model_service_versions (
  code text NOT NULL CHECK(code IN ('primary','backup')),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  enabled boolean NOT NULL,
  ciphertext text CHECK(ciphertext IS NULL OR length(ciphertext) BETWEEN 32 AND 65536),
  created_by uuid REFERENCES exam_app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,version), CHECK(NOT enabled OR ciphertext IS NOT NULL)
);
CREATE TRIGGER model_service_versions_immutable BEFORE UPDATE OR DELETE ON exam_app.model_service_versions
  FOR EACH ROW EXECUTE FUNCTION exam_app.reject_overwrite();
CREATE TABLE exam_app.model_services (
  code text PRIMARY KEY CHECK(code IN ('primary','backup')),
  current_version integer NOT NULL,
  FOREIGN KEY(code,current_version) REFERENCES exam_app.model_service_versions(code,version)
);
CREATE TABLE exam_app.user_model_services (
  user_id uuid PRIMARY KEY REFERENCES exam_app.users(id),
  code text NOT NULL REFERENCES exam_app.model_services(code),
  version integer NOT NULL CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE exam_app.answer_runs ADD COLUMN model_service_code text;
ALTER TABLE exam_app.answer_runs ADD COLUMN model_service_version integer;
ALTER TABLE exam_app.answer_runs ADD CONSTRAINT run_model_service_pair
  CHECK((model_service_code IS NULL)=(model_service_version IS NULL));
ALTER TABLE exam_app.answer_runs ADD CONSTRAINT run_model_service_version
  FOREIGN KEY(model_service_code,model_service_version) REFERENCES exam_app.model_service_versions(code,version);
