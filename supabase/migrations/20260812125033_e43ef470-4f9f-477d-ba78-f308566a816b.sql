
-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  default_servings integer NOT NULL DEFAULT 20,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT ALL ON public.households TO service_role;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);
CREATE INDEX household_members_user_idx ON public.household_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_members TO authenticated;
GRANT ALL ON public.household_members TO service_role;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_household_member(_household_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.household_members m
                 WHERE m.household_id = _household_id AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.shares_household(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members a
    JOIN public.household_members b ON a.household_id = b.household_id
    WHERE a.user_id = auth.uid() AND b.user_id = _user_id);
$$;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_household(id));
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "households_select" ON public.households FOR SELECT TO authenticated
  USING (public.is_household_member(id));
CREATE POLICY "households_insert" ON public.households FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "households_update" ON public.households FOR UPDATE TO authenticated
  USING (public.is_household_member(id)) WITH CHECK (public.is_household_member(id));
CREATE POLICY "households_delete" ON public.households FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "members_select" ON public.household_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_household_member(household_id));
CREATE POLICY "members_insert" ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "members_delete" ON public.household_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid()));

-- shared data tables
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cuisine text NOT NULL DEFAULT 'Gujarati',
  servings integer NOT NULL DEFAULT 20,
  prep_min integer NOT NULL DEFAULT 0,
  cook_min integer NOT NULL DEFAULT 0,
  preparation_instructions text[] NOT NULL DEFAULT '{}',
  cooking_instructions text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  source_name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  video_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug)
);
CREATE TABLE public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  name text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'pantry',
  staple boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX recipe_ingredients_recipe_idx ON public.recipe_ingredients(recipe_id);

CREATE TABLE public.meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  date date NOT NULL,
  servings integer NOT NULL DEFAULT 20,
  cooked boolean NOT NULL DEFAULT false,
  note text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, date)
);
CREATE TABLE public.meal_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id uuid NOT NULL REFERENCES public.meal_plans(id) ON DELETE CASCADE,
  recipe_ref text NOT NULL,
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX meal_plan_items_plan_idx ON public.meal_plan_items(meal_plan_id);

CREATE TABLE public.grocery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'pantry',
  purchased boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipe_title text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grocery_items_household_idx ON public.grocery_items(household_id);

CREATE TABLE public.pantry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'pantry',
  qty numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  recurring boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pantry_items_household_idx ON public.pantry_items(household_id);

CREATE TABLE public.cooking_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  date date NOT NULL,
  recipe_ref text,
  kind text NOT NULL DEFAULT 'chore',
  name text NOT NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (household_id, task_key)
);
CREATE INDEX cooking_tasks_household_date_idx ON public.cooking_tasks(household_id, date);

CREATE TABLE public.recipe_favorites (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  recipe_ref text NOT NULL,
  PRIMARY KEY (household_id, recipe_ref)
);
CREATE TABLE public.recipe_ratings (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  recipe_ref text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, recipe_ref, user_id)
);
CREATE TABLE public.grocery_checks (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  purchased boolean NOT NULL DEFAULT true,
  PRIMARY KEY (household_id, item_key)
);
CREATE TABLE public.cook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  date date NOT NULL,
  recipe_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cook_log_household_idx ON public.cook_log(household_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes, public.recipe_ingredients, public.meal_plans, public.meal_plan_items, public.grocery_items, public.pantry_items, public.cooking_tasks, public.recipe_favorites, public.recipe_ratings, public.grocery_checks, public.cook_log TO authenticated;
GRANT ALL ON public.recipes, public.recipe_ingredients, public.meal_plans, public.meal_plan_items, public.grocery_items, public.pantry_items, public.cooking_tasks, public.recipe_favorites, public.recipe_ratings, public.grocery_checks, public.cook_log TO service_role;

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooking_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes_all" ON public.recipes FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "meal_plans_all" ON public.meal_plans FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "grocery_items_all" ON public.grocery_items FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "pantry_items_all" ON public.pantry_items FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "cooking_tasks_all" ON public.cooking_tasks FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "recipe_favorites_all" ON public.recipe_favorites FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "recipe_ratings_all" ON public.recipe_ratings FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id) AND user_id = auth.uid());
CREATE POLICY "grocery_checks_all" ON public.grocery_checks FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "cook_log_all" ON public.cook_log FOR ALL TO authenticated
  USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY "recipe_ingredients_all" ON public.recipe_ingredients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND public.is_household_member(r.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND public.is_household_member(r.household_id)));
CREATE POLICY "meal_plan_items_all" ON public.meal_plan_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meal_plans p WHERE p.id = meal_plan_id AND public.is_household_member(p.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meal_plans p WHERE p.id = meal_plan_id AND public.is_household_member(p.household_id)));

-- profile auto-creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- join by invite code
CREATE OR REPLACE FUNCTION public.join_household_by_code(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hid uuid;
BEGIN
  SELECT id INTO _hid FROM public.households WHERE upper(invite_code) = upper(trim(_code));
  IF _hid IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (_hid, auth.uid(), 'member') ON CONFLICT (household_id, user_id) DO NOTHING;
  RETURN _hid;
END; $$;
REVOKE ALL ON FUNCTION public.join_household_by_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_household_by_code(text) TO authenticated;

-- realtime
ALTER TABLE public.recipes REPLICA IDENTITY FULL;
ALTER TABLE public.recipe_ingredients REPLICA IDENTITY FULL;
ALTER TABLE public.meal_plans REPLICA IDENTITY FULL;
ALTER TABLE public.meal_plan_items REPLICA IDENTITY FULL;
ALTER TABLE public.grocery_items REPLICA IDENTITY FULL;
ALTER TABLE public.pantry_items REPLICA IDENTITY FULL;
ALTER TABLE public.cooking_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.recipe_favorites REPLICA IDENTITY FULL;
ALTER TABLE public.recipe_ratings REPLICA IDENTITY FULL;
ALTER TABLE public.grocery_checks REPLICA IDENTITY FULL;
ALTER TABLE public.cook_log REPLICA IDENTITY FULL;
ALTER TABLE public.household_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes, public.recipe_ingredients, public.meal_plans, public.meal_plan_items, public.grocery_items, public.pantry_items, public.cooking_tasks, public.recipe_favorites, public.recipe_ratings, public.grocery_checks, public.cook_log, public.household_members;
