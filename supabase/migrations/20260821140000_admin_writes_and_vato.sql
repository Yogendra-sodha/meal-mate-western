-- 1. Admin write access to households and membership.
-- 2. A shared "vato" table for the daily thought shown on the home page.

-- ---------------------------------------------------------------- admin writes

DROP POLICY IF EXISTS households_update_admin ON public.households;
CREATE POLICY households_update_admin ON public.households
  FOR UPDATE TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Deleting a household cascades to every row that references it: recipes,
-- meal plans, grocery, pantry, tasks and membership.
DROP POLICY IF EXISTS households_delete_admin ON public.households;
CREATE POLICY households_delete_admin ON public.households
  FOR DELETE TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS members_delete_admin ON public.household_members;
CREATE POLICY members_delete_admin ON public.household_members
  FOR DELETE TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS members_update_admin ON public.household_members;
CREATE POLICY members_update_admin ON public.household_members
  FOR UPDATE TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- ----------------------------------------------------------------------- vato

-- Swami ni Vato shown one-per-day on the home page. Shared app-wide rather
-- than per household, so every user sees the same thought on a given day.
CREATE TABLE IF NOT EXISTS public.vato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  reference text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vato_position_idx ON public.vato(position);

-- Same text for everyone, so avoid storing the identical passage twice.
-- Kept non-partial so ON CONFLICT (reference) can infer it; a vat with no
-- citation stores NULL, and NULLs do not collide in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS vato_reference_key ON public.vato(reference);

ALTER TABLE public.vato ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.vato TO authenticated;
GRANT ALL ON public.vato TO service_role;

-- Everyone reads; only admins write.
DROP POLICY IF EXISTS vato_select_all ON public.vato;
CREATE POLICY vato_select_all ON public.vato
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS vato_write_admin ON public.vato;
CREATE POLICY vato_write_admin ON public.vato
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

GRANT INSERT, UPDATE, DELETE ON public.vato TO authenticated;

-- Seed: the single passage supplied by the app owner. The remaining vato are
-- loaded through the admin screen's import, so nothing here is invented.
INSERT INTO public.vato (text, reference, position)
SELECT
  'One should continuously engage in delivering and listening to talks on the glory of God and his Sadhu. Maharaj has come here (to earth) with his Akshardham, pārshads and all his powers. He is exactly the same (today). He whom we wish to attain after death, we have attained during this life; there is nothing more left to attain. If this truth is not understood properly, the jiva remains weak. Once this is understood, the jiva will no longer consider itself weak and will acquire a different mettle. Also, there is no greater endeavour than to understand the glory of God. Without understanding the glory, even countless other endeavours will not enable the jiva to attain spiritual strength. The means to understanding this glory is profound association with such a holy Sadhu, and without it the true glory of God cannot be understood.'
  , 'Glory of God (37.1) / (1/1)'
  , 1
WHERE NOT EXISTS (SELECT 1 FROM public.vato WHERE reference = 'Glory of God (37.1) / (1/1)');
