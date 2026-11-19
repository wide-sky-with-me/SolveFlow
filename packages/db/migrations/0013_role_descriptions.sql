-- Additive role metadata columns for admin-editable scope summaries and operational notes.
ALTER TABLE exam_app.roles
  ADD COLUMN summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 240),
  ADD COLUMN note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
