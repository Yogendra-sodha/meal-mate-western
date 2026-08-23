-- Lets a generated grocery line be removed from the list.
--
-- Generated lines are derived from the meal plan rather than stored, so there
-- is no row to delete. grocery_checks already tracks per-line state under the
-- same "name|unit" key, so the dismissal rides along with the tick state.
--
-- Clearing the list (clearPurchased) deletes these rows, which restores every
-- dismissed line as well as clearing the ticks.

ALTER TABLE public.grocery_checks
  ADD COLUMN IF NOT EXISTS dismissed boolean NOT NULL DEFAULT false;
