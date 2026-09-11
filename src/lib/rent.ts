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
 * Adds up several piles of notes into one.
 *
 * What the collector ends up holding is not a total in dollars but a stack of
 * each kind, and that is what gets checked against the cash box or handed to a
 * bank. Every denomination is returned, zeroes included, so the tally reads in
 * the same order every month rather than changing shape with what came in.
 */
export function tallyNotes(piles: NoteCounts[]): { note: number; count: number; cents: number }[] {
  return DENOMINATIONS.map((note) => {
    const count = piles.reduce((n, pile) => n + Math.max(pile[String(note)] ?? 0, 0), 0);
    return { note, count, cents: count * note * 100 };
  });
}
