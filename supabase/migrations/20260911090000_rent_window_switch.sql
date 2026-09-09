-- The collection window opens because the collector says so, not because of
-- the calendar.
--
-- Dates alone were deciding when the house could enter rent, which meant the
-- window opened itself on a schedule whether or not anyone was collecting.
-- A switch now governs it, and the dates are what the switch is announcing.
--
-- The switch is enforced here rather than in the app: a screen that hides the
-- button still leaves the function callable. Closed means the write is
-- refused, whoever is asking and however they ask.

ALTER TABLE public.rent_cycles
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT false;

/**
 * What the house is allowed to know: whether the window is open, until when,
 * and how many have paid. No names, no amounts.
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
    'is_open', _cycle.is_open,
    'window_start', _cycle.window_start,
    'window_end', _cycle.window_end,
    'paid', COALESCE(_paid, 0),
    'total', COALESCE(_total, 0)
  );
END;
$$;

/**
 * Records what the caller says they handed over.
 *
 * Only their own row, only while the collector has the window open, and only
 * before it has been accepted. The note counts are rebuilt from the six
 * denominations, so a client cannot smuggle in a seventh or a negative one.
 */
CREATE OR REPLACE FUNCTION public.declare_rent_notes(_notes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _cycle public.rent_cycles%ROWTYPE;
  _due public.rent_dues%ROWTYPE;
  _clean jsonb := '{}'::jsonb;
  _cents integer := 0;
  _denomination text;
  _count integer;
BEGIN
  SELECT m.household_id INTO _household
    FROM public.household_members AS m
   WHERE m.user_id = auth.uid()
   LIMIT 1;

  IF _household IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_household');
  END IF;

  SELECT * INTO _cycle
    FROM public.rent_cycles AS c
   WHERE c.household_id = _household
   ORDER BY c.period DESC
   LIMIT 1;

  IF _cycle.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cycle');
  END IF;

  IF NOT _cycle.is_open THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'window_closed');
  END IF;

  SELECT * INTO _due
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _cycle.id AND d.user_id = auth.uid();

  IF _due.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_included');
  END IF;

  IF _due.paid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted');
  END IF;

  FOREACH _denomination IN ARRAY ARRAY['100', '50', '20', '10', '5', '1'] LOOP
    _count := GREATEST(COALESCE((_notes ->> _denomination)::integer, 0), 0);
    IF _count > 0 THEN
      _clean := _clean || jsonb_build_object(_denomination, _count);
      _cents := _cents + _count * _denomination::integer * 100;
    END IF;
  END LOOP;

  UPDATE public.rent_dues
     SET declared_notes = _clean,
         declared_cents = _cents,
         declared_at = now(),
         updated_at = now()
   WHERE id = _due.id;

  RETURN jsonb_build_object('ok', true, 'declared_cents', _cents);
END;
$$;
