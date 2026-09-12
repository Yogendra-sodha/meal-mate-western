-- Deleting a recipe puts it aside rather than destroying it.
--
-- A recipe can be one of the ones built into the app, which has no row to
-- delete, so the archive is a list of references rather than a flag on a
-- table. That also makes putting one back a deletion from this list, with the
-- recipe itself never having been touched.
--
-- Days already planned keep working: an archived recipe still resolves by
-- name, it simply stops being offered.

CREATE TABLE IF NOT EXISTS public.recipe_archive (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  -- The recipe's slug, matching meal_plan_items.recipe_ref — built-in and
  -- household recipes are referred to the same way everywhere else.
  recipe_ref text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (household_id, recipe_ref)
);

ALTER TABLE public.recipe_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_archive_all" ON public.recipe_archive FOR ALL TO authenticated
  USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_archive TO authenticated;
GRANT ALL ON public.recipe_archive TO service_role;

ALTER TABLE public.recipe_archive REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_archive;
