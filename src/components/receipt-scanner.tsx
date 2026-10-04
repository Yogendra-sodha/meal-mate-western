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
 * Everything on the slip ends up on the list: what was already there gets
 * ticked, and what was not gets added, ticked, under the everyday name the
 * model gave rather than the till's abbreviation. That way the shop filed
 * afterwards is the bill that was paid, not the part of it somebody had
 * thought to plan.
 */
export function ReceiptScanner({
  listNames,
  onScanned,
  label = "Scan the receipt",
}: {
  /** everything currently on the list, for the model to match lines against */
  listNames: string[];
  /** applies the receipt and answers how many items it had to add */
  onScanned: (result: ScannedReceipt) => Promise<number> | number;
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

      const added = await onScanned({
        store: receipt.store,
        total: receipt.totalStated ? receipt.total : null,
        matched,
        extras: rest,
        lineCount: receipt.lines.length,
      });

      setLineCount(receipt.lines.length);
      setExtras(rest);

      const merged = receipt.lines.filter((l) => l.mergedFrom > 1).length;
      const parts: string[] = [];
      if (matched.length) parts.push(`ticked off ${matched.length}`);
      if (added) parts.push(`added ${added} more`);
      if (merged) parts.push(`added up ${merged} repeated ${merged === 1 ? "line" : "lines"}`);
      toast.success(
        parts.length
          ? `Receipt read — ${parts.join(", ")}`
          : "Receipt read, but there was nothing new on it",
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
              Added from the receipt ({extras.length} of {lineCount})
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Bought but not on this week's list, so they were added and ticked off. Shown here
              under the name the till printed, next to what they went on the list as.
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {extras.slice(0, 12).map((line, i) => (
                <li key={`${line.name}-${i}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {line.cleanName && line.cleanName !== line.name
                      ? `${line.cleanName} — ${line.name}`
                      : line.name}
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
            Every line on the receipt was already on your list.
          </p>
        )
      ) : null}
    </div>
  );
}
