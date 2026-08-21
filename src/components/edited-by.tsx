import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Faded "last touched by" byline. Only the most recent editor is ever shown —
 * no prior editors are stored, so there is no history to page through.
 */
export function EditedBy({
  userId,
  verb = "edited",
  className,
}: {
  userId?: string | undefined;
  verb?: string;
  className?: string;
}) {
  const { state } = useStore();
  if (!userId) return null;
  const person = state.people.find((p) => p.id === userId);
  if (!person) return null;
  return (
    <span className={cn("text-xs text-muted-foreground/60", className)}>
      {verb} by {person.name}
    </span>
  );
}
