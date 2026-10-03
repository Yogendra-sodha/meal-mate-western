import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { unmatchedLines, type ReceiptLine } from "@/lib/ai/receipt-schema";
import { scanReceipt, type ScanRefusal } from "@/lib/ai/receipt.functions";
import { shrinkImage } from "@/lib/images";

const MESSAGES: Record<ScanRefusal, string> = {
  not_configured: "Receipt scanning is not set up yet — the Gemini key is missing.",
  no_household: "Join a household first.",
  disabled: "The admin has turned the AI features off.",
  daily_limit: "You have used today's AI calls. Try again tomorrow.",
  monthly_cap: "This month's AI budget is used up.",
  bad_image: "That file is not a photo. Take a picture of the receipt.",
  too_large: "That image is too big even after shrinking — try taking it again.",
  not_a_receipt: "That does not look like a receipt.",
  unreadable: "Could not read it. Try again with more light and the whole receipt in frame.",
  invalid_output: "The reply came back garbled. Try once more.",
  provider_error: "Could not reach the model.",
};

/**
 * Reads the shop and the bill total off a photographed receipt.
 *
 * It fills the two fields and stops there. What it will not do is write
 * anything into the pantry on its own: a till prints "TOM RED LB" and "GV
 * PNR 400G", and quietly turning those into stock would fill the pantry with
 * things nobody can recognise. So the lines that match nothing on the list are
 * shown, and what to do about them stays with the person reading them.
 */
export function ReceiptScanner({
  listNames,
  onRead,
}: {
  /** names currently on the shopping list, for spotting what else was bought */
  listNames: string[];
  onRead: (fields: { store: string; total: number | null }) => void;
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
      const result = await scanReceipt({ data: { imageBase64: base64, mimeType } });

      if (!result.ok) {
        const base = MESSAGES[result.refusal] ?? "Could not read the receipt.";
        toast.error(result.detail ? `${base} (${result.detail})` : base);
        return;
      }

      const { receipt } = result;
      onRead({
        store: receipt.store,
        // A total nobody printed must not overwrite one someone typed.
        total: receipt.totalStated ? receipt.total : null,
      });
      setLineCount(receipt.lines.length);
      setExtras(unmatchedLines(receipt.lines, listNames));
      toast.success(
        receipt.totalStated
          ? `Read ${receipt.lines.length} lines off the receipt`
          : `Read ${receipt.lines.length} lines — no total printed, so type it in`,
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
        {busy ? "Reading the receipt…" : "Scan the receipt"}
      </Button>

      {extras ? (
        extras.length ? (
          <div className="mt-3 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm font-bold">
              Also on the receipt ({extras.length} of {lineCount})
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Bought but not on this week's list. Add any to the pantry yourself if they are worth
              tracking — the names are as the till printed them.
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {extras.slice(0, 12).map((line, i) => (
                <li key={`${line.name}-${i}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{line.name}</span>
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
            Every line on the receipt matched something on the list.
          </p>
        )
      ) : null}
    </div>
  );
}
