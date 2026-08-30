-- Recipe import from video, metered separately from text.
--
-- Two providers now sit behind one feature, and they charge different rates:
-- pasted notes go to the text model, a YouTube link goes to a model that
-- watches the video and is billed by its duration. One price list would report
-- the wrong spend for whichever provider it was not written for, which defeats
-- the point of having a meter at all.
--
-- So each call records which source it came from, and the cost is worked out
-- from the price list for that source.

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS video_input_cost_per_mtok numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS video_output_cost_per_mtok numeric NOT NULL DEFAULT 1.50;

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'text';

-- Replaced rather than overloaded: two functions differing only by a trailing
-- argument is a trap for the next caller.
DROP FUNCTION IF EXISTS public.record_ai_call(uuid, text, integer, integer, text);

/**
 * Closes out a reserved call with what it actually cost.
 *
 * Cost is worked out here from the token counts the provider reported and the
 * price list for that source, so neither can be talked down by the caller.
 */
CREATE OR REPLACE FUNCTION public.record_ai_call(
  _usage_id uuid,
  _model text,
  _prompt_tokens integer,
  _completion_tokens integer,
  _outcome text,
  _source text DEFAULT 'text'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _household uuid;
  _settings public.ai_settings%ROWTYPE;
  _in_rate numeric;
  _out_rate numeric;
  _prompt integer := GREATEST(COALESCE(_prompt_tokens, 0), 0);
  _completion integer := GREATEST(COALESCE(_completion_tokens, 0), 0);
BEGIN
  SELECT u.household_id INTO _household
    FROM public.ai_usage AS u
   WHERE u.id = _usage_id AND u.user_id = auth.uid();

  IF _household IS NULL THEN
    RAISE EXCEPTION 'Unknown usage row';
  END IF;

  SELECT * INTO _settings FROM public.ai_settings WHERE household_id = _household;

  IF _source = 'video' THEN
    _in_rate := COALESCE(_settings.video_input_cost_per_mtok, 0);
    _out_rate := COALESCE(_settings.video_output_cost_per_mtok, 0);
  ELSE
    _in_rate := COALESCE(_settings.input_cost_per_mtok, 0);
    _out_rate := COALESCE(_settings.output_cost_per_mtok, 0);
  END IF;

  UPDATE public.ai_usage
     SET model = COALESCE(_model, ''),
         source = COALESCE(_source, 'text'),
         prompt_tokens = _prompt,
         completion_tokens = _completion,
         cost_cents = (_prompt / 1000000.0) * _in_rate * 100
                    + (_completion / 1000000.0) * _out_rate * 100,
         outcome = COALESCE(_outcome, 'provider_error')
   WHERE id = _usage_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_call(uuid, text, integer, integer, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_ai_call(uuid, text, integer, integer, text, text)
  TO authenticated;
