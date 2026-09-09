-- Housemates enter their own notes; the collector still decides.
--
-- Saves the collector re-entering eight piles of cash, but the two things are
-- kept apart on purpose: what someone SAYS they handed over is a claim, and
-- what is accepted is a record. Only an admin turns one into the other.
--
-- The write path is a function rather than a policy because a member allowed
-- to UPDATE their own row could also lower amount_due_cents or set paid = true.
-- The function touches the declaration columns and nothing else, so neither is
-- reachable.

ALTER TABLE public.rent_dues
  ADD COLUMN IF NOT EXISTS declared_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS declared_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS declared_at timestamptz;

-- A member may read their own row: their rent, their declaration, their
-- status. This is permissive and ORs with the admin policy, so it widens
-- nobody else's view — every other row stays invisible to them.
CREATE POLICY "rent_dues_read_own" ON public.rent_dues FOR SELECT TO authenticated
  USING (user_id = auth.uid());

/**
 * Records what the caller says they handed over.
 *
 * Only their own row, only in the newest cycle, and only while it is still
 * unapproved. The note counts are rebuilt here from the six denominations, so
 * a client cannot smuggle in a seventh or a negative one, and the total is
 * computed rather than accepted.
 *
 * Returns { ok, reason, declared_cents }.
 */
CREATE OR REPLACE FUNCTION public.declare_rent_notes(_notes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _cycle_id uuid;
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

  SELECT c.id INTO _cycle_id
    FROM public.rent_cycles AS c
   WHERE c.household_id = _household
   ORDER BY c.period DESC
   LIMIT 1;

  IF _cycle_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cycle');
  END IF;

  SELECT * INTO _due
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _cycle_id AND d.user_id = auth.uid();

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

REVOKE ALL ON FUNCTION public.declare_rent_notes(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.declare_rent_notes(jsonb) TO authenticated;
