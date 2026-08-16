DROP POLICY IF EXISTS households_select ON public.households;
CREATE POLICY households_select ON public.households
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_household_member(id));