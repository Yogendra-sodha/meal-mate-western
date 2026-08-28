-- Metered AI recipe import.
--
-- The feature spends real money per call, so the limits live here rather than
-- in the app: a check in the client can be skipped by calling the server
-- function directly, and two quick taps can both pass a check-then-write done
-- in two steps. claim_ai_call does the checking and the recording in one
-- statement, under the caller's own identity.
--
-- Nothing writes to ai_usage directly. The table has no INSERT, UPDATE or
-- DELETE policy at all, so the only way to add a row is through the two
-- SECURITY DEFINER functions below, both of which verify household membership
-- first — a definer function bypasses RLS, so it has to re-check by hand what
-- RLS would otherwise have enforced.

CREATE TABLE IF NOT EXISTS public.ai_settings (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  -- The admin's kill switch. Everyone may use the feature until this is off.
  enabled boolean NOT NULL DEFAULT true,
  daily_calls_per_user integer NOT NULL DEFAULT 5,
  monthly_cost_cap_cents integer NOT NULL DEFAULT 200,
  -- Prices are settings, not constants: they change without warning, and a
  -- wrong number here should be fixable from the admin screen, not a deploy.
  input_cost_per_mtok numeric NOT NULL DEFAULT 0.25,
  output_cost_per_mtok numeric NOT NULL DEFAULT 2.00,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  model text NOT NULL DEFAULT '',
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_cents numeric NOT NULL DEFAULT 0,
  -- pending -> ok | not_a_recipe | invalid_output | provider_error
  --
  -- Failures are kept and still count against the daily allowance. If they did
  -- not, a paste that keeps failing would be an unlimited supply of free calls.
  outcome text NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS ai_usage_household_created_idx
  ON public.ai_usage(household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_user_created_idx
  ON public.ai_usage(user_id, created_at DESC);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Members can read both, so the app can show "2 of 5 left today" without a
-- round trip through an admin function.
CREATE POLICY "ai_settings_read" ON public.ai_settings FOR SELECT TO authenticated
  USING (public.is_household_member(household_id) OR public.is_app_admin());
CREATE POLICY "ai_usage_read" ON public.ai_usage FOR SELECT TO authenticated
  USING (public.is_household_member(household_id) OR public.is_app_admin());

-- Only an app admin may move the limits or flip the switch.
CREATE POLICY "ai_settings_admin_write" ON public.ai_settings FOR UPDATE TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

GRANT SELECT ON public.ai_settings, public.ai_usage TO authenticated;
GRANT UPDATE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings, public.ai_usage TO service_role;

/**
 * Reserves one AI call for the caller, or explains why it cannot.
 *
 * Returns jsonb: { allowed, reason, usage_id, remaining_today, model_hint }.
 * On success a pending row already exists, so the call is counted before the
 * provider is ever contacted — a crash mid-call leaves the attempt recorded
 * rather than free.
 */
CREATE OR REPLACE FUNCTION public.claim_ai_call()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _settings public.ai_settings%ROWTYPE;
  _used_today integer;
  _spent_cents numeric;
  _usage_id uuid;
BEGIN
  SELECT m.household_id INTO _household
    FROM public.household_members AS m
   WHERE m.user_id = auth.uid()
   LIMIT 1;

  IF _household IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_household');
  END IF;

  -- First use in a household creates its row, so the defaults above apply
  -- without a separate seeding step.
  INSERT INTO public.ai_settings (household_id) VALUES (_household)
  ON CONFLICT (household_id) DO NOTHING;

  SELECT * INTO _settings FROM public.ai_settings WHERE household_id = _household;

  IF NOT _settings.enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT count(*) INTO _used_today
    FROM public.ai_usage AS u
   WHERE u.household_id = _household
     AND u.user_id = auth.uid()
     AND u.created_at >= date_trunc('day', now());

  IF _used_today >= _settings.daily_calls_per_user THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'limit', _settings.daily_calls_per_user
    );
  END IF;

  SELECT COALESCE(sum(u.cost_cents), 0) INTO _spent_cents
    FROM public.ai_usage AS u
   WHERE u.household_id = _household
     AND u.created_at >= date_trunc('month', now());

  IF _spent_cents >= _settings.monthly_cost_cap_cents THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_cap',
      'spent_cents', _spent_cents,
      'cap_cents', _settings.monthly_cost_cap_cents
    );
  END IF;

  INSERT INTO public.ai_usage (household_id, user_id)
  VALUES (_household, auth.uid())
  RETURNING id INTO _usage_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'usage_id', _usage_id,
    'remaining_today', _settings.daily_calls_per_user - _used_today - 1
  );
END;
$$;

/**
 * Closes out a reserved call with what it actually cost.
 *
 * Cost is worked out here from the token counts the provider reported, so the
 * price list cannot be talked down by the caller.
 */
CREATE OR REPLACE FUNCTION public.record_ai_call(
  _usage_id uuid,
  _model text,
  _prompt_tokens integer,
  _completion_tokens integer,
  _outcome text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _settings public.ai_settings%ROWTYPE;
BEGIN
  SELECT u.household_id INTO _household
    FROM public.ai_usage AS u
   WHERE u.id = _usage_id AND u.user_id = auth.uid();

  IF _household IS NULL THEN
    RAISE EXCEPTION 'Unknown usage row';
  END IF;

  SELECT * INTO _settings FROM public.ai_settings WHERE household_id = _household;

  UPDATE public.ai_usage
     SET model = COALESCE(_model, ''),
         prompt_tokens = GREATEST(COALESCE(_prompt_tokens, 0), 0),
         completion_tokens = GREATEST(COALESCE(_completion_tokens, 0), 0),
         cost_cents =
           (GREATEST(COALESCE(_prompt_tokens, 0), 0) / 1000000.0)
             * COALESCE(_settings.input_cost_per_mtok, 0) * 100
           + (GREATEST(COALESCE(_completion_tokens, 0), 0) / 1000000.0)
             * COALESCE(_settings.output_cost_per_mtok, 0) * 100,
         outcome = COALESCE(_outcome, 'provider_error')
   WHERE id = _usage_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_call() FROM public, anon;
REVOKE ALL ON FUNCTION public.record_ai_call(uuid, text, integer, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_call() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_call(uuid, text, integer, integer, text) TO authenticated;
