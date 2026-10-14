/**
 * Blackjack's table rules, pure and shared by both sides: the shoe, hand totals with soft aces,
 * naturals, the dealer's drawing policy and the payouts. Randomness is passed in, never read.
 */
import { CARD_RANKS, CARD_SUITS, type BlackjackPayout, type Card, type CardRank, type HandOutcome } from './protocol.js';

export const BLACKJACK = 21;
export const DEALER_STANDS_AT = 17;
/** The shoe is rebuilt once fewer cards than this share of it remain. */
export const RESHUFFLE_BELOW = 0.25;

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

/** The dealer draws under 17, and on a soft 17 only when the table says so. */
export function dealerShouldHit(cards: readonly Card[], hitsSoft17: boolean): boolean {
  const { total, soft } = handTotal(cards);
  if (total < DEALER_STANDS_AT) return true;
  return total === DEALER_STANDS_AT && soft && hitsSoft17;
}

export function freshShoe(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (const suit of CARD_SUITS) for (const rank of CARD_RANKS) cards.push({ rank, suit });
  return cards;
}

/** Fisher-Yates over a copy, drawing every index from `rng` (uniform in [0, 1)). */
export function shuffle(cards: readonly Card[], rng: () => number): Card[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shoe with fewer cards than the reshuffle share of a fresh one is due for a reshuffle. */
export function needsReshuffle(remaining: number, decks: number): boolean {
  return remaining < Math.ceil(decks * 52 * RESHUFFLE_BELOW);
}

/** The whole-chip winnings on a natural: 3:2 or 6:5 of the stake, rounded down. */
export function naturalWinnings(bet: number, payout: BlackjackPayout): number {
  return payout === '3:2' ? Math.floor((bet * 3) / 2) : Math.floor((bet * 6) / 5);
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
export function settleHand(cards: readonly Card[], bet: number, fromSplit: boolean, dealer: readonly Card[], payout: BlackjackPayout): Settlement {
  const player = handTotal(cards).total;
  if (player > BLACKJACK) return { outcome: 'loss', payout: 0 };
  const dealerNatural = isNatural(dealer);
  if (isNatural(cards, fromSplit)) return dealerNatural ? { outcome: 'push', payout: bet } : { outcome: 'blackjack', payout: bet + naturalWinnings(bet, payout) };
  if (dealerNatural) return { outcome: 'loss', payout: 0 };
  const house = handTotal(dealer).total;
  if (house > BLACKJACK || player > house) return { outcome: 'win', payout: bet * 2 };
  if (player === house) return { outcome: 'push', payout: bet };
  return { outcome: 'loss', payout: 0 };
}
