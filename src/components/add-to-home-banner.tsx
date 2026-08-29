import { Share, SquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Last day the tip appears. After this it never shows again, whatever is
 * stored on anyone's phone — the point is to teach a one-off trick, not to
 * become a permanent fixture.
 */
const CAMPAIGN_END = new Date("2026-09-12T23:59:59Z").getTime();

/** Seconds on screen before it closes itself. */
const VISIBLE_SECONDS = 10;

const DISMISSED_KEY = "bdp.a2hs.done";

/** The install prompt Chromium fires; absent on iOS, which has no such API. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Catches the install prompt as the bundle loads, not when the banner mounts.
 *
 * Chromium fires beforeinstallprompt once, early, and a listener attached in
 * an effect can easily be too late — the event is then gone for the life of
 * the page and the install button never appears. Listening at module scope
 * runs while scripts evaluate, well before React has rendered anything, and
 * holds the event for whenever the banner asks.
 */
let heldPrompt: InstallPromptEvent | null = null;
const promptWaiters = new Set<(event: InstallPromptEvent) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    heldPrompt = event as InstallPromptEvent;
    for (const notify of promptWaiters) notify(heldPrompt);
  });
}

/** Already opened from the Home Screen — there is nothing to add. */
function isInstalled() {
  if (typeof window === "undefined") return true;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, and is told apart by having a touchscreen.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * A short-lived tip showing how to keep the app on the Home Screen.
 *
 * Two different things behind one banner, because the platforms differ: on
 * Chromium there is a real install prompt to fire, while iOS gives the page no
 * way at all to add itself — the best any site can do there is point at the
 * Share button. Saying so plainly beats a button that appears to do it and
 * cannot.
 *
 * It sits above the content rather than blocking it, closes itself after ten
 * seconds, and stops for good once someone says they have done it.
 */
export function AddToHomeBanner() {
  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(VISIBLE_SECONDS);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(heldPrompt);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const close = useCallback((forGood: boolean) => {
    setVisible(false);
    if (timer.current) clearInterval(timer.current);
    if (!forGood) return;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // A phone that refuses storage just sees the tip again next time.
    }
  }, []);

  useEffect(() => {
    if (Date.now() > CAMPAIGN_END || isInstalled()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    setVisible(true);
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setVisible(false);
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // Picks up a prompt that arrives after the banner is already on screen; one
  // that arrived earlier is in heldPrompt and was read on first render.
  useEffect(() => {
    promptWaiters.add(setInstallPrompt);
    return () => {
      promptWaiters.delete(setInstallPrompt);
    };
  }, []);

  if (!visible) return null;

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    close(outcome === "accepted");
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
    >
      <div className="surface-card relative mx-auto max-w-lg p-4 shadow-lg">
        {/* Countdown and close sit together, clear of the buttons below. */}
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[11px] font-bold tabular-nums text-muted-foreground"
          >
            {seconds}
          </span>
          <button
            type="button"
            onClick={() => close(false)}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-start gap-3 pr-9">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary-container text-primary-container-foreground">
            <SquarePlus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold">Keep this on your Home Screen</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              It gets its own icon and opens like a real app — full screen, and signed in, so there
              is no logging in every time.
            </p>

            {isIos() ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                Tap
                <Share className="h-4 w-4 text-primary" aria-label="the Share button" />
                at the bottom of Safari, then{" "}
                <span className="text-primary">Add to Home Screen</span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {installPrompt ? (
            <Button className="h-10 flex-1 rounded-full" onClick={() => void install()}>
              Add to Home Screen
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="h-10 flex-1 rounded-full"
            onClick={() => close(true)}
          >
            Got it, done
          </Button>
        </div>
      </div>
    </div>
  );
}
