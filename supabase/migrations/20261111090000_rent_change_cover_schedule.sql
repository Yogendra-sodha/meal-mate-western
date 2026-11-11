-- Rent: change given back, paying for someone else, and a window that keeps
-- its own dates.
--
-- Three problems with how rent was recorded, all found by using it.
--
-- 1. Change. Someone owing 550 hands over 560 and gets a ten back. The row kept
--    560 as paid and the note tally kept the ten, so Collected was ten too
--    high and the tally claimed a note that had already gone back out of the
--    pile. The tally exists to match the cash in hand, so every bit of change
--    made it a little more wrong.
--
-- 2. Paying for someone. One person handing over two people's rent could only
--    be recorded as one person paying double. The other stayed unpaid, the
--    house count stayed one short, and the only way to tick them was to count
--    the same notes a second time.
--
-- 3. The window. Collection opened only when the switch was flipped, and the
--    house was always shown the newest month set up. A window that runs from
--    the end of one month into the next — 27 Sep to 3 Oct — vanished halfway
--    through the moment the next month was created, and nothing ever opened
--    on the start date by itself.
--
-- The rules are enforced here rather than in the app, as before: what decides
-- that a payment is settled is the thing everyone's paid count is counting.

-- ---------------------------------------------------------------------------
-- The window
-- ---------------------------------------------------------------------------

ALTER TABLE public.rent_cycles
  -- auto: open from the first day to the last, by itself. open / closed: the
  -- collector overriding the dates, for a late payer or an early stop.
  ADD COLUMN IF NOT EXISTS open_mode text NOT NULL DEFAULT 'auto',
  -- Whose calendar the dates are in. A window ending on the 31st should stay
  -- open until the end of the 31st where the house is, not until midnight in
  -- London, which in America is the evening before.
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';

ALTER TABLE public.rent_cycles DROP CONSTRAINT IF EXISTS rent_cycles_open_mode_check;
ALTER TABLE public.rent_cycles
  ADD CONSTRAINT rent_cycles_open_mode_check CHECK (open_mode IN ('auto', 'open', 'closed'));

-- Every existing month follows its dates from now on. A month left switched on
-- after its dates were over closes, which is the point; the collector can
-- hold it open again with "Open now" for anyone still to pay.
UPDATE public.rent_cycles SET open_mode = 'auto';

/** Today, in the given time zone; an unknown zone falls back to UTC rather than failing. */
CREATE OR REPLACE FUNCTION public.rent_local_today(_tz text)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(
           (SELECT z.name FROM pg_timezone_names AS z WHERE z.name = _tz LIMIT 1),
           'UTC'))::date
$$;

/** Whether a window is open right now: the collector's override if there is one, else the dates. */
CREATE OR REPLACE FUNCTION public.rent_window_open(_mode text, _start date, _end date, _tz text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE _mode
           WHEN 'open'   THEN true
           WHEN 'closed' THEN false
           ELSE public.rent_local_today(_tz) BETWEEN _start AND _end
         END
$$;

/**
 * The month the house should be looking at.
 *
 * An open window first, whichever month it belongs to — that is what stops
 * September's window disappearing when October is set up. With nothing open,
 * the newest month.
 */
CREATE OR REPLACE FUNCTION public.rent_current_cycle(_household uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id
    FROM public.rent_cycles AS c
   WHERE c.household_id = _household
   ORDER BY public.rent_window_open(c.open_mode, c.window_start, c.window_end, c.time_zone) DESC
          , c.period DESC
   LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Change and covering
-- ---------------------------------------------------------------------------

ALTER TABLE public.rent_dues
  -- Notes the collector handed back.
  ADD COLUMN IF NOT EXISTS change_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- True when the change came out of the collector's own wallet rather than
  -- the rent pile, in which case the pile still holds everything handed over.
  ADD COLUMN IF NOT EXISTS change_from_pocket boolean NOT NULL DEFAULT false,
  -- On the payer's row: whose rent they are also paying. Set by the payer when
  -- they declare, and settled by the collector when they accept.
  ADD COLUMN IF NOT EXISTS covers uuid[] NOT NULL DEFAULT '{}',
  -- On a covered person's row: who paid it.
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

/** Keeps only the six real denominations, never a negative count. */
CREATE OR REPLACE FUNCTION public.rent_clean_notes(_notes jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _clean jsonb := '{}'::jsonb;
  _denomination text;
  _count integer;
BEGIN
  FOREACH _denomination IN ARRAY ARRAY['100', '50', '20', '10', '5', '1'] LOOP
    _count := GREATEST(COALESCE((COALESCE(_notes, '{}'::jsonb) ->> _denomination)::integer, 0), 0);
    IF _count > 0 THEN
      _clean := _clean || jsonb_build_object(_denomination, _count);
    END IF;
  END LOOP;
  RETURN _clean;
END;
$$;

/** What a pile of notes comes to, in cents. */
CREATE OR REPLACE FUNCTION public.rent_notes_cents(_notes jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(sum((public.rent_clean_notes(_notes) ->> d)::integer * d::integer * 100), 0)::integer
    FROM unnest(ARRAY['100', '50', '20', '10', '5', '1']) AS d
$$;

-- ---------------------------------------------------------------------------
-- What the house sees
-- ---------------------------------------------------------------------------

/**
 * How many have paid, and whether collection is open — for the month that is
 * open now, not merely the newest. No names and no amounts, as before.
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
   WHERE c.id = public.rent_current_cycle(_household);
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
    -- Kept as is_open so the house screen reads it unchanged; it is now
    -- whether collection is open right now, by date or by override.
    'is_open', public.rent_window_open(_cycle.open_mode, _cycle.window_start, _cycle.window_end, _cycle.time_zone),
    'window_start', _cycle.window_start,
    'window_end', _cycle.window_end,
    'paid', COALESCE(_paid, 0),
    'total', COALESCE(_total, 0)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.declare_rent_notes(jsonb);

/**
 * Records what the caller says they are handing over, and for whom.
 *
 * Their own row only, only while collection is open, only before it has been
 * accepted. Anyone they say they are paying for must be on this month's rent;
 * whether that person has already paid is not checked here, because the
 * answer would tell a housemate who has paid. The collector sorts it out on
 * accepting, where it is checked.
 */
CREATE OR REPLACE FUNCTION public.declare_rent_notes(_notes jsonb, _covers uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _cycle public.rent_cycles%ROWTYPE;
  _due public.rent_dues%ROWTYPE;
  _clean jsonb;
  _covers_clean uuid[];
  _found integer;
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
   WHERE c.id = public.rent_current_cycle(_household);
  IF _cycle.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cycle');
  END IF;

  IF NOT public.rent_window_open(_cycle.open_mode, _cycle.window_start, _cycle.window_end, _cycle.time_zone) THEN
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

  SELECT COALESCE(array_agg(DISTINCT c), '{}')
    INTO _covers_clean
    FROM unnest(COALESCE(_covers, '{}')) AS c
   WHERE c IS NOT NULL AND c <> auth.uid();

  SELECT count(*) INTO _found
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _cycle.id AND d.user_id = ANY (_covers_clean);
  IF _found <> cardinality(_covers_clean) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_on_rent');
  END IF;

  _clean := public.rent_clean_notes(_notes);

  UPDATE public.rent_dues
     SET declared_notes = _clean,
         declared_cents = public.rent_notes_cents(_clean),
         declared_at = now(),
         covers = _covers_clean,
         updated_at = now()
   WHERE id = _due.id;

  RETURN jsonb_build_object(
    'ok', true,
    'declared_cents', public.rent_notes_cents(_clean),
    'covers', cardinality(_covers_clean)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.record_rent_payment(uuid, jsonb, boolean);

/**
 * Accepts a cash handover, or reverses one.
 *
 * Accepting settles the payer's rent and that of everyone they are covering,
 * in one step. What was handed over less the change given back has to come to
 * exactly what all of them owe: short is refused as before, and over is now
 * refused too, with the amount, because money kept over the rent is either
 * change that has not been recorded or a mistake, and either way it is not
 * rent.
 *
 * Each settled row records its own rent as paid, so Collected adds up to rent
 * and nothing else. The notes are kept once, on the payer's row.
 *
 * Reversing undoes the payer and everyone they covered together. A covered
 * row cannot be reversed on its own — the payer's notes would then no longer
 * match what they settled.
 *
 * Returns { ok, reason, ... } with the figures needed to explain a refusal.
 */
CREATE OR REPLACE FUNCTION public.record_rent_payment(
  _due_id uuid,
  _notes jsonb,
  _paid boolean,
  _change jsonb DEFAULT '{}'::jsonb,
  _change_from_pocket boolean DEFAULT false,
  _covers uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _due public.rent_dues%ROWTYPE;
  _notes_clean jsonb;
  _change_clean jsonb;
  _covers_clean uuid[];
  _handed integer;
  _given_back integer;
  _owed integer;
  _found integer;
  _already_paid uuid[];
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT * INTO _due FROM public.rent_dues WHERE id = _due_id;
  IF _due.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_row');
  END IF;

  -- Reversing.
  IF NOT COALESCE(_paid, false) THEN
    IF _due.paid_by IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'covered_by_other', 'paid_by', _due.paid_by);
    END IF;

    UPDATE public.rent_dues
       SET paid = false, paid_by = NULL, amount_paid_cents = 0,
           paid_at = NULL, approved_by = NULL, updated_at = now()
     WHERE cycle_id = _due.cycle_id AND paid_by = _due.user_id;

    UPDATE public.rent_dues
       SET paid = false, amount_paid_cents = 0, change_notes = '{}'::jsonb,
           change_from_pocket = false, paid_at = NULL, approved_by = NULL, updated_at = now()
     WHERE id = _due.id;

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Accepting.
  IF _due.paid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_paid');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c), '{}')
    INTO _covers_clean
    FROM unnest(COALESCE(_covers, _due.covers, '{}')) AS c
   WHERE c IS NOT NULL AND c <> _due.user_id;

  SELECT count(*), COALESCE(array_agg(d.user_id) FILTER (WHERE d.paid), '{}')
    INTO _found, _already_paid
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _due.cycle_id AND d.user_id = ANY (_covers_clean);

  IF _found <> cardinality(_covers_clean) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_on_rent');
  END IF;
  IF cardinality(_already_paid) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cover_already_paid', 'user_ids', to_jsonb(_already_paid));
  END IF;

  _notes_clean := public.rent_clean_notes(_notes);
  _change_clean := public.rent_clean_notes(_change);
  _handed := public.rent_notes_cents(_notes_clean);
  _given_back := public.rent_notes_cents(_change_clean);

  SELECT _due.amount_due_cents + COALESCE(sum(d.amount_due_cents), 0)
    INTO _owed
    FROM public.rent_dues AS d
   WHERE d.cycle_id = _due.cycle_id AND d.user_id = ANY (_covers_clean);

  IF _given_back > _handed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'change_too_big',
      'counted_cents', _handed, 'change_cents', _given_back);
  END IF;
  IF _handed - _given_back < _owed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'short',
      'counted_cents', _handed, 'change_cents', _given_back, 'due_cents', _owed,
      'short_cents', _owed - (_handed - _given_back));
  END IF;
  IF _handed - _given_back > _owed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'over',
      'counted_cents', _handed, 'change_cents', _given_back, 'due_cents', _owed,
      'over_cents', (_handed - _given_back) - _owed);
  END IF;

  UPDATE public.rent_dues
     SET paid = true, paid_by = _due.user_id, amount_paid_cents = amount_due_cents,
         notes = '{}'::jsonb, change_notes = '{}'::jsonb, change_from_pocket = false,
         paid_at = now(), approved_by = auth.uid(), updated_at = now()
   WHERE cycle_id = _due.cycle_id AND user_id = ANY (_covers_clean);

  UPDATE public.rent_dues
     SET paid = true, paid_by = NULL, amount_paid_cents = amount_due_cents,
         notes = _notes_clean, change_notes = _change_clean,
         change_from_pocket = COALESCE(_change_from_pocket, false) AND _given_back > 0,
         covers = _covers_clean,
         paid_at = now(), approved_by = auth.uid(), updated_at = now()
   WHERE id = _due.id;

  RETURN jsonb_build_object('ok', true,
    'counted_cents', _handed, 'change_cents', _given_back, 'due_cents', _owed,
    'covered', cardinality(_covers_clean));
END;
$$;

REVOKE ALL ON FUNCTION public.declare_rent_notes(jsonb, uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean, jsonb, boolean, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.declare_rent_notes(jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean, jsonb, boolean, uuid[]) TO authenticated;
