-- Sending a shop to Splitwise.
--
-- Three things are needed and none of them belong in the app's code: which
-- Splitwise group the house is, who each member is over there, and whether a
-- given shop has already been sent.
--
-- The last one is the important one. create_expense has no idempotency key, so
-- a double tap, a retry or a refresh posts the bill twice, and a duplicate here
-- is not a tidy-up job — it is real money wrong in ten people's ledgers. The
-- claim below makes posting twice impossible rather than unlikely.

CREATE TABLE IF NOT EXISTS public.splitwise_settings (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  -- The Splitwise group the shops are split in. Null until the admin picks one.
  group_id bigint,
  -- Off until someone has chosen a group and mapped the members.
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

/**
 * Who each household member is on Splitwise.
 *
 * A separate row rather than a column on household_members: not everyone in
 * the house is necessarily on Splitwise, and somebody who is not simply has no
 * row and is left out of the split rather than breaking it.
 */
CREATE TABLE IF NOT EXISTS public.splitwise_members (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  splitwise_user_id bigint NOT NULL,
  PRIMARY KEY (household_id, user_id)
);

ALTER TABLE public.shopping_trips
  -- Set once the expense exists over there. Its presence is what says "sent".
  ADD COLUMN IF NOT EXISTS splitwise_expense_id bigint,
  -- Held while a post is in flight, so two taps cannot both get through.
  ADD COLUMN IF NOT EXISTS splitwise_claimed_at timestamptz;

ALTER TABLE public.splitwise_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.splitwise_members ENABLE ROW LEVEL SECURITY;

-- Members may read both: the grocery screen has to know whether sending is set
-- up, and who can be included in a split.
CREATE POLICY "splitwise_settings_read" ON public.splitwise_settings FOR SELECT TO authenticated
  USING (public.is_household_member(household_id) OR public.is_app_admin());
CREATE POLICY "splitwise_members_read" ON public.splitwise_members FOR SELECT TO authenticated
  USING (public.is_household_member(household_id) OR public.is_app_admin());

-- Only an app admin sets the group or the mapping. Getting these wrong puts
-- someone else's name on a bill, so it is not everyone's switch to flip.
CREATE POLICY "splitwise_settings_admin" ON public.splitwise_settings FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "splitwise_members_admin" ON public.splitwise_members FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

GRANT SELECT ON public.splitwise_settings, public.splitwise_members TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.splitwise_settings, public.splitwise_members TO authenticated;
GRANT ALL ON public.splitwise_settings, public.splitwise_members TO service_role;

/**
 * Takes the right to post one shop to Splitwise, or refuses.
 *
 * Returns true to exactly one caller. A second tap, a retry or another phone
 * gets false and must not call Splitwise — the single UPDATE below both tests
 * and claims, so there is no gap between checking and acting for a second
 * caller to slip through.
 *
 * A claim goes stale after two minutes so that a crash mid-post does not lock
 * the shop out of ever being sent. That is longer than the call can take, the
 * request having its own shorter deadline.
 */
CREATE OR REPLACE FUNCTION public.claim_splitwise_post(_trip_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _claimed uuid;
BEGIN
  UPDATE public.shopping_trips AS t
     SET splitwise_claimed_at = now()
   WHERE t.id = _trip_id
     AND public.is_household_member(t.household_id)
     AND t.splitwise_expense_id IS NULL
     AND (t.splitwise_claimed_at IS NULL OR t.splitwise_claimed_at < now() - interval '2 minutes')
  RETURNING t.id INTO _claimed;

  RETURN _claimed IS NOT NULL;
END;
$$;

/** Records the expense that was created, closing the shop to further posting. */
CREATE OR REPLACE FUNCTION public.record_splitwise_post(_trip_id uuid, _expense_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.shopping_trips AS t
     SET splitwise_expense_id = _expense_id,
         splitwise_claimed_at = NULL
   WHERE t.id = _trip_id AND public.is_household_member(t.household_id);
END;
$$;

/** Gives the claim back after a failed post, so it can be tried again. */
CREATE OR REPLACE FUNCTION public.release_splitwise_post(_trip_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.shopping_trips AS t
     SET splitwise_claimed_at = NULL
   WHERE t.id = _trip_id
     AND public.is_household_member(t.household_id)
     AND t.splitwise_expense_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_splitwise_post(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_splitwise_post(uuid, bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.release_splitwise_post(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_splitwise_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_splitwise_post(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_splitwise_post(uuid) TO authenticated;
