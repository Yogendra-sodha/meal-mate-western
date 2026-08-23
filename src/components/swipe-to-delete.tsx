import { Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

/** Drag further than this and releasing deletes. */
const COMMIT_PX = 88;
/** Hard stop for the drag, so the row never slides fully off. */
const MAX_PX = 128;
/** Movement below this is too small to tell a swipe from a scroll. */
const AXIS_LOCK_PX = 10;

/**
 * Swipe a row leftwards to delete it on touch devices.
 *
 * `touch-action: pan-y` hands vertical panning back to the browser, so the
 * list still scrolls normally and only horizontal movement is captured — React
 * attaches touchmove passively, so preventDefault is not available to us here.
 * The gesture is an addition, never the only way out: callers keep a visible
 * delete control for pointer and keyboard users.
 */
export function SwipeToDelete({
  onDelete,
  children,
  className,
}: {
  onDelete: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");

  const reset = () => {
    start.current = null;
    axis.current = "undecided";
    setDragging(false);
    setDx(0);
  };

  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      {/* Revealed as the row slides; hidden from assistive tech since the row
          already exposes a real delete button. */}
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex items-center gap-2 bg-destructive pr-5 text-destructive-foreground"
        style={{ width: MAX_PX + 24, opacity: dx < -8 ? 1 : 0 }}
      >
        <Trash2 className="ml-auto h-5 w-5" />
        <span className="text-xs font-bold uppercase tracking-wide">
          {dx <= -COMMIT_PX ? "Release" : "Delete"}
        </span>
      </div>

      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
          touchAction: "pan-y",
          position: "relative",
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          start.current = { x: t.clientX, y: t.clientY };
          axis.current = "undecided";
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!t || !start.current) return;
          const moveX = t.clientX - start.current.x;
          const moveY = t.clientY - start.current.y;

          if (axis.current === "undecided") {
            if (Math.abs(moveX) < AXIS_LOCK_PX && Math.abs(moveY) < AXIS_LOCK_PX) return;
            // Once the gesture reads as a scroll it stays a scroll, so a
            // slightly diagonal flick never yanks the row sideways.
            axis.current = Math.abs(moveX) > Math.abs(moveY) ? "horizontal" : "vertical";
            if (axis.current === "horizontal") setDragging(true);
          }
          if (axis.current !== "horizontal") return;

          // Leftward only; rightward would imply an action that does not exist.
          setDx(Math.max(-MAX_PX, Math.min(0, moveX)));
        }}
        onTouchEnd={() => {
          if (axis.current === "horizontal" && dx <= -COMMIT_PX) {
            setDragging(false);
            setDx(-MAX_PX);
            onDelete();
            return;
          }
          reset();
        }}
        onTouchCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}
