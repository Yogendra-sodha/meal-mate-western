
REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.shares_household(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_household_by_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_household_by_code(text) TO authenticated;
