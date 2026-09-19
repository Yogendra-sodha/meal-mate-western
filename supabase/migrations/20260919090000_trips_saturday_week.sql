-- Move the shops already filed onto the Saturday week.
--
-- A trip records which week it covers, and until the menu moved to Saturday
-- that was the Sunday the week began on. The app now asks for the Saturday
-- one, so every trip filed before the change stops matching the week it
-- belongs to — and a week whose shop cannot be found offers the whole list
-- again, as if nothing had been bought.
--
-- The Sunday week S..S+6 sits inside the Saturday week starting S-1, so the
-- date simply moves back a day. Only Sundays are touched, which is exactly
-- the set written under the old rule: nothing since is stored on one, so
-- running this twice changes nothing the second time.

UPDATE public.shopping_trips
   SET covers_week = covers_week - 1
 WHERE covers_week IS NOT NULL
   AND EXTRACT(dow FROM covers_week) = 0;
