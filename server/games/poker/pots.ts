/** Side pots from what every seat committed, and the split of a pot among its winners. */

export interface PotEntry {
  id: string;
  /** Chips put in the middle this hand. */
  committed: number;
  /** Still holding cards (folded players feed the pots but never win one). */
  contender: boolean;
}

export interface Pot {
  amount: number;
  /** The contenders who matched this pot's level, in seat order. */
  eligible: string[];
}

/**
 * One pot per distinct amount a contender committed, lowest first: everybody contributes up to
 * that level, and only the contenders who reached it can win it. Chips a folded player put in
 * above every contender's level (none after uncalled bets are refunded) fall into the last pot.
 */
export function buildPots(entries: readonly PotEntry[]): Pot[] {
  const levels = [...new Set(entries.filter((e) => e.contender && e.committed > 0).map((e) => e.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = entries.reduce((sum, e) => sum + Math.min(e.committed, level) - Math.min(e.committed, previous), 0);
    pots.push({ amount, eligible: entries.filter((e) => e.contender && e.committed >= level).map((e) => e.id) });
    previous = level;
  }
  const total = entries.reduce((sum, e) => sum + e.committed, 0);
  const allocated = pots.reduce((sum, p) => sum + p.amount, 0);
  if (total > allocated && pots.length > 0) pots[pots.length - 1].amount += total - allocated;
  return pots;
}

/** Splits `amount` evenly among `winners` (already in payout order); the odd chips go one each to the first of them. */
export function splitPot(amount: number, winners: readonly string[]): Array<{ playerId: string; amount: number }> {
  const share = Math.floor(amount / winners.length);
  const odd = amount - share * winners.length;
  return winners.map((playerId, i) => ({ playerId, amount: share + (i < odd ? 1 : 0) }));
}
