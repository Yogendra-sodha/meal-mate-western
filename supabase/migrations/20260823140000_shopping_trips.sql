-- A completed shop, archived when the household ticks off the whole list.
--
-- Storage shape is deliberately compact. One row per shop with the items as
-- JSONB, rather than a row per item: a weekly shop of ~18 items would otherwise
-- add ~940 rows a year per household, each carrying a uuid, a foreign key and
-- row overhead, plus an index to join them back together. One row a week keeps
-- that at ~52.
--
-- Each item keeps only what a past shop needs — name, amount, unit, category.
-- Who edited it, which recipe asked for it and per-item timestamps are dropped:
-- none of it is useful once the shopping is done.

CREATE TABLE IF NOT EXISTS public.shopping_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  done_on date NOT NULL DEFAULT current_date,
  -- [{ "name": "Bhindi (okra)", "qty": 3, "unit": "kg", "category": "vegetables" }]
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supports the only read the app makes: this household's shops, newest first.
CREATE INDEX IF NOT EXISTS shopping_trips_household_idx
  ON public.shopping_trips(household_id, done_on desc);

ALTER TABLE public.shopping_trips ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_trips TO authenticated;
GRANT ALL ON public.shopping_trips TO service_role;

DROP POLICY IF EXISTS shopping_trips_all ON public.shopping_trips;
CREATE POLICY shopping_trips_all ON public.shopping_trips
  FOR ALL TO authenticated
  USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

-- Kept out of REPLICA IDENTITY FULL on purpose: the client reloads on any
-- change, so shipping whole old rows through WAL would buy nothing.
ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_trips;
