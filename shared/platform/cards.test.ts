import { describe, expect, it } from 'vitest';
import { CARD_RANKS, CARD_SUITS, cardOf, freshDeck, isCardRank, isCardSuit, shuffle } from './cards.js';

describe('the shared deck', () => {
  it('builds whole decks in a fixed order', () => {
    const one = freshDeck();
    expect(one).toHaveLength(52);
    expect(one[0]).toEqual({ rank: 'A', suit: 'S' });
    expect(one[51]).toEqual({ rank: 'K', suit: 'C' });
    expect(new Set(one.map((c) => c.rank + c.suit)).size).toBe(52);
    expect(freshDeck(6)).toHaveLength(312);
    expect(CARD_RANKS).toHaveLength(13);
    expect(CARD_SUITS).toEqual(['S', 'H', 'D', 'C']);
  });

  it('shuffles a copy with the injected rng only, so the same rng gives the same order', () => {
    const deck = freshDeck();
    let n = 0;
    const rng = () => ((n += 7) % 13) / 13;
    const a = shuffle(deck, rng);
    n = 0;
    const b = shuffle(deck, rng);
    expect(a).toEqual(b);
    expect(a).not.toEqual(deck);
    expect(deck[0]).toEqual({ rank: 'A', suit: 'S' });
    expect([...a].sort((x, y) => (x.rank + x.suit).localeCompare(y.rank + y.suit))).toEqual([...deck].sort((x, y) => (x.rank + x.suit).localeCompare(y.rank + y.suit)));
    // rng () => 0 swaps every card with the first one: a fixed, non-trivial permutation (the ace of spades ends up last).
    const zero = shuffle(deck, () => 0);
    expect(zero[0]).toEqual({ rank: '2', suit: 'S' });
    expect(zero[51]).toEqual({ rank: 'A', suit: 'S' });
    // An rng that returns 1 (out of spec) still stays inside the deck.
    expect(shuffle(deck, () => 1)).toHaveLength(52);
  });

  it('parses the short card notation and refuses anything else', () => {
    expect(cardOf('AS')).toEqual({ rank: 'A', suit: 'S' });
    expect(cardOf('10H')).toEqual({ rank: '10', suit: 'H' });
    expect(() => cardOf('1S')).toThrow('not a card: 1S');
    expect(() => cardOf('AX')).toThrow();
    expect(isCardRank('10')).toBe(true);
    expect(isCardRank('T')).toBe(false);
    expect(isCardSuit('D')).toBe(true);
    expect(isCardSuit('d')).toBe(false);
  });
});
