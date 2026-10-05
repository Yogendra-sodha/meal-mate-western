/**
 * Splitting a bill into shares that add up.
 *
 * Splitwise checks the arithmetic: every share is a string with two decimals,
 * and both the paid shares and the owed shares have to sum to exactly the cost.
 * A bill of 68.29 across three people is 22.763333… each, and three of those
 * rounded is 68.28 — a penny short, and the whole expense is refused.
 *
 * So the division is done in whole cents and the remainder is handed out, one
 * cent each, to the first few people. Nobody is out more than a penny, and the
 * total is exact by construction rather than by luck.
 */

export interface Share {
  /** the Splitwise user this share belongs to */
  userId: number;
  /** what they put in, in cents — only the payer puts anything in */
  paidCents: number;
  /** what they owe, in cents */
  owedCents: number;
}

/** Turns a decimal amount into whole cents, away from floating-point drift. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Cents back to the two-decimal string Splitwise expects. */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Splits `totalCents` between the given people, with `payerId` having paid.
 *
 * The payer is included among those who owe when they are in `participantIds`,
 * which is the normal case — whoever pays for the groceries eats them too.
 *
 * Returns null when there is nobody to split between or nothing to split, so
 * the caller never sends Splitwise an expense that cannot mean anything.
 */
export function splitEvenly(
  totalCents: number,
  payerId: number,
  participantIds: number[],
): Share[] | null {
  const people = [...new Set(participantIds)];
  if (!people.length || totalCents <= 0) return null;

  const base = Math.floor(totalCents / people.length);
  // What is left after an even division: strictly fewer cents than there are
  // people, so handing out one each covers it exactly.
  const remainder = totalCents - base * people.length;

  return people.map((userId, index) => ({
    userId,
    paidCents: userId === payerId ? totalCents : 0,
    owedCents: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * The flattened form Splitwise's create_expense wants.
 *
 * Its parameters are not nested JSON but names with the index built in —
 * users__0__user_id, users__0__paid_share — so the shares are spread into a
 * flat map here rather than at the call site.
 */
export function sharesToParams(shares: Share[]): Record<string, string> {
  const params: Record<string, string> = {};
  shares.forEach((share, index) => {
    params[`users__${index}__user_id`] = String(share.userId);
    params[`users__${index}__paid_share`] = centsToAmount(share.paidCents);
    params[`users__${index}__owed_share`] = centsToAmount(share.owedCents);
  });
  return params;
}

/** True when the shares add up to the cost on both sides, as Splitwise requires. */
export function sharesBalance(shares: Share[], totalCents: number): boolean {
  const paid = shares.reduce((n, s) => n + s.paidCents, 0);
  const owed = shares.reduce((n, s) => n + s.owedCents, 0);
  return paid === totalCents && owed === totalCents;
}
