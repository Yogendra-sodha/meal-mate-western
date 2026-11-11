/** The notes actually handled, largest first — the order they get counted in. */
export const DENOMINATIONS = [100, 50, 20, 10, 5, 1] as const;

export type NoteCounts = Partial<Record<string, number>>;

/** yyyy-mm-dd in local time, matching how the rest of the app writes dates. */
function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * The collection week for a month: its last Sunday through the Saturday after.
 *
 * Deliberately allowed to run past the month's end — September's window is
 * 27 Sep to 3 Oct — because that is how the week falls and how the rent is
 * actually collected. It is also why a cycle is keyed by the month it is for
 * rather than by a date: December's window ends inside January.
 */
export function defaultRentWindow(period: string): { start: string; end: string } {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const lastDay = new Date(year, month, 0);
  const start = new Date(lastDay);
  start.setDate(lastDay.getDate() - lastDay.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: iso(start), end: iso(end) };
}

/** First of the month, the key a cycle is stored under. */
export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function monthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function windowLabel(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  return `${from.toLocaleDateString(undefined, opts)} – ${to.toLocaleDateString(undefined, opts)}`;
}

/** Inclusive of both ends: the last day of the window is still a collection day. */
export function isWithinWindow(today: string, start: string, end: string): boolean {
  return today >= start && today <= end;
}

/** What a pile of notes comes to, in cents. */
export function countedCents(notes: NoteCounts): number {
  return DENOMINATIONS.reduce(
    (total, note) => total + Math.max(notes[String(note)] ?? 0, 0) * note * 100,
    0,
  );
}

export const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

/**
 * Adds up several piles of notes into one, less any that went back out.
 *
 * What the collector ends up holding is not a total in dollars but a stack of
 * each kind, and that is what gets checked against the cash box or handed to a
 * bank. Every denomination is returned, zeroes included, so the tally reads in
 * the same order every month rather than changing shape with what came in.
 *
 * `takenOut` is change handed back from the pile. Leaving it in was what made
 * the tally claim notes that had already gone back across the table. A count
 * can come out below zero only if more change was recorded as coming from the
 * pile than ever went into it — which means some of it really came from a
 * wallet — so it is reported as it is rather than hidden.
 */
export function tallyNotes(
  piles: NoteCounts[],
  takenOut: NoteCounts[] = [],
): { note: number; count: number; cents: number }[] {
  return DENOMINATIONS.map((note) => {
    const sum = (list: NoteCounts[]) =>
      list.reduce((n, pile) => n + Math.max(pile[String(note)] ?? 0, 0), 0);
    const count = sum(piles) - sum(takenOut);
    return { note, count, cents: count * note * 100 };
  });
}

/** Today in the browser's own calendar, yyyy-mm-dd. */
export function localToday(): string {
  return iso(new Date());
}

/** The browser's time zone, stored with a month so the database closes it at the right midnight. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export type OpenMode = "auto" | "open" | "closed";

/**
 * Whether a month's collection is open, and how to say why.
 *
 * Mirrors rent_window_open in the database, which is what actually enforces
 * it; this copy is only for saying so on screen.
 */
export function windowState(
  mode: OpenMode,
  start: string,
  end: string,
  today: string = localToday(),
): { open: boolean; headline: string; detail: string } {
  const day = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (mode === "open") {
    return {
      open: true,
      headline: "Open — held open by you",
      detail: "Ignoring the dates until you set it back to follow them.",
    };
  }
  if (mode === "closed") {
    return {
      open: false,
      headline: "Closed — held shut by you",
      detail: "Ignoring the dates until you set it back to follow them.",
    };
  }
  if (today < start) {
    return {
      open: false,
      headline: `Opens by itself on ${day(start)}`,
      detail: `And closes by itself after ${day(end)}.`,
    };
  }
  if (today > end) {
    return {
      open: false,
      headline: `Closed — the window ended ${day(end)}`,
      detail: "Choose Open now to let a late payer enter their notes.",
    };
  }
  return {
    open: true,
    headline: "Collection is open",
    detail: `Closes by itself after ${day(end)}.`,
  };
}

/**
 * Whether a handover settles what is owed.
 *
 * Handed over, less change given back, has to come to exactly what is owed —
 * by the payer and anyone they are covering. Short and over are both reasons
 * not to accept: over is either change that has not been recorded or a
 * miscount, and in neither case is it rent.
 */
export function settle({
  handedCents,
  changeCents,
  owedCents,
}: {
  handedCents: number;
  changeCents: number;
  owedCents: number;
}): {
  netCents: number;
  status: "exact" | "short" | "over" | "change_too_big";
  /** how much change is still to be handed back, when over */
  changeStillOwedCents: number;
  shortCents: number;
} {
  const netCents = handedCents - changeCents;
  if (changeCents > handedCents) {
    return { netCents, status: "change_too_big", changeStillOwedCents: 0, shortCents: 0 };
  }
  if (netCents < owedCents) {
    return { netCents, status: "short", changeStillOwedCents: 0, shortCents: owedCents - netCents };
  }
  if (netCents > owedCents) {
    return { netCents, status: "over", changeStillOwedCents: netCents - owedCents, shortCents: 0 };
  }
  return { netCents, status: "exact", changeStillOwedCents: 0, shortCents: 0 };
}
