-- Additive: previous runs keep their original request and result unchanged.
ALTER TABLE runs ADD COLUMN context jsonb;
ALTER TABLE runs ADD CONSTRAINT runs_context_object CHECK (context IS NULL OR jsonb_typeof(context) = 'object');
