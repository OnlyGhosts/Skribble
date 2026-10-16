/**
 * The pace of the table on screen: the client's plan (client/src/games/blackjack/lib/timeline.ts on
 * the platform's table timeline) follows these timings. dealAllowanceMs is how long a whole deal
 * takes to show and revealAllowanceMs how long the dealer's reveal takes; the server times the
 * results pause by them, so the next bets open the moment the outcomes show. Tests keep the client
 * in step and the whole deal under the client's animation backlog, however big the table.
 */

/** The client's animation timings, in ms. */
export const BLACKJACK_DEAL = {
  /** A card sliding in from the shoe. */
  deal: 250,
  /** The beat between two cards at a small table. */
  dealGap: 150,
  /** The last round's cards going to the discards first. */
  discard: 300,
  /** The half of a split sliding over within the seat. */
  move: 200,
} as const;

/** The dealer's reveal on screen, in ms. */
export const BLACKJACK_REVEAL = {
  /** The hole card turning over. */
  flip: 400,
  /** The beat after the flip before the dealer's first draw. */
  beat: 100,
  /** From one dealer draw to the next. */
  draw: 500,
  /** The beat between the dealer's last card and the outcomes. */
  outcome: 150,
  /** After a fresh deal, before a peeked dealer blackjack turns over. */
  peekPause: 300,
} as const;

/**
 * How long the dealer's reveal takes to show, from the moment the hole card starts to turn until
 * the outcomes are up: the flip, then each card the dealer draws after it, then the outcomes.
 */
export function revealAllowanceMs(dealerCards: number): number {
  const draws = Math.max(0, dealerCards - 2);
  if (draws === 0) return BLACKJACK_REVEAL.flip + BLACKJACK_REVEAL.outcome;
  return BLACKJACK_REVEAL.flip + BLACKJACK_REVEAL.beat + (draws - 1) * BLACKJACK_REVEAL.draw + BLACKJACK_DEAL.deal + BLACKJACK_REVEAL.outcome;
}

/**
 * A big table's deal speeds up so every card has started within this long, never closer than
 * MIN_DEAL_GAP_MS a card. With the slide and the discard the whole deal stays under the client's
 * animation backlog (3 s), so a snapshot mid-deal never snaps the table, even at 50 seats.
 */
export const BIG_DEAL_MS = 2000;
export const MIN_DEAL_GAP_MS = 16;

/** The beat between two cards when `cards` are dealt in one go: a dealer's pace, quicker at a big table. */
export function dealGapMs(cards: number): number {
  return Math.max(MIN_DEAL_GAP_MS, Math.min(BLACKJACK_DEAL.dealGap, Math.floor(BIG_DEAL_MS / Math.max(1, cards - 1))));
}

/** The cards a deal to `seats` seats puts out: two each and the dealer's two. */
export function dealtCards(seats: number): number {
  return 2 * seats + 2;
}

/** How long a deal to `seats` seats takes to show, from the snapshot: the discards, then every card until the last one lands. */
export function dealAllowanceMs(seats: number): number {
  const cards = dealtCards(seats);
  return BLACKJACK_DEAL.discard + (cards - 1) * dealGapMs(cards) + BLACKJACK_DEAL.deal;
}
