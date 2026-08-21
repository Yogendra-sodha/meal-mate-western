-- App-wide admin: read-only visibility across every household.
--
-- Admin status lives in its own table with no INSERT/UPDATE/DELETE policy, so
-- it can only be granted from the SQL editor or a service-role connection.
-- No authenticated user can promote themselves through the API.

CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

-- Read-only, and only your own row: this is how the app knows whether to show
-- the admin screen. Deliberately no write policy.
GRANT SELECT ON public.app_admins TO authenticated;
GRANT ALL ON public.app_admins TO service_role;

DROP POLICY IF EXISTS app_admins_select_self ON public.app_admins;
CREATE POLICY app_admins_select_self ON public.app_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Additional permissive SELECT policies. These OR with the existing member
-- policies, widening read access for admins without loosening it for anyone else.
DROP POLICY IF EXISTS households_select_admin ON public.households;
CREATE POLICY households_select_admin ON public.households
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS members_select_admin ON public.household_members;
CREATE POLICY members_select_admin ON public.household_members
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

-- Single aggregated payload for the admin screen, so it does not fan out into
-- one query per household.
CREATE OR REPLACE FUNCTION public.admin_household_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Step 1: membership rows joined to the member's profile
  WITH member_rows AS (
    SELECT m.household_id
         , m.user_id
         , m.role
         , m.joined_at
         , COALESCE(NULLIF(p.name, ''), split_part(p.email, '@', 1), 'Roommate') AS name
         , COALESCE(p.email, '')                                                 AS email
      FROM public.household_members AS m
      LEFT JOIN public.profiles     AS p ON p.id = m.user_id
  )

  -- Step 2: per-household activity counts
  , activity AS (
    SELECT h.id                                                AS household_id
         , (SELECT count(*) FROM public.recipes       AS r WHERE r.household_id = h.id) AS recipe_count
         , (SELECT count(*) FROM public.meal_plans    AS mp WHERE mp.household_id = h.id) AS meal_plan_count
         , (SELECT count(*) FROM public.grocery_items AS g WHERE g.household_id = h.id) AS grocery_count
         , (SELECT count(*) FROM public.pantry_items  AS pi WHERE pi.household_id = h.id) AS pantry_count
      FROM public.households AS h
  )

  -- Step 3: collapse each household and its members into one JSON object
  SELECT jsonb_build_object(
           'households', COALESCE(jsonb_agg(household ORDER BY household ->> 'created_at' desc), '[]'::jsonb)
         )
    INTO _result
    FROM (
      SELECT jsonb_build_object(
               'id'               , h.id
             , 'name'             , h.name
             , 'invite_code'      , h.invite_code
             , 'default_servings' , h.default_servings
             , 'created_at'       , h.created_at
             , 'created_by'       , h.created_by
             , 'recipe_count'     , a.recipe_count
             , 'meal_plan_count'  , a.meal_plan_count
             , 'grocery_count'    , a.grocery_count
             , 'pantry_count'     , a.pantry_count
             , 'members'          , COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object(
                           'user_id'   , mr.user_id
                         , 'name'      , mr.name
                         , 'email'     , mr.email
                         , 'role'      , mr.role
                         , 'joined_at' , mr.joined_at
                         ) ORDER BY mr.joined_at)
                    FROM member_rows AS mr
                   WHERE mr.household_id = h.id)
                 , '[]'::jsonb)
             ) AS household
        FROM public.households AS h
        JOIN activity          AS a ON a.household_id = h.id
    ) AS packed;

  RETURN COALESCE(_result, jsonb_build_object('households', '[]'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION public.admin_household_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_household_overview() TO authenticated;
