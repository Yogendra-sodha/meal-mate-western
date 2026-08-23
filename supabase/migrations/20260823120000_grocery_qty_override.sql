-- Lets a generated grocery line's amount and unit be overridden.
--
-- Generated lines are computed from recipe quantities scaled to the planned
-- servings, so there is no row to edit. Like `dismissed`, the override rides on
-- the grocery_checks row keyed by "name|unit".
--
-- NULL means "no override", so the computed amount shows through and keeps
-- tracking the meal plan. A non-NULL value deliberately pins the line: it stops
-- following the plan until cleared, which the app surfaces in the editor.

ALTER TABLE public.grocery_checks
  ADD COLUMN IF NOT EXISTS qty_override numeric,
  ADD COLUMN IF NOT EXISTS unit_override text;
