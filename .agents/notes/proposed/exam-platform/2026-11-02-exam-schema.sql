-- DESIGN ONLY: not a deployed migration; validate on isolated PostgreSQL before implementation.
-- Companion: 2026-11-02-exam-data-model.md. Application JSON must pass shared contracts.
-- UUIDs are allocated by the trusted server. No real credentials or seed students included.
BEGIN;
CREATE SCHEMA exam_app;

CREATE TABLE exam_app.users (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_-]{3,64}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash text, -- Argon2id encoding; NULL only for assignment-key-only students.
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','disabled','archived')),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_ci ON exam_app.users(lower(username));
CREATE TABLE exam_app.roles (
  id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
  built_in boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE exam_app.permissions (code text PRIMARY KEY, name text NOT NULL);
CREATE TABLE exam_app.user_roles (
  user_id uuid NOT NULL REFERENCES exam_app.users(id), role_id uuid NOT NULL REFERENCES exam_app.roles(id),
  PRIMARY KEY(user_id,role_id)
);
CREATE TABLE exam_app.role_permissions (
  role_id uuid NOT NULL REFERENCES exam_app.roles(id), permission_code text NOT NULL REFERENCES exam_app.permissions(code),
  PRIMARY KEY(role_id,permission_code)
);
CREATE TABLE exam_app.auth_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES exam_app.users(id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
  auth_version integer NOT NULL CHECK(auth_version > 0),
  scope text NOT NULL CHECK(scope IN ('account','assignment')),
  assignment_id uuid, -- FK below; assignment sessions cannot become staff sessions.
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  CHECK(expires_at > created_at), CHECK((scope='assignment')=(assignment_id IS NOT NULL))
);
CREATE INDEX auth_sessions_user_active ON exam_app.auth_sessions(user_id,expires_at) WHERE revoked_at IS NULL;

-- Each row is one immutable template version, not a mutable live exam definition.
CREATE TABLE exam_app.exam_templates (
  id uuid PRIMARY KEY, code text NOT NULL, version integer NOT NULL CHECK(version > 0),
  exam_type text NOT NULL, title text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),
  config_sha256 text NOT NULL CHECK(config_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('draft','published','retired')),
  created_by uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code,version)
);
CREATE TABLE exam_app.template_modules (
  id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES exam_app.exam_templates(id),
  position integer NOT NULL CHECK(position BETWEEN 1 AND 16), code text NOT NULL,
  section_code text NOT NULL, title text NOT NULL,
  question_count integer NOT NULL CHECK(question_count BETWEEN 1 AND 300),
  duration_seconds integer CHECK(duration_seconds > 0),
  response_kinds jsonb NOT NULL CHECK(jsonb_typeof(response_kinds)='array'),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rules)='object'),
  UNIQUE(template_id,position), UNIQUE(template_id,code), UNIQUE(id,template_id)
);
CREATE TABLE exam_app.exam_sittings (
  id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES exam_app.exam_templates(id), title text NOT NULL,
  opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL,
  display_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  accepted_job_grace_seconds integer NOT NULL DEFAULT 300 CHECK(accepted_job_grace_seconds BETWEEN 0 AND 1800),
  state text NOT NULL CHECK(state IN ('draft','published','closed','cancelled')),
  manager_id uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), CHECK(closes_at > opens_at)
);
CREATE INDEX exam_sittings_window ON exam_app.exam_sittings(state,opens_at,closes_at);
CREATE TABLE exam_app.exam_assignments (
  id uuid PRIMARY KEY, sitting_id uuid NOT NULL REFERENCES exam_app.exam_sittings(id),
  student_id uuid NOT NULL REFERENCES exam_app.users(id),
  opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL, -- Effective per-student schedule.
  state text NOT NULL CHECK(state IN ('assigned','revoked','completed')),
  settings_snapshot jsonb NOT NULL CHECK(jsonb_typeof(settings_snapshot)='object'),
  created_by uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  CHECK(closes_at > opens_at), UNIQUE(sitting_id,student_id), UNIQUE(id,student_id)
);
CREATE INDEX exam_assignments_student_window ON exam_app.exam_assignments(student_id,state,opens_at,closes_at);
CREATE TABLE exam_app.staff_assignments (
  assignment_id uuid NOT NULL REFERENCES exam_app.exam_assignments(id),
  staff_id uuid NOT NULL REFERENCES exam_app.users(id),
  granted_by uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, PRIMARY KEY(assignment_id,staff_id)
);
CREATE INDEX staff_assignments_staff ON exam_app.staff_assignments(staff_id,assignment_id) WHERE revoked_at IS NULL;
CREATE TABLE exam_app.exam_access_keys (
  id uuid PRIMARY KEY, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  key_hash bytea NOT NULL UNIQUE CHECK(octet_length(key_hash)=32),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY(assignment_id,student_id) REFERENCES exam_app.exam_assignments(id,student_id),
  CHECK(expires_at > created_at)
);
ALTER TABLE exam_app.auth_sessions ADD CONSTRAINT auth_session_assignment_scope
  FOREIGN KEY(assignment_id,user_id) REFERENCES exam_app.exam_assignments(id,student_id);

CREATE TABLE exam_app.scoring_references (
  id uuid PRIMARY KEY, exam_type text NOT NULL, code text NOT NULL, version integer NOT NULL CHECK(version > 0),
  section_code text NOT NULL, applicability jsonb NOT NULL CHECK(jsonb_typeof(applicability)='object'),
  method text NOT NULL CHECK(method IN ('form_raw_table','adaptive_estimate','unsupported')),
  source_url text NOT NULL, source_object_key text,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),
  reviewed_by uuid REFERENCES exam_app.users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(code,version)
);
CREATE TABLE exam_app.delivery_policies (
  id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES exam_app.exam_assignments(id),
  version integer NOT NULL CHECK(version > 0),
  mode text NOT NULL CHECK(mode IN ('original','practice_simulation')),
  reference_id uuid REFERENCES exam_app.scoring_references(id),
  targets jsonb NOT NULL CHECK(jsonb_typeof(targets)='object'), -- Per-section ranges/counts; validated against template.
  constraints jsonb NOT NULL CHECK(jsonb_typeof(constraints)='object'),
  state text NOT NULL CHECK(state IN ('draft','approved','frozen','retired')),
  created_by uuid NOT NULL REFERENCES exam_app.users(id), approved_by uuid REFERENCES exam_app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assignment_id,version), UNIQUE(id,assignment_id)
);
CREATE TABLE exam_app.exam_attempts (
  id uuid PRIMARY KEY, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK(attempt_no > 0), template_id uuid NOT NULL REFERENCES exam_app.exam_templates(id),
  delivery_policy_id uuid NOT NULL,
  template_snapshot jsonb NOT NULL CHECK(jsonb_typeof(template_snapshot)='object'),
  state text NOT NULL CHECK(state IN ('ready','in_progress','completed','closed','cancelled')),
  started_at timestamptz, finished_at timestamptz,
  next_slot_id uuid, version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(assignment_id,student_id) REFERENCES exam_app.exam_assignments(id,student_id),
  FOREIGN KEY(delivery_policy_id,assignment_id) REFERENCES exam_app.delivery_policies(id,assignment_id),
  UNIQUE(assignment_id,attempt_no), UNIQUE(id,student_id)
);
CREATE UNIQUE INDEX one_in_progress_attempt_per_student ON exam_app.exam_attempts(student_id) WHERE state='in_progress';
CREATE TABLE exam_app.attempt_modules (
  id uuid PRIMARY KEY, attempt_id uuid NOT NULL, student_id uuid NOT NULL,
  template_module_id uuid NOT NULL REFERENCES exam_app.template_modules(id),
  position integer NOT NULL CHECK(position BETWEEN 1 AND 16), section_code text NOT NULL, title text NOT NULL,
  question_count integer NOT NULL CHECK(question_count BETWEEN 1 AND 300),
  rules_snapshot jsonb NOT NULL CHECK(jsonb_typeof(rules_snapshot)='object'),
  state text NOT NULL CHECK(state IN ('locked','available','in_progress','completed')),
  opened_at timestamptz, completed_at timestamptz,
  FOREIGN KEY(attempt_id,student_id) REFERENCES exam_app.exam_attempts(id,student_id),
  UNIQUE(attempt_id,position), UNIQUE(id,attempt_id,student_id)
);
CREATE TABLE exam_app.question_slots (
  id uuid PRIMARY KEY, module_id uuid NOT NULL, attempt_id uuid NOT NULL, student_id uuid NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 1 AND 300),
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 4800),
  current_revision_id uuid, current_run_id uuid, published_presentation_id uuid,
  completed_once_at timestamptz, version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(module_id,attempt_id,student_id) REFERENCES exam_app.attempt_modules(id,attempt_id,student_id),
  UNIQUE(module_id,position), UNIQUE(attempt_id,ordinal), UNIQUE(id,student_id), UNIQUE(id,attempt_id,student_id)
);
ALTER TABLE exam_app.exam_attempts ADD CONSTRAINT next_slot_same_attempt
  FOREIGN KEY(next_slot_id,id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE exam_app.media_assets (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES exam_app.users(id),
  object_key text NOT NULL UNIQUE, variant text NOT NULL CHECK(variant IN ('source','model','thumbnail')),
  parent_asset_id uuid, mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  width integer NOT NULL CHECK(width > 0), height integer NOT NULL CHECK(height > 0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('quarantined','ready','deleting','deleted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), retention_until timestamptz NOT NULL, deleted_at timestamptz,
  delete_attempts integer NOT NULL DEFAULT 0 CHECK(delete_attempts >= 0),
  UNIQUE(id,owner_user_id),
  FOREIGN KEY(parent_asset_id,owner_user_id) REFERENCES exam_app.media_assets(id,owner_user_id),
  CHECK(parent_asset_id IS NULL OR parent_asset_id<>id),
  CHECK(width::bigint * height <= 20000000),
  CHECK(variant<>'model' OR (width<=2048 AND height<=2048 AND byte_size<=4194304))
);
CREATE INDEX media_assets_gc ON exam_app.media_assets(state,retention_until);
CREATE INDEX media_assets_owner_hash ON exam_app.media_assets(owner_user_id,sha256,variant);
CREATE TABLE exam_app.upload_intents (
  id uuid PRIMARY KEY, student_id uuid NOT NULL, slot_id uuid NOT NULL,
  client_request_id uuid NOT NULL, expected_revision integer NOT NULL CHECK(expected_revision >= 0),
  object_key text NOT NULL UNIQUE, max_bytes integer NOT NULL CHECK(max_bytes BETWEEN 1 AND 10485760),
  state text NOT NULL CHECK(state IN ('created','uploaded','validated','consumed','expired','rejected')),
  asset_id uuid, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  FOREIGN KEY(slot_id,student_id) REFERENCES exam_app.question_slots(id,student_id),
  FOREIGN KEY(asset_id,student_id) REFERENCES exam_app.media_assets(id,owner_user_id),
  UNIQUE(student_id,client_request_id), CHECK(expires_at > created_at)
);
CREATE TABLE exam_app.question_revisions (
  id uuid PRIMARY KEY, slot_id uuid NOT NULL, student_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0), reason text NOT NULL CHECK(reason IN ('initial','retake','supplement')),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz NOT NULL,
  FOREIGN KEY(slot_id,student_id) REFERENCES exam_app.question_slots(id,student_id),
  UNIQUE(slot_id,revision), UNIQUE(id,slot_id,student_id), UNIQUE(id,student_id)
);
CREATE TABLE exam_app.revision_images (
  revision_id uuid NOT NULL, student_id uuid NOT NULL, asset_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('primary','material')), position integer NOT NULL,
  PRIMARY KEY(revision_id,role,position), UNIQUE(revision_id,asset_id),
  FOREIGN KEY(revision_id,student_id) REFERENCES exam_app.question_revisions(id,student_id),
  FOREIGN KEY(asset_id,student_id) REFERENCES exam_app.media_assets(id,owner_user_id),
  CHECK((role='primary' AND position=0) OR (role='material' AND position BETWEEN 1 AND 7))
);
CREATE UNIQUE INDEX one_primary_image ON exam_app.revision_images(revision_id) WHERE role='primary';
CREATE TABLE exam_app.answer_runs (
  id uuid PRIMARY KEY, slot_id uuid NOT NULL, revision_id uuid NOT NULL, student_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('solve','verify')), source_result_run_id uuid,
  status text NOT NULL CHECK(status IN ('queued','understanding','solving','verifying','revising','completed','needs_clarification','failed','cancelled','interrupted')),
  request_schema_version integer NOT NULL DEFAULT 1 CHECK(request_schema_version=1),
  input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object'), -- IDs/hashes, never credentials or image bytes.
  model_policy_version text NOT NULL,
  lease_owner uuid, lease_token uuid, lease_expires_at timestamptz,
  dispatch_started_at timestamptz, cancel_requested_at timestamptz,
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  FOREIGN KEY(revision_id,slot_id,student_id) REFERENCES exam_app.question_revisions(id,slot_id,student_id),
  UNIQUE(student_id,client_request_id), UNIQUE(id,slot_id,student_id), UNIQUE(id,student_id),
  CHECK((purpose='verify')=(source_result_run_id IS NOT NULL)),
  CHECK((status IN ('completed','needs_clarification','failed','cancelled','interrupted'))=(finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_run_per_slot ON exam_app.answer_runs(slot_id)
  WHERE status IN ('queued','understanding','solving','verifying','revising');
CREATE INDEX answer_runs_claim ON exam_app.answer_runs(status,created_at) WHERE status='queued';
CREATE INDEX answer_runs_lease ON exam_app.answer_runs(lease_expires_at)
  WHERE status IN ('understanding','solving','verifying','revising');
CREATE TABLE exam_app.run_results (
  run_id uuid PRIMARY KEY, slot_id uuid NOT NULL, student_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object' AND outcome ? 'schemaVersion'),
  transcription jsonb CHECK(transcription IS NULL OR jsonb_typeof(transcription)='object'),
  recognized_text text GENERATED ALWAYS AS (coalesce(outcome#>>'{candidate,problem,text}','')) STORED,
  answer_text text GENERATED ALWAYS AS (coalesce(outcome#>>'{candidate,answer}','')) STORED,
  selected_options jsonb GENERATED ALWAYS AS (outcome#>'{candidate,selectedOptions}') STORED,
  verified boolean GENERATED ALWAYS AS (coalesce((outcome->>'verified')::boolean,false)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,slot_id,student_id) REFERENCES exam_app.answer_runs(id,slot_id,student_id),
  UNIQUE(run_id,slot_id,student_id)
);
CREATE INDEX result_knowledge ON exam_app.run_results USING gin ((outcome#>'{candidate,knowledgePoints}') jsonb_path_ops);
ALTER TABLE exam_app.answer_runs ADD CONSTRAINT verification_source_same_slot
  FOREIGN KEY(source_result_run_id,slot_id,student_id) REFERENCES exam_app.run_results(run_id,slot_id,student_id);
CREATE TABLE exam_app.plan_generation_jobs (
  id uuid PRIMARY KEY, policy_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  request_id uuid NOT NULL, input_snapshot jsonb NOT NULL CHECK(jsonb_typeof(input_snapshot)='object'),
  status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','interrupted')),
  proposal jsonb CHECK(proposal IS NULL OR jsonb_typeof(proposal)='object'),
  lease_token uuid, lease_expires_at timestamptz, cancel_requested_at timestamptz, error_code text,
  created_by uuid NOT NULL REFERENCES exam_app.users(id), created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  FOREIGN KEY(policy_id,assignment_id) REFERENCES exam_app.delivery_policies(id,assignment_id),
  FOREIGN KEY(assignment_id,student_id) REFERENCES exam_app.exam_assignments(id,student_id),
  UNIQUE(student_id,request_id), UNIQUE(id,student_id), UNIQUE(id,policy_id,student_id),
  CHECK((status IN ('completed','failed','cancelled','interrupted'))=(finished_at IS NOT NULL))
);
CREATE TABLE exam_app.model_call_attempts (
  id uuid PRIMARY KEY, run_id uuid, planning_job_id uuid, student_id uuid NOT NULL,
  FOREIGN KEY(run_id,student_id) REFERENCES exam_app.answer_runs(id,student_id),
  FOREIGN KEY(planning_job_id,student_id) REFERENCES exam_app.plan_generation_jobs(id,student_id),
  CHECK(num_nonnulls(run_id,planning_job_id)=1),
  phase text NOT NULL CHECK(phase IN ('transcription','solver','verifier','backup','format_repair','planning')),
  attempt_no integer NOT NULL CHECK(attempt_no > 0),
  provider_code text NOT NULL, model_name text NOT NULL,
  status text NOT NULL CHECK(status IN ('reserved','started','completed','failed','cancelled','unknown')),
  started_at timestamptz, finished_at timestamptz,
  input_tokens bigint CHECK(input_tokens >= 0), output_tokens bigint CHECK(output_tokens >= 0),
  estimated_cost numeric(20,6) CHECK(estimated_cost >= 0), reported_cost numeric(20,6) CHECK(reported_cost >= 0),
  error_code text, UNIQUE(run_id,phase,attempt_no), UNIQUE(planning_job_id,phase,attempt_no), UNIQUE(id,student_id),
  CHECK((phase='planning')=(planning_job_id IS NOT NULL))
);

CREATE TABLE exam_app.answer_plans (
  id uuid PRIMARY KEY, attempt_id uuid NOT NULL, student_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES exam_app.delivery_policies(id), generation_job_id uuid,
  FOREIGN KEY(generation_job_id,policy_id,student_id) REFERENCES exam_app.plan_generation_jobs(id,policy_id,student_id),
  version integer NOT NULL CHECK(version > 0), seed bytea NOT NULL CHECK(octet_length(seed)=32),
  reference_sha256 text, allocation jsonb NOT NULL CHECK(jsonb_typeof(allocation)='object'),
  confidence text NOT NULL CHECK(confidence IN ('exact_for_reference','estimate','unsupported')),
  proposed_by text NOT NULL CHECK(proposed_by IN ('deterministic','ai_assisted','operator')),
  state text NOT NULL CHECK(state IN ('draft','approved','frozen','retired')),
  approved_by uuid REFERENCES exam_app.users(id), frozen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(attempt_id,student_id) REFERENCES exam_app.exam_attempts(id,student_id),
  UNIQUE(attempt_id,version), UNIQUE(id,attempt_id,student_id)
);
CREATE TABLE exam_app.answer_plan_items (
  id uuid PRIMARY KEY, plan_id uuid NOT NULL, attempt_id uuid NOT NULL, student_id uuid NOT NULL, slot_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('original','simulate_alternative')),
  FOREIGN KEY(plan_id,attempt_id,student_id) REFERENCES exam_app.answer_plans(id,attempt_id,student_id),
  FOREIGN KEY(slot_id,attempt_id,student_id) REFERENCES exam_app.question_slots(id,attempt_id,student_id),
  UNIQUE(plan_id,slot_id), UNIQUE(id,slot_id,student_id)
);
CREATE TABLE exam_app.answer_presentations (
  id uuid PRIMARY KEY, slot_id uuid NOT NULL, student_id uuid NOT NULL, source_run_id uuid NOT NULL,
  plan_item_id uuid,
  mode text NOT NULL CHECK(mode IN ('original','practice_simulation')),
  response_kind text NOT NULL,
  answer_text text NOT NULL, selected_options jsonb CHECK(selected_options IS NULL OR jsonb_typeof(selected_options)='array'),
  is_simulated boolean NOT NULL DEFAULT false, policy_applied boolean NOT NULL DEFAULT false,
  not_applied_reason text, display_verified boolean NOT NULL DEFAULT false,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_run_id,slot_id,student_id) REFERENCES exam_app.run_results(run_id,slot_id,student_id),
  FOREIGN KEY(plan_item_id,slot_id,student_id) REFERENCES exam_app.answer_plan_items(id,slot_id,student_id),
  CHECK(NOT is_simulated OR (mode='practice_simulation' AND policy_applied AND plan_item_id IS NOT NULL AND NOT display_verified)),
  CHECK(policy_applied=is_simulated),
  UNIQUE(id,slot_id,student_id)
);
ALTER TABLE exam_app.question_slots ADD CONSTRAINT slot_revision_scope
  FOREIGN KEY(current_revision_id,id,student_id) REFERENCES exam_app.question_revisions(id,slot_id,student_id);
ALTER TABLE exam_app.question_slots ADD CONSTRAINT slot_run_scope
  FOREIGN KEY(current_run_id,id,student_id) REFERENCES exam_app.answer_runs(id,slot_id,student_id);
ALTER TABLE exam_app.question_slots ADD CONSTRAINT slot_presentation_scope
  FOREIGN KEY(published_presentation_id,id,student_id) REFERENCES exam_app.answer_presentations(id,slot_id,student_id);

-- Per-attempt transactionally allocated sequence; not a global BIGSERIAL replay cursor.
CREATE TABLE exam_app.attempt_streams (
  attempt_id uuid PRIMARY KEY REFERENCES exam_app.exam_attempts(id),
  last_seq bigint NOT NULL DEFAULT 0 CHECK(last_seq >= 0), min_retained_seq bigint NOT NULL DEFAULT 0 CHECK(min_retained_seq >= 0),
  CHECK(min_retained_seq <= last_seq)
);
CREATE TABLE exam_app.attempt_events (
  attempt_id uuid NOT NULL REFERENCES exam_app.attempt_streams(attempt_id), seq bigint NOT NULL CHECK(seq > 0),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1), aggregate_version bigint NOT NULL CHECK(aggregate_version > 0),
  event_type text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK(publish_attempts >= 0),
  PRIMARY KEY(attempt_id,seq)
);
CREATE INDEX event_outbox ON exam_app.attempt_events(created_at) WHERE published_at IS NULL;
CREATE TABLE exam_app.idempotency_requests (
  actor_id uuid NOT NULL REFERENCES exam_app.users(id), operation text NOT NULL, request_id uuid NOT NULL,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('accepted','completed','rejected')),
  response_status integer CHECK(response_status BETWEEN 200 AND 599), response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  PRIMARY KEY(actor_id,operation,request_id), CHECK(expires_at > created_at)
);
CREATE TABLE exam_app.audit_logs (
  id uuid PRIMARY KEY, actor_id uuid REFERENCES exam_app.users(id), action text NOT NULL,
  target_type text NOT NULL, target_id uuid, correlation_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'), -- Redacted metadata only.
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_time ON exam_app.audit_logs(actor_id,created_at DESC,id);
CREATE INDEX audit_target_time ON exam_app.audit_logs(target_type,target_id,created_at DESC,id);
CREATE TABLE exam_app.usage_reservations (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES exam_app.users(id),
  model_call_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(model_call_id,user_id) REFERENCES exam_app.model_call_attempts(id,student_id),
  quota_day date NOT NULL, units integer NOT NULL CHECK(units > 0),
  status text NOT NULL CHECK(status IN ('reserved','dispatched','settled','released','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE INDEX usage_user_day ON exam_app.usage_reservations(user_id,quota_day,status);
CREATE TABLE exam_app.execution_permits (
  role text NOT NULL CHECK(role IN ('solver','verifier')), slot_no integer NOT NULL CHECK(slot_no BETWEEN 1 AND 64),
  holder_call_id uuid UNIQUE REFERENCES exam_app.model_call_attempts(id), lease_token uuid,
  lease_expires_at timestamptz,
  PRIMARY KEY(role,slot_no),
  CHECK((holder_call_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
     OR (holder_call_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

-- REQUIRED TRANSACTIONAL INVARIANTS, not claimed to be enforced by the draft DDL alone:
-- 1. Published template/policy/plan and sealed revision/result rows are immutable.
-- 2. Exactly one primary model image; <=7 materials; ready state, cumulative <=8MiB.
-- 3. Module snapshot/counts and plan budgets match the frozen template/policy.
-- 4. Plan belongs to the attempt's frozen delivery policy; originals/presentations stay distinct.
-- 5. Result, presentation, slot/version, cursor, event and idempotency receipt commit atomically.
-- 6. Active revision/run + lease token + cancellation/window checked before any paid dispatch/publish.
-- 7. Authorization scopes and time overlap validated under locks; no user-supplied owner authority.
-- 8. Quota and execution permits allocated under DB locks; Redis failure cannot bypass admission.
COMMIT;
