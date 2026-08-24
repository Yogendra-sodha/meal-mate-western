-- Records which week a shop was for, so its items stop reappearing.
--
-- Planned grocery lines are derived from the meal plan, not stored, so
-- clearing the tick marks simply regenerates them while the same dishes are
-- planned. Knowing the week a shop covered lets the list hide what that shop
-- already bought, while anything added to the plan afterwards still shows.
--
-- The week is stored rather than inferred from done_on: shopping on Saturday
-- for the week ahead is normal, and guessing would hide the wrong week.
--
-- Backfill uses the Sunday on or before done_on, matching the app's week.

ALTER TABLE public.shopping_trips
  ADD COLUMN IF NOT EXISTS covers_week date;

UPDATE public.shopping_trips
   SET covers_week = done_on - EXTRACT(dow FROM done_on)::integer
 WHERE covers_week IS NULL;
