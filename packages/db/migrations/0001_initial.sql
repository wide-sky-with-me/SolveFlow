CREATE TABLE owners (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE uploads (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/jpeg'), bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 4194304),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048), height integer NOT NULL CHECK (height BETWEEN 1 AND 2048), hash text NOT NULL,
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','deleting','deleted')), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  delete_attempts integer NOT NULL DEFAULT 0 CHECK (delete_attempts >= 0)
);
CREATE INDEX uploads_owner_idx ON uploads(owner_id);
CREATE INDEX uploads_expiry_idx ON uploads(expires_at);
CREATE TABLE sessions (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), upload_id uuid NOT NULL UNIQUE REFERENCES uploads(id), subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE INDEX sessions_owner_idx ON sessions(owner_id);
CREATE TABLE runs (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), session_id uuid NOT NULL REFERENCES sessions(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','understanding','solving','verifying','revising','completed','needs_clarification','failed','cancelled')),
  message text NOT NULL CHECK (length(message) <= 2000), idempotency_key text NOT NULL, input_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  seq integer NOT NULL DEFAULT 0 CHECK (seq BETWEEN 0 AND 128), lease_owner uuid, lease_expires_at timestamptz,
  outcome jsonb, schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  CONSTRAINT runs_idempotency_unique UNIQUE(owner_id,session_id,idempotency_key),
  CONSTRAINT runs_terminal_result CHECK ((status IN ('completed','needs_clarification','failed','cancelled')) = (outcome IS NOT NULL))
);
CREATE UNIQUE INDEX runs_active_session_unique ON runs(session_id) WHERE status NOT IN ('completed','needs_clarification','failed','cancelled');
CREATE INDEX runs_queue_idx ON runs(status,created_at);
CREATE TABLE run_events (run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE, seq integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,seq));
