-- Price list for gpt-5.6-luna: $0.20 per 1M input tokens, $1.20 per 1M output.
--
-- Separate from the migration that created the table so a database where that
-- one already ran still ends up on the right numbers. Only rows still holding
-- the previous defaults are moved: a price corrected by hand on the admin
-- screen is a deliberate choice and is left alone.

ALTER TABLE public.ai_settings
  ALTER COLUMN input_cost_per_mtok SET DEFAULT 0.20,
  ALTER COLUMN output_cost_per_mtok SET DEFAULT 1.20;

UPDATE public.ai_settings
   SET input_cost_per_mtok = 0.20
 WHERE input_cost_per_mtok = 0.25;

UPDATE public.ai_settings
   SET output_cost_per_mtok = 1.20
 WHERE output_cost_per_mtok = 2.00;
