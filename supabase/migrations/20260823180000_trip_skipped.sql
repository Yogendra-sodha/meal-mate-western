-- Records the lines deliberately skipped during a shop.
--
-- Removing a planned line marks it dismissed on its grocery_checks row.
-- Finishing a shop deletes those rows, which cleared the dismissals and let
-- every skipped line reappear on the same week's list.
--
-- Only names are kept: these were not bought, so amounts and units would say
-- nothing. They are used solely to keep the line off that week's list, and are
-- not shown as part of the shop.

ALTER TABLE public.shopping_trips
  ADD COLUMN IF NOT EXISTS skipped jsonb NOT NULL DEFAULT '[]'::jsonb;
