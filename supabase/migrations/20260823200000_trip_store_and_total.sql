-- Optional shop details: where it was bought and what it came to.
--
-- Both are nullable because both are optional at the point of saving a shop —
-- NULL means "not recorded", which reads differently from a total of zero.

ALTER TABLE public.shopping_trips
  ADD COLUMN IF NOT EXISTS store text,
  ADD COLUMN IF NOT EXISTS total numeric;
