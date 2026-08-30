import { NotebookPen, Sparkles, Youtube } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { importRecipe, type ImportRefusal } from "@/lib/ai/import.functions";
import {
  MAX_PASTE_LENGTH,
  MIN_PASTE_LENGTH,
  PLATE_OPTIONS,
  toRecipeDraft,
} from "@/lib/ai/recipe-schema";
import type { Recipe } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Plain wording for every way an import can decline. */
const REFUSAL_MESSAGE: Record<ImportRefusal, string> = {
  not_configured: "Recipe import is not set up yet — no model key is configured.",
  video_not_configured: "Reading videos is not set up yet — no Gemini key is configured.",
  no_household: "Join or create a household first.",
  disabled: "Recipe import is switched off for this household.",
  daily_limit: "You have used today's imports. Try again tomorrow.",
  monthly_cap: "This month's import budget is used up.",
  too_short: `Paste a bit more — at least ${MIN_PASTE_LENGTH} characters.`,
  too_long: `That is too long to read at once. Keep it under ${MAX_PASTE_LENGTH} characters.`,
  bad_url: "That is not a YouTube link. Paste one that looks like youtube.com/watch?v=…",
  not_a_recipe: "That does not look like a recipe, so nothing was imported.",
  too_little_detail: "No ingredients found there.",
  invalid_output: "The reply came back malformed. Nothing was saved — try again.",
  provider_error: "Could not reach the model. Try again in a moment.",
};

type Mode = "youtube" | "notes";

/**
 * The two ways to fill this form without typing it out.
 *
 * Both land in the same place — the fields below, for the cook to check — so
 * an imported recipe is saved by exactly the path a typed one is. Neither
 * writes to the database on the model's say-so.
 *
 * The plate count is shared because it means the same thing either way: how
 * many this batch is being cooked for. The quantities are scaled to it on the
 * server, in arithmetic rather than by the model.
 */
export function RecipeImportPanel({
  plates,
  onPlatesChange,
  onImported,
}: {
  plates: number;
  onPlatesChange: (plates: number) => void;
  onImported: (recipe: Recipe) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      const result = await importRecipe({
        data: { source: mode === "youtube" ? "video" : "text", text: notes, url, plates },
      });
      if (!result.ok) {
        toast.error(
          result.refusal === "daily_limit" && result.limit
            ? `You have used today's ${result.limit} imports. Try again tomorrow.`
            : REFUSAL_MESSAGE[result.refusal],
        );
        return;
      }
      onImported(toRecipeDraft(result.recipe));
      setUrl("");
      setNotes("");
      setMode(null);
      // Says plainly when nothing was scaled, so unscaled amounts are never
      // mistaken for amounts worked out for this many plates.
      toast.success(
        result.scaled
          ? `Filled in and scaled to ${result.plates} plates — check it over.`
          : `Filled in — the source never said how many it makes, so the amounts are as written. Check them.`,
      );
    } catch (error) {
      console.error("[ai] import failed:", error);
      toast.error("Could not read that. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const ready =
    mode === "youtube" ? url.trim().length > 0 : notes.trim().length >= MIN_PASTE_LENGTH;

  return (
    <section className="rounded-2xl bg-surface-2 p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="ri-plates">Cooking for how many plates?</Label>
        <Select value={String(plates)} onValueChange={(v) => onPlatesChange(Number(v))}>
          <SelectTrigger id="ri-plates" className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} plates
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ModeButton
          active={mode === "youtube"}
          onClick={() => setMode(mode === "youtube" ? null : "youtube")}
        >
          <Youtube className="h-4 w-4" /> From YouTube
        </ModeButton>
        <ModeButton
          active={mode === "notes"}
          onClick={() => setMode(mode === "notes" ? null : "notes")}
        >
          <NotebookPen className="h-4 w-4" /> From notes
        </ModeButton>
      </div>

      {mode === "youtube" ? (
        <div className="mt-3 grid gap-1.5">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            className="bg-background"
            aria-label="YouTube recipe link"
          />
          <p className="text-xs text-muted-foreground">
            Reads the video itself, so it works even when the description is empty.
          </p>
        </div>
      ) : null}

      {mode === "notes" ? (
        <div className="mt-3 grid gap-1.5">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={"Paneer bhurji\n250g paneer, 2 tomatoes, 1 tsp jeera\nCrumble the paneer…"}
            className="min-h-40 bg-background"
            maxLength={MAX_PASTE_LENGTH}
            aria-label="Recipe notes"
          />
          <p className="text-xs text-muted-foreground">
            {notes.trim().length}/{MAX_PASTE_LENGTH} characters
          </p>
        </div>
      ) : null}

      {mode ? (
        <Button className="mt-3 h-11 w-full rounded-full" onClick={run} disabled={busy || !ready}>
          <Sparkles className="mr-1 h-4 w-4" />
          {busy ? (mode === "youtube" ? "Watching the video…" : "Reading…") : "Fill in the recipe"}
        </Button>
      ) : null}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-bold",
        active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
