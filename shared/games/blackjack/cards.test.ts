import { describe, expect, it } from 'vitest';
import { DECK, REVEAL_CARD_MS, REVEAL_HOLE_MS, dealerPeeks, dealerShouldHit, drawCard, handTotal, isBust, isNatural, isPair, isTenValue, naturalWinnings, revealAllowanceMs, settleHand } from './cards.js';
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

/** A seeded rng (mulberry32): the same seed always gives the same draws. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the endless deck', () => {
  it('draws from the 52 cards with one rng call a card, the whole range of the rng covering the deck in order', () => {
    expect(DECK).toHaveLength(52);
    expect(new Set(DECK.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
    expect(drawCard(() => 0)).toEqual(card('AS'));
    expect(drawCard(() => 0.999999)).toEqual(card('KC'));
    DECK.forEach((c, i) => expect(drawCard(() => (i + 0.5) / 52)).toEqual(c));
    let calls = 0;
    drawCard(() => {
      calls += 1;
      return 0.5;
    });
    expect(calls).toBe(1);
    // A drawn card is its own object: changing it never changes the deck.
    const drawn = drawCard(() => 0);
    drawn.rank = 'K';
    expect(DECK[0]).toEqual(card('AS'));
  });

  it('is deterministic for a given rng and never runs out', () => {
    const a = Array.from({ length: 2000 }, ((rng) => () => drawCard(rng))(seeded(7)));
    const b = Array.from({ length: 2000 }, ((rng) => () => drawCard(rng))(seeded(7)));
    expect(a).toEqual(b);
    expect(a.every((c) => DECK.some((d) => d.rank === c.rank && d.suit === c.suit))).toBe(true);
  });

  it('draws every card about as often as any other (a chi-squared check over 104,000 seeded draws)', () => {
    const rng = seeded(20261015);
    const draws = 104_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < draws; i++) {
      const c = drawCard(rng);
      counts.set(`${c.rank}${c.suit}`, (counts.get(`${c.rank}${c.suit}`) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    const expected = draws / 52;
    const chi = [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
    // 51 degrees of freedom: the 99.9th percentile is about 87.
    expect(chi).toBeLessThan(87);
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.1);
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

describe('the peek and the reveal', () => {
  it('peeks with an ace or any ten-value card up, never otherwise', () => {
    for (const up of ['AS', '10H', 'JD', 'QC', 'KS']) expect(dealerPeeks(card(up)), up).toBe(true);
    for (const up of ['2S', '5H', '9D']) expect(dealerPeeks(card(up)), up).toBe(false);
    expect(isTenValue('K')).toBe(true);
    expect(isTenValue('A')).toBe(false);
  });

  it('allows 1200 ms for the hole card and 500 ms for every card the dealer drew after it', () => {
    expect(revealAllowanceMs(2)).toBe(REVEAL_HOLE_MS);
    expect(revealAllowanceMs(5)).toBe(1200 + 3 * 500);
    expect(REVEAL_CARD_MS).toBe(500);
    // A dealer cleared before a deal (or never dealt) still gets the flip allowance only.
    expect(revealAllowanceMs(0)).toBe(1200);
  });
});
