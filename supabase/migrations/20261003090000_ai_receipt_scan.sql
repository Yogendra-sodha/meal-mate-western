-- Receipt scanning, metered and priced on its own.
--
-- A third source joins pasted text and YouTube links: a photograph of a till
-- receipt. It is billed differently again — an image costs by the number of
-- tiles it covers, not by a prompt's length or a video's duration — so it gets
-- its own two rates for the same reason video did. Borrowing another source's
-- price list would report a spend that was never charged, which is the one
-- thing a meter must not do.
--
-- The defaults are deliberately low: a shrunk photo of a receipt is a couple of
-- thousand input tokens and a short reply. They are settings rather than
-- constants, as before, so a change of model is an admin edit and not a deploy.

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS receipt_input_cost_per_mtok numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS receipt_output_cost_per_mtok numeric NOT NULL DEFAULT 1.50;

/**
 * Closes out a reserved call with what it actually cost.
 *
 * Cost is worked out here from the token counts the provider reported and the
 * price list for that source, so neither can be talked down by the caller.
 *
 * An unknown source falls back to the text rates rather than to zero: a call
 * that cost something must never be recorded as free, and a source this
 * function has not been taught about is a bug to notice, not a discount.
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
  ELSIF _source = 'receipt' THEN
    _in_rate := COALESCE(_settings.receipt_input_cost_per_mtok, 0);
    _out_rate := COALESCE(_settings.receipt_output_cost_per_mtok, 0);
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
