import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** How far a finger may drift and still count as a tap rather than a scroll. */
const DRIFT_LIMIT_PX = 10;

/** A press held longer than this is something else — a long press, or a pause. */
const TAP_LIMIT_MS = 700;

/**
 * Opens something on a deliberate tap, and never on a scroll.
 *
 * A plain link inside a scrolling list is a trap on a phone: the finger lands
 * on a dish name, drags the page, and the browser still counts it as a click
 * on release. This watches where the finger went instead — a press that moved
 * more than a few pixels, or lingered, was not someone choosing a recipe.
 *
 * Deciding from the pointer rather than from `click` is what makes that
 * possible: by the time a click arrives the movement is already forgotten.
 */
export function TapToOpen({
  onTap,
  className,
  label,
  children,
}: {
  onTap: () => void;
  className?: string;
  /** what a screen reader announces, e.g. "Open Khichdi" */
  label: string;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      // select-none and touch-manipulation matter more than they look: dragging
      // across text otherwise starts a selection, the browser cancels the
      // pointer, and a small thumb drift that should have counted as a tap is
      // thrown away — the name feels dead.
      className={cn(
        "cursor-pointer select-none touch-manipulation underline-offset-4 hover:underline",
        className,
      )}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY, at: Date.now() };
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const drift = Math.hypot(e.clientX - from.x, e.clientY - from.y);
        if (drift <= DRIFT_LIMIT_PX && Date.now() - from.at <= TAP_LIMIT_MS) onTap();
      }}
      // A cancelled pointer is the browser taking the gesture over for a
      // scroll, which settles it: that was not a tap.
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
    >
      {children}
    </span>
  );
}
