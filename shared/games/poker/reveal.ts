/**
 * How long the client takes to show the end of a hand, so the results pause starts once it is on
 * the table: the server adds this to the results deadline. It mirrors the client's animation plan
 * (client/src/games/poker/lib/timeline.ts) as an upper bound, and a client test keeps the two in step.
 */

/** The client's animation timings, in ms. */
export const POKER_ANIMATION = {
  deal: 250,
  dealGap: 150,
  flip: 400,
  chip: 300,
  discard: 300,
  sweepGap: 150,
  streetGap: 300,
  showdownGap: 250,
  pay: 500,
} as const;

/** What the snapshot that settles the hand shows that the previous one did not. */
export interface SettleShown {
  /** The hand was dealt in the same snapshot (everyone all in from the blinds): its hole cards come first. */
  holeCards: number;
  /** Board cards before and after the snapshot. */
  boardFrom: number;
  boardTo: number;
  /** A showdown turns the hands over; an uncontested pot does not. */
  contested: boolean;
}

const STREETS: readonly (readonly number[])[] = [[0, 1, 2], [3], [4]];

export function settleRevealMs({ holeCards, boardFrom, boardTo, contested }: SettleShown): number {
  const t = POKER_ANIMATION;
  let ms = 0;
  if (holeCards > 0) ms += t.discard + (holeCards - 1) * t.dealGap + t.deal;
  // The last bets slide out, then everything is swept into the pot.
  ms += t.chip + t.sweepGap + t.chip;
  let first = true;
  for (const street of STREETS) {
    const cards = street.filter((i) => i >= boardFrom && i < boardTo).length;
    if (cards === 0) continue;
    ms += (first ? t.sweepGap : t.streetGap) + (cards - 1) * t.dealGap + t.deal + t.flip;
    first = false;
  }
  if (contested) ms += t.showdownGap + t.flip;
  return ms + t.showdownGap + t.pay;
}
