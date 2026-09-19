-- A tick means the rent is settled, so a short payment cannot earn one.
--
-- Accepting less than what is due used to be allowed and merely reported as a
-- shortfall, which left a row marked paid while money was still owed. The
-- check lives here rather than on the button: a disabled button is a
-- suggestion, and this is the thing the count on everyone's home screen is
-- counting.
--
-- More than what is due is still fine — handing over an extra note and taking
-- change back is ordinary, and nothing is owed afterwards.

-- The return type changes, so the old one has to go first.
DROP FUNCTION IF EXISTS public.record_rent_payment(uuid, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.record_rent_payment(uuid, jsonb, boolean);

/**
 * Records a cash handover, or reverses one.
 *
 * Returns { ok, reason, counted_cents, due_cents, short_cents }.
 *
 * Accepting requires the counted notes to cover the rent in full. Reversing
 * carries no such condition — undoing a mistake must always be possible.
 */
CREATE OR REPLACE FUNCTION public.record_rent_payment(
  _due_id uuid,
  _notes jsonb,
  _paid boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _due public.rent_dues%ROWTYPE;
  _cents integer := 0;
  _denomination text;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT * INTO _due FROM public.rent_dues WHERE id = _due_id;
  IF _due.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_row');
  END IF;

  FOREACH _denomination IN ARRAY ARRAY['100', '50', '20', '10', '5', '1'] LOOP
    _cents := _cents
      + GREATEST(COALESCE((_notes ->> _denomination)::integer, 0), 0)
      * _denomination::integer * 100;
  END LOOP;

  IF _paid AND _cents < _due.amount_due_cents THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'short',
      'counted_cents', _cents,
      'due_cents', _due.amount_due_cents,
      'short_cents', _due.amount_due_cents - _cents
    );
  END IF;

  UPDATE public.rent_dues
     SET notes = COALESCE(_notes, '{}'::jsonb),
         amount_paid_cents = _cents,
         paid = COALESCE(_paid, false),
         paid_at = CASE WHEN _paid THEN now() ELSE NULL END,
         approved_by = CASE WHEN _paid THEN auth.uid() ELSE NULL END,
         updated_at = now()
   WHERE id = _due_id;

  RETURN jsonb_build_object('ok', true, 'counted_cents', _cents);
END;
$$;

REVOKE ALL ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_rent_payment(uuid, jsonb, boolean) TO authenticated;
