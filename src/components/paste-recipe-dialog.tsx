import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { importRecipeText, type ImportRefusal } from "@/lib/ai/import.functions";
import { MAX_PASTE_LENGTH, MIN_PASTE_LENGTH, toRecipeDraft } from "@/lib/ai/recipe-schema";
import type { Recipe } from "@/lib/types";

/** Plain wording for every way an import can decline. */
const REFUSAL_MESSAGE: Record<ImportRefusal, string> = {
  not_configured: "Recipe import is not set up yet — no model key is configured.",
  no_household: "Join or create a household first.",
  disabled: "Recipe import is switched off for this household.",
  daily_limit: "You have used today's imports. Try again tomorrow.",
  monthly_cap: "This month's import budget is used up.",
  too_short: `Paste a bit more — at least ${MIN_PASTE_LENGTH} characters.`,
  too_long: `That is too long to read at once. Keep it under ${MAX_PASTE_LENGTH} characters.`,
  not_a_recipe: "That does not look like a recipe, so nothing was imported.",
  too_little_detail: "No ingredients found in that text.",
  invalid_output: "The reply came back malformed. Nothing was saved — try again.",
  provider_error: "Could not reach the model. Try again in a moment.",
};

/**
 * Paste unstructured recipe text and get a filled-in draft.
 *
 * Deliberately hands the result to the normal recipe editor rather than
 * saving it: what comes back is a draft for the cook to check, never a
 * database write made on a model's say-so.
 */
export function PasteRecipeDialog({
  open,
  onOpenChange,
  onParsed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onParsed: (recipe: Recipe) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await importRecipeText({ data: { text } });
      if (!result.ok) {
        const message = REFUSAL_MESSAGE[result.refusal];
        toast.error(
          result.refusal === "daily_limit" && result.limit
            ? `You have used today's ${result.limit} imports. Try again tomorrow.`
            : message,
        );
        return;
      }
      onParsed(toRecipeDraft(result.recipe));
      setText("");
      toast.success(
        result.remainingToday > 0
          ? `Recipe read — check it over. ${result.remainingToday} more today.`
          : "Recipe read — check it over. That was today's last import.",
      );
    } catch (error) {
      console.error("[ai] import failed:", error);
      toast.error("Could not read that recipe. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Paste a recipe</DialogTitle>
          <DialogDescription>
            Paste it however it is written — notes, a message, a half-finished list. Whatever can be
            read becomes a draft you check before saving.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paneer bhurji\n250g paneer, 2 tomatoes, 1 tsp jeera\nCrumble the paneer..."}
          className="min-h-56"
          maxLength={MAX_PASTE_LENGTH}
        />
        <p className="text-xs text-muted-foreground">
          {text.trim().length}/{MAX_PASTE_LENGTH} characters
        </p>

        <DialogFooter>
          <Button
            className="h-11 w-full rounded-full"
            onClick={run}
            disabled={busy || text.trim().length < MIN_PASTE_LENGTH}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {busy ? "Reading..." : "Turn into a recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
