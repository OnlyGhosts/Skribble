/**
 * Blackjack's table rules, pure and shared by both sides: the endless deck, hand totals with soft
 * aces, naturals, the dealer's drawing policy and the payouts. Randomness is passed in, never read.
 * The house rules are fixed, with no settings: the dealer stands on every 17, soft ones too; a
 * natural pays 3 to 2; doubling and splitting are always allowed (BLACKJACK_RULES in protocol.ts).
 */
import { freshDeck } from '../../platform/cards.js';
import type { Card, CardRank, HandOutcome } from './protocol.js';

export const BLACKJACK = 21;
export const DEALER_STANDS_AT = 17;

export interface HandTotal {
  /** The best total: aces count 11 while that keeps the hand at 21 or under. */
  total: number;
  /** An ace counts as 11 in `total`. */
  soft: boolean;
}

/** Pip value of a rank with aces as 1; the soft 11 is handTotal's business. */
export function cardValue(rank: CardRank): number {
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export function handTotal(cards: readonly Card[]): HandTotal {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') aces += 1;
  }
  if (aces > 0 && total + 10 <= BLACKJACK) return { total: total + 10, soft: true };
  return { total, soft: false };
}

export function isBust(cards: readonly Card[]): boolean {
  return handTotal(cards).total > BLACKJACK;
}

/** A natural: 21 from the first two cards. A hand made by a split never is one. */
export function isNatural(cards: readonly Card[], fromSplit = false): boolean {
  return !fromSplit && cards.length === 2 && handTotal(cards).total === BLACKJACK;
}

/** Two cards of the same value: a pair of ranks, or any two ten-value cards. */
export function isPair(cards: readonly Card[]): boolean {
  return cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);
}

export function isTenValue(rank: CardRank): boolean {
  return cardValue(rank) === 10;
}

/** With an ace or a ten-value card up, the dealer checks the hole card for blackjack right after the deal. */
export function dealerPeeks(upCard: Card): boolean {
  return upCard.rank === 'A' || isTenValue(upCard.rank);
}

/** The dealer draws under 17 and stands on every 17, a soft one included. */
export function dealerShouldHit(cards: readonly Card[]): boolean {
  return handTotal(cards).total < DEALER_STANDS_AT;
}

/** The 52 cards every draw picks from. */
export const DECK: readonly Card[] = freshDeck(1);

/**
 * The endless deck (an infinite shoe): every card is drawn on its own, uniformly from the 52, by
 * one call to `rng` (uniform in [0, 1)). It never runs out, so it never needs a reshuffle.
 */
export function drawCard(rng: () => number): Card {
  const card = DECK[Math.min(DECK.length - 1, Math.floor(rng() * DECK.length))];
  return { ...card };
}

/** The whole-chip winnings on a natural: 3 to 2 of the stake, rounded down. */
export function naturalWinnings(bet: number): number {
  return Math.floor((bet * 3) / 2);
}

export interface Settlement {
  outcome: HandOutcome;
  /** Chips returned to the player: 0 on a loss, the stake on a push, the stake plus the winnings otherwise. */
  payout: number;
}

/**
 * Settles one player hand against the dealer's final cards. A bust loses whatever the dealer
 * holds; a natural beats everything but a dealer natural (a push); a dealer natural beats every
 * other hand; a dealer bust pays every standing hand; otherwise the higher total wins.
 */
export function settleHand(cards: readonly Card[], bet: number, fromSplit: boolean, dealer: readonly Card[]): Settlement {
  const player = handTotal(cards).total;
  if (player > BLACKJACK) return { outcome: 'loss', payout: 0 };
  const dealerNatural = isNatural(dealer);
  if (isNatural(cards, fromSplit)) return dealerNatural ? { outcome: 'push', payout: bet } : { outcome: 'blackjack', payout: bet + naturalWinnings(bet) };
  if (dealerNatural) return { outcome: 'loss', payout: 0 };
  const house = handTotal(dealer).total;
  if (house > BLACKJACK || player > house) return { outcome: 'win', payout: bet * 2 };
  if (player === house) return { outcome: 'push', payout: bet };
  return { outcome: 'loss', payout: 0 };
}
