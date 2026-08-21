-- Track only the most recent editor on shared household data.
-- Single overwritable column per table: no revision history is retained.

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grocery_items
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.pantry_items
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.cooking_tasks
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill the editor from the creator so existing rows show an author
-- instead of a blank byline.
UPDATE public.recipes       SET updated_by = created_by WHERE updated_by IS NULL;
UPDATE public.grocery_items SET updated_by = created_by WHERE updated_by IS NULL;
UPDATE public.cooking_tasks SET updated_by = created_by WHERE updated_by IS NULL;
