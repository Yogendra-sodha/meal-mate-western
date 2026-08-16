GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_household(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_household_by_code(text) TO authenticated;