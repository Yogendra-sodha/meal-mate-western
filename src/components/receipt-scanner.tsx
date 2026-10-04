import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { matchedListNames, unmatchedLines, type ReceiptLine } from "@/lib/ai/receipt-schema";
import { scanReceipt, type ScanRefusal } from "@/lib/ai/receipt.functions";
import { shrinkImage } from "@/lib/images";

const MESSAGES: Record<ScanRefusal, string> = {
  not_configured: "Receipt scanning is not set up yet — no model key is configured.",
  no_household: "Join a household first.",
  disabled: "The admin has turned the AI features off.",
  daily_limit: "You have used today's AI calls. Try again tomorrow.",
  monthly_cap: "This month's AI budget is used up.",
  bad_image: "That file is not a photo. Take a picture of the receipt.",
  too_large: "That image is too big even after shrinking — try taking it again.",
  model_busy: "Both models are busy right now. Give it a minute and scan again.",
  not_a_receipt: "That is not a receipt — no prices on it. Photograph the till slip.",
  unreadable: "Could not read it. Try again with more light and the whole receipt in frame.",
  invalid_output: "The reply came back garbled. Try once more.",
  provider_error: "Could not reach the model.",
};

export interface ScannedReceipt {
  store: string;
  /** null when the receipt printed no total, so nothing typed gets overwritten */
  total: number | null;
  /** list items the receipt accounts for, named as the list names them */
  matched: string[];
  /** bought, but not on the list */
  extras: ReceiptLine[];
  lineCount: number;
}

/**
 * Photograph the till slip and tick off what it says you bought.
 *
 * The matching is the model's, done against the list sent with the photo, and
 * it is the one judgement here worth paying for: a till prints "TOM RED LB"
 * and "GV PNR 400G" for tomatoes and paneer, which no amount of string
 * comparison untangles.
 *
 * What it will not do is add anything. Items on the receipt that are not on
 * the list are shown and left alone — those printed names are abbreviations
 * nobody would recognise in a pantry a week later.
 */
export function ReceiptScanner({
  listNames,
  onScanned,
  label = "Scan the receipt",
}: {
  /** everything currently on the list, for the model to match lines against */
  listNames: string[];
  onScanned: (result: ScannedReceipt) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [extras, setExtras] = useState<ReceiptLine[] | null>(null);
  const [lineCount, setLineCount] = useState(0);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setExtras(null);
    try {
      const { base64, mimeType } = await shrinkImage(file);
      const result = await scanReceipt({
        data: { imageBase64: base64, mimeType, listNames },
      });

      if (!result.ok) {
        const base = MESSAGES[result.refusal] ?? "Could not read the receipt.";
        // A busy model already says everything useful; the provider's own
        // wording underneath only repeats it at greater length.
        toast.error(
          result.detail && result.refusal !== "model_busy" ? `${base} (${result.detail})` : base,
        );
        return;
      }

      const { receipt } = result;
      const matched = matchedListNames(receipt.lines);
      const rest = unmatchedLines(receipt.lines);

      onScanned({
        store: receipt.store,
        total: receipt.totalStated ? receipt.total : null,
        matched,
        extras: rest,
        lineCount: receipt.lines.length,
      });

      setLineCount(receipt.lines.length);
      setExtras(rest);

      const merged = receipt.lines.filter((l) => l.mergedFrom > 1).length;
      toast.success(
        matched.length
          ? `Ticked off ${matched.length} ${matched.length === 1 ? "item" : "items"}` +
              (merged ? ` • ${merged} repeated ${merged === 1 ? "line" : "lines"} added up` : "")
          : "Read the receipt, but nothing on it was on your list",
      );
    } catch (error) {
      console.error("[receipt] scan failed:", error);
      toast.error("Could not scan that photo");
    } finally {
      setBusy(false);
      // Cleared so picking the same file again still fires a change event.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the camera on a phone, the file picker on a desktop.
        capture="environment"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full rounded-full"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Camera className="mr-2 h-4 w-4" />
        )}
        {busy ? "Reading the receipt…" : label}
      </Button>

      {extras ? (
        extras.length ? (
          <div className="mt-3 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm font-bold">
              Also on the receipt ({extras.length} of {lineCount})
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Bought but not on this week's list, so nothing was ticked for these. The names are as
              the till printed them.
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {extras.slice(0, 12).map((line, i) => (
                <li key={`${line.name}-${i}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {line.name}
                    {line.mergedFrom > 1 ? ` ×${line.mergedFrom}` : ""}
                  </span>
                  {line.price > 0 ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {line.price.toFixed(2)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {extras.length > 12 ? (
              <p className="mt-1 text-xs text-muted-foreground">and {extras.length - 12} more</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Every line on the receipt was on your list.
          </p>
        )
      ) : null}
    </div>
  );
}
