/** The hand rankings: every category in order, kickers, the wheel, the names and a brute-force property check of evaluateBest. */
import { describe, expect, it } from 'vitest';
import { cardOf, freshDeck, shuffle } from '../../platform/cards.js';
import { choose5, compareHands, evaluateBest, evaluateFive, handName, handValue, rankValue } from './hands.js';

const cards = (...texts: string[]) => texts.map(cardOf);
const best = (...texts: string[]) => evaluateBest(cards(...texts));
const names = (hand: ReturnType<typeof evaluateBest>) => hand.cards.map((c) => c.rank + c.suit);

describe('hand categories', () => {
  it('ranks every category above the one before it', () => {
    const ladder = [
      best('AS', 'KD', '9H', '7C', '2S'), // high card
      best('AS', 'AD', '9H', '7C', '2S'), // pair
      best('AS', 'AD', '9H', '9C', '2S'), // two pair
      best('AS', 'AD', 'AH', '7C', '2S'), // trips
      best('2S', '3D', '4H', '5C', '6S'), // straight
      best('AS', 'KS', '9S', '7S', '2S'), // flush
      best('2S', '2D', '2H', '3C', '3S'), // full house
      best('2S', '2D', '2H', '2C', '3S'), // quads
      best('2S', '3S', '4S', '5S', '6S'), // straight flush
    ];
    expect(ladder.map((h) => h.category)).toEqual(['highCard', 'pair', 'twoPair', 'threeOfAKind', 'straight', 'flush', 'fullHouse', 'fourOfAKind', 'straightFlush']);
    for (let i = 1; i < ladder.length; i++) {
      expect(compareHands(ladder[i], ladder[i - 1])).toBeGreaterThan(0);
      expect(handValue(ladder[i])).toBeGreaterThan(handValue(ladder[i - 1]));
    }
  });

  it('breaks ties on kickers and splits identical hands', () => {
    const aceKing = best('AS', 'AD', 'KH', '7C', '2S');
    const aceQueen = best('AC', 'AH', 'QH', '7D', '2D');
    expect(compareHands(aceKing, aceQueen)).toBeGreaterThan(0);
    expect(compareHands(aceQueen, aceKing)).toBeLessThan(0);
    // The suits never matter.
    expect(compareHands(best('AS', 'AD', 'KH', '7C', '2S'), best('AC', 'AH', 'KD', '7D', '2D'))).toBe(0);
    // Two pair: the higher top pair wins, then the second pair, then the kicker.
    expect(compareHands(best('KS', 'KD', '5H', '5C', '2S'), best('QS', 'QD', 'JH', 'JC', 'AS'))).toBeGreaterThan(0);
    expect(compareHands(best('KS', 'KD', '5H', '5C', '2S'), best('KC', 'KH', '4H', '4C', 'AS'))).toBeGreaterThan(0);
    expect(compareHands(best('KS', 'KD', '5H', '5C', '2S'), best('KC', 'KH', '5D', '5S', '3S'))).toBeLessThan(0);
    // Flush: compared card by card.
    expect(compareHands(best('AS', 'KS', '9S', '7S', '2S'), best('AH', 'KH', '9H', '6H', '5H'))).toBeGreaterThan(0);
    // High card: the fifth card decides.
    expect(compareHands(best('AS', 'KD', '9H', '7C', '3S'), best('AC', 'KH', '9D', '7S', '2D'))).toBeGreaterThan(0);
  });

  it('counts the wheel as the lowest straight and ace-high as the highest', () => {
    const wheel = best('AS', '2D', '3H', '4C', '5S');
    expect(wheel).toMatchObject({ category: 'straight', ranks: [5] });
    expect(names(wheel)).toEqual(['5S', '4C', '3H', '2D', 'AS']);
    const six = best('2S', '3D', '4H', '5C', '6S');
    const broadway = best('AS', 'KD', 'QH', 'JC', '10S');
    expect(compareHands(six, wheel)).toBeGreaterThan(0);
    expect(compareHands(broadway, six)).toBeGreaterThan(0);
    expect(broadway.ranks).toEqual([14]);
    // A-2-3-4-5 of one suit is a five-high straight flush, not a royal flush.
    expect(best('AS', '2S', '3S', '4S', '5S')).toMatchObject({ category: 'straightFlush', ranks: [5] });
    expect(best('AS', 'KS', 'QS', 'JS', '10S')).toMatchObject({ category: 'straightFlush', ranks: [14] });
    // K-A-2-3-4 is no straight: the ace does not wrap.
    expect(best('KS', 'AD', '2H', '3C', '4S').category).toBe('highCard');
  });

  it('prefers a flush to a straight and the higher full house', () => {
    expect(compareHands(best('2S', '7S', '9S', 'JS', 'KS'), best('9D', '10H', 'JC', 'QS', 'KD'))).toBeGreaterThan(0);
    // Trips decide a full house before the pair.
    expect(compareHands(best('3S', '3D', '3H', 'AC', 'AS'), best('KS', 'KD', 'KH', '2C', '2S'))).toBeLessThan(0);
    expect(compareHands(best('KS', 'KD', 'KH', '3C', '3S'), best('KS', 'KD', 'KH', '2C', '2S'))).toBeGreaterThan(0);
  });

  it('picks the best five of seven: a full house out of two trips, the top two of three pairs, the higher straight', () => {
    const twoTrips = best('AS', 'AD', 'AH', '2C', '2S', '2D', '9H');
    expect(twoTrips).toMatchObject({ category: 'fullHouse', ranks: [14, 2] });
    const threePairs = best('AS', 'AD', '9H', '9C', '2S', '2D', 'KH');
    expect(threePairs).toMatchObject({ category: 'twoPair', ranks: [14, 9, 13] });
    // The third pair's rank is the kicker when it beats the loose cards.
    expect(best('AS', 'AD', '9H', '9C', '5S', '5D', '3H')).toMatchObject({ category: 'twoPair', ranks: [14, 9, 5] });
    expect(best('2S', '3D', '4H', '5C', '6S', '7D', '8H')).toMatchObject({ category: 'straight', ranks: [8] });
    // A flush with six suited cards keeps the five highest.
    expect(best('2S', '3S', '9S', 'JS', 'KS', 'AS', 'AD')).toMatchObject({ category: 'flush', ranks: [14, 13, 11, 9, 3] });
    // Quads with the best kicker from the other three.
    expect(best('7S', '7D', '7H', '7C', '2S', 'KD', 'QH')).toMatchObject({ category: 'fourOfAKind', ranks: [7, 13] });
    // A straight flush hiding inside a longer run of mixed suits.
    expect(best('5H', '6H', '7H', '8H', '9H', '10S', 'JS')).toMatchObject({ category: 'straightFlush', ranks: [9] });
    // Trips with two kickers.
    expect(best('QS', 'QD', 'QH', '2C', '9S', 'JD', '3H')).toMatchObject({ category: 'threeOfAKind', ranks: [12, 11, 9] });
    // A pair with three kickers.
    expect(best('QS', 'QD', '4H', '2C', '9S', 'JD', '3H')).toMatchObject({ category: 'pair', ranks: [12, 11, 9, 4] });
  });

  it('names hands the way players say them', () => {
    expect(handName(best('KS', 'KD', '5H', '5C', '2S'))).toBe('Two pair, kings and fives');
    expect(handName(best('AS', 'KS', 'QS', 'JS', '10S'))).toBe('Royal flush');
    expect(handName(best('9S', '8S', '7S', '6S', '5S'))).toBe('Straight flush, nine high');
    expect(handName(best('6S', '6D', '6H', '6C', '2S'))).toBe('Four of a kind, sixes');
    expect(handName(best('3S', '3D', '3H', 'AC', 'AS'))).toBe('Full house, threes over aces');
    expect(handName(best('AS', 'KS', '9S', '7S', '2S'))).toBe('Flush, ace high');
    expect(handName(best('AS', '2D', '3H', '4C', '5S'))).toBe('Straight, five high');
    expect(handName(best('QS', 'QD', 'QH', '7C', '2S'))).toBe('Three of a kind, queens');
    expect(handName(best('JS', 'JD', '9H', '7C', '2S'))).toBe('Pair of jacks');
    expect(handName(best('AS', 'KD', '9H', '7C', '2S'))).toBe('Ace high');
    expect(handName(best('10S', '9D', '7H', '4C', '2S'))).toBe('Ten high');
  });

  it('maps ranks to values with the ace high', () => {
    expect(['2', '10', 'J', 'Q', 'K', 'A'].map((r) => rankValue(r as 'A'))).toEqual([2, 10, 11, 12, 13, 14]);
    expect(() => evaluateBest(cards('AS', 'KD', '9H', '7C'))).toThrow();
    expect(() => evaluateFive(cards('AS', 'KD', '9H', '7C', '2S', '3S'))).toThrow();
  });
});

describe('evaluateBest against brute force', () => {
  it('agrees with the best of every five-card combination over 2000 seeded random seven-card hands', () => {
    // A small deterministic LCG stands in for ctx.rng.
    let seed = 20260101;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const deck = freshDeck();
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const seven = shuffle(deck, rng).slice(0, 7);
      const fast = evaluateBest(seven);
      let slow = evaluateFive(choose5(seven)[0]);
      for (const combo of choose5(seven)) {
        const h = evaluateFive(combo);
        if (compareHands(h, slow) > 0) slow = h;
      }
      expect(handValue(fast), seven.map((c) => c.rank + c.suit).join(' ')).toBe(handValue(slow));
      expect(fast.category).toBe(slow.category);
      expect(fast.ranks).toEqual(slow.ranks);
      // The five cards named really are five cards of the seven that evaluate to the same hand.
      expect(fast.cards).toHaveLength(5);
      expect(fast.cards.every((c) => seven.includes(c))).toBe(true);
      expect(handValue(evaluateFive(fast.cards))).toBe(handValue(fast));
      seen.add(fast.category);
    }
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });
});
