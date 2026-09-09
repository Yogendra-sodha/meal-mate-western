-- Monthly rent collection, in cash.
--
-- The privacy rule here is the design. Row-level security hides rows, not
-- columns, so a table the house can read is a table whose amounts they can
-- read — whatever the screen chooses to show. Amounts, note counts and totals
-- therefore live in a table no one but an app admin can select from at all,
-- and the house reads the board through a function that returns a count and
-- nothing else. A housemate cannot fetch an amount because no query available
-- to them returns one.

CREATE TABLE IF NOT EXISTS public.rent_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  -- The month the rent is FOR, always the first of that month. Keyed by month
  -- rather than by date because a window can end in the next one: December's
  -- runs 27 Dec to 2 Jan, which would otherwise collide with January's.
  period date NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, period)
);

CREATE TABLE IF NOT EXISTS public.rent_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.rent_cycles(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_due_cents integer NOT NULL DEFAULT 0,
  -- Counted notes, as { "100": 4, "20": 10 }. The total is worked out from
  -- this rather than typed, so the figure cannot disagree with the notes.
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, user_id)
);

CREATE INDEX IF NOT EXISTS rent_dues_cycle_idx ON public.rent_dues(cycle_id);
CREATE INDEX IF NOT EXISTS rent_cycles_household_period_idx
  ON public.rent_cycles(household_id, period DESC);

ALTER TABLE public.rent_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_dues ENABLE ROW LEVEL SECURITY;

-- The cycle carries only dates, so the house may read it: that is what tells
-- everyone the window has opened.
CREATE POLICY "rent_cycles_read" ON public.rent_cycles FOR SELECT TO authenticated
  USING (public.is_household_member(household_id) OR public.is_app_admin());
CREATE POLICY "rent_cycles_admin_write" ON public.rent_cycles FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

-- Money: admin only, for every operation including SELECT. There is
-- deliberately no member-readable policy on this table.
CREATE POLICY "rent_dues_admin_all" ON public.rent_dues FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

GRANT SELECT ON public.rent_cycles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.rent_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_dues TO authenticated;
GRANT ALL ON public.rent_cycles, public.rent_dues TO service_role;

/**
 * What the house is allowed to know: how many have paid, and by when.
 *
 * No names and no amounts. Returns the newest cycle for the caller's
 * household, or null when there is none.
 */
CREATE OR REPLACE FUNCTION public.rent_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _cycle public.rent_cycles%ROWTYPE;
  _paid integer;
  _total integer;
BEGIN
  SELECT m.household_id INTO _household
    FROM public.household_members AS m
   WHERE m.user_id = auth.uid()
   LIMIT 1;

  IF _household IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _cycle
    FROM public.rent_cycles AS c
   WHERE c.household_id = _household
   ORDER BY c.period DESC
   LIMIT 1;

  IF _cycle.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE d.paid), count(*)
    INTO _paid, _total
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _cycle.id;

  RETURN jsonb_build_object(
    'cycle_id', _cycle.id,
    'period', _cycle.period,
    'window_start', _cycle.window_start,
    'window_end', _cycle.window_end,
    'paid', COALESCE(_paid, 0),
    'total', COALESCE(_total, 0)
  );
END;
$$;

/**
 * Records a cash handover, or reverses one.
 *
 * The total is computed here from the notes and the fixed denominations, so
 * what is stored is always what was counted. A short payment is recorded as
 * what actually changed hands rather than being rounded up to what was due.
 */
CREATE OR REPLACE FUNCTION public.record_rent_payment(
  _due_id uuid,
  _notes jsonb,
  _paid boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cents integer := 0;
  _denomination text;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  FOREACH _denomination IN ARRAY ARRAY['100', '50', '20', '10', '5', '1'] LOOP
    _cents := _cents
      + GREATEST(COALESCE((_notes ->> _denomination)::integer, 0), 0)
      * _denomination::integer * 100;
  END LOOP;

  UPDATE public.rent_dues
     SET notes = COALESCE(_notes, '{}'::jsonb),
         amount_paid_cents = _cents,
         paid = COALESCE(_paid, false),
         paid_at = CASE WHEN _paid THEN now() ELSE NULL END,
         approved_by = CASE WHEN _paid THEN auth.uid() ELSE NULL END,
         updated_at = now()
   WHERE id = _due_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rent_board() FROM public, anon;
REVOKE ALL ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rent_board() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean) TO authenticated;
