-- Which model reads a receipt, as a setting rather than a deploy.
--
-- Published receipt-extraction benchmarks favour Gemini on both accuracy and
-- tokens per image, so that is the default. But those benchmarks are run on
-- American invoices, and this house shops where the till prints "GV PNR 400G"
-- — which is exactly the case a general benchmark says nothing about.
--
-- So the choice lives here, next to the prices, and for the same reason: the
-- answer is found by trying both on real receipts, and trying them should not
-- need a deploy between attempts.

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS receipt_provider text NOT NULL DEFAULT 'gemini';

-- Only the two the code knows how to build. A typo here would otherwise be
-- discovered as a silently wrong provider at the next scan.
ALTER TABLE public.ai_settings
  DROP CONSTRAINT IF EXISTS ai_settings_receipt_provider_check;
ALTER TABLE public.ai_settings
  ADD CONSTRAINT ai_settings_receipt_provider_check
  CHECK (receipt_provider IN ('gemini', 'openai'));
