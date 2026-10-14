import { describe, expect, it } from 'vitest';
import { dealerShouldHit, freshShoe, handTotal, isBust, isNatural, isPair, naturalWinnings, needsReshuffle, settleHand, shuffle } from './cards.js';
import type { Card, CardRank } from './protocol.js';

/** 'AS', '10H', 'KD' -> a card. */
const card = (text: string): Card => {
  const rank = text.slice(0, -1) as CardRank;
  const suit = text.slice(-1) as Card['suit'];
  return { rank, suit };
};
const cards = (...texts: string[]): Card[] => texts.map(card);

describe('hand totals', () => {
  it('counts pips, faces as ten and an ace as eleven while that keeps the hand at 21 or under', () => {
    expect(handTotal(cards('2S', '3H'))).toEqual({ total: 5, soft: false });
    expect(handTotal(cards('KS', 'QH'))).toEqual({ total: 20, soft: false });
    expect(handTotal(cards('AS', '6H'))).toEqual({ total: 17, soft: true });
    expect(handTotal(cards('AS', '6H', '9D'))).toEqual({ total: 16, soft: false });
    expect(handTotal(cards('AS', 'AH'))).toEqual({ total: 12, soft: true });
    expect(handTotal(cards('AS', 'AH', '9D'))).toEqual({ total: 21, soft: true });
    expect(handTotal(cards('AS', 'AH', 'AD', 'AC', '10S'))).toEqual({ total: 14, soft: false });
    expect(handTotal([])).toEqual({ total: 0, soft: false });
  });

  it('knows a bust, a natural and a pair (any two ten-value cards)', () => {
    expect(isBust(cards('KS', 'QH', '2D'))).toBe(true);
    expect(isBust(cards('AS', 'KH', 'QD'))).toBe(false);
    expect(isNatural(cards('AS', 'KH'))).toBe(true);
    expect(isNatural(cards('AS', 'KH'), true)).toBe(false);
    expect(isNatural(cards('AS', '5H', '5D'))).toBe(false);
    expect(isPair(cards('8S', '8H'))).toBe(true);
    expect(isPair(cards('10S', 'KH'))).toBe(true);
    expect(isPair(cards('AS', 'AH'))).toBe(true);
    expect(isPair(cards('9S', '8H'))).toBe(false);
    expect(isPair(cards('8S', '8H', '8D'))).toBe(false);
  });
});

describe('the dealer', () => {
  it('draws under 17 and stands on hard 17 and above', () => {
    expect(dealerShouldHit(cards('10S', '6H'), false)).toBe(true);
    expect(dealerShouldHit(cards('10S', '7H'), false)).toBe(false);
    expect(dealerShouldHit(cards('10S', '7H'), true)).toBe(false);
    expect(dealerShouldHit(cards('AS', '7H'), false)).toBe(false);
    expect(dealerShouldHit(cards('AS', '8H'), true)).toBe(false);
  });

  it('draws on a soft 17 only when the table says so', () => {
    expect(dealerShouldHit(cards('AS', '6H'), false)).toBe(false);
    expect(dealerShouldHit(cards('AS', '6H'), true)).toBe(true);
    expect(dealerShouldHit(cards('AS', '3H', '3D'), true)).toBe(true);
    // A soft 17 that has become a hard 17 stands either way.
    expect(dealerShouldHit(cards('AS', '6H', '10D'), true)).toBe(false);
  });
});

describe('the shoe', () => {
  it('holds 52 cards per deck, shuffles into a permutation and is deterministic for a given rng', () => {
    expect(freshShoe(1)).toHaveLength(52);
    expect(freshShoe(6)).toHaveLength(312);
    expect(new Set(freshShoe(1).map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
    const deck = freshShoe(2);
    let seed = 7;
    const rng = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const a = shuffle(deck, rng);
    seed = 7;
    const b = shuffle(deck, rng);
    expect(a).toEqual(b);
    expect(a).not.toEqual(deck);
    expect(a).toHaveLength(104);
    expect([...a].sort((x, y) => `${x.rank}${x.suit}`.localeCompare(`${y.rank}${y.suit}`))).toEqual([...deck].sort((x, y) => `${x.rank}${x.suit}`.localeCompare(`${y.rank}${y.suit}`)));
    // The input is never touched.
    expect(deck).toEqual(freshShoe(2));
    expect(shuffle(deck, () => 0.999)).toHaveLength(104);
  });

  it('is due for a reshuffle once under a quarter of it remains', () => {
    expect(needsReshuffle(13, 1)).toBe(false);
    expect(needsReshuffle(12, 1)).toBe(true);
    expect(needsReshuffle(78, 6)).toBe(false);
    expect(needsReshuffle(77, 6)).toBe(true);
    expect(needsReshuffle(0, 8)).toBe(true);
  });
});

describe('payouts', () => {
  it('pays a natural 3:2 or 6:5 in whole chips, rounded down', () => {
    expect(naturalWinnings(10, '3:2')).toBe(15);
    expect(naturalWinnings(15, '3:2')).toBe(22);
    expect(naturalWinnings(1, '3:2')).toBe(1);
    expect(naturalWinnings(10, '6:5')).toBe(12);
    expect(naturalWinnings(5, '6:5')).toBe(6);
    expect(naturalWinnings(7, '6:5')).toBe(8);
  });

  it('settles every hand against the dealer', () => {
    const dealer20 = cards('KS', 'QH');
    const dealerBust = cards('KS', '6H', '9D');
    const dealerNatural = cards('AS', 'KH');
    // A bust loses whatever the dealer holds.
    expect(settleHand(cards('KS', '9H', '5D'), 10, false, dealerBust, '3:2')).toEqual({ outcome: 'loss', payout: 0 });
    // Higher wins 1:1, lower loses, equal pushes.
    expect(settleHand(cards('KS', 'AH', '10D'), 10, false, dealer20, '3:2')).toEqual({ outcome: 'win', payout: 20 });
    expect(settleHand(cards('KS', '9H'), 10, false, dealer20, '3:2')).toEqual({ outcome: 'loss', payout: 0 });
    expect(settleHand(cards('KS', 'JH'), 10, false, dealer20, '3:2')).toEqual({ outcome: 'push', payout: 10 });
    // A dealer bust pays every standing hand.
    expect(settleHand(cards('2S', '3H'), 10, false, dealerBust, '3:2')).toEqual({ outcome: 'win', payout: 20 });
    // A natural pays extra, unless the dealer has one too.
    expect(settleHand(cards('AS', 'KH'), 10, false, dealer20, '3:2')).toEqual({ outcome: 'blackjack', payout: 25 });
    expect(settleHand(cards('AS', 'KH'), 10, false, dealer20, '6:5')).toEqual({ outcome: 'blackjack', payout: 22 });
    expect(settleHand(cards('AS', 'KH'), 10, false, dealerNatural, '3:2')).toEqual({ outcome: 'push', payout: 10 });
    // A dealer natural beats a 21 made of three cards and a 21 after a split.
    expect(settleHand(cards('7S', '7H', '7D'), 10, false, dealerNatural, '3:2')).toEqual({ outcome: 'loss', payout: 0 });
    expect(settleHand(cards('AS', 'KH'), 10, true, dealerNatural, '3:2')).toEqual({ outcome: 'loss', payout: 0 });
    // 21 after a split is an ordinary 21: it pays 1:1 and pushes a dealer 21.
    expect(settleHand(cards('AS', 'KH'), 10, true, dealer20, '3:2')).toEqual({ outcome: 'win', payout: 20 });
    expect(settleHand(cards('AS', 'KH'), 10, true, cards('7S', '7H', '7D'), '3:2')).toEqual({ outcome: 'push', payout: 10 });
  });
});
