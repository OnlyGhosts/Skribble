/**
 * Texas Hold'em hand rankings, pure and shared by both sides: the nine categories, a comparable
 * value with kickers, the best five of up to seven cards and a human name for a hand.
 */
import type { Card, CardRank } from '../../platform/cards.js';

/** Ascending strength. */
export const HAND_CATEGORIES = ['highCard', 'pair', 'twoPair', 'threeOfAKind', 'straight', 'flush', 'fullHouse', 'fourOfAKind', 'straightFlush'] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandRank {
  category: HandCategory;
  /**
   * What breaks ties inside the category, most significant first: the quads rank then the
   * kicker, the trips then the pair, the high card of a straight, the five ranks of a flush...
   */
  ranks: number[];
  /** The five cards that make the hand, in significance order. */
  cards: Card[];
}

/** 2..14: an ace is high (the wheel is special-cased by the straight check). */
export function rankValue(rank: CardRank): number {
  if (rank === 'A') return 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return Number(rank);
}

const RANK_NAMES: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };

function plural(value: number): string {
  const name = RANK_NAMES[value];
  return name === 'six' ? 'sixes' : `${name}s`;
}

/** One number per hand that orders exactly like compareHands: the category, then up to five ranks in base 15. */
export function handValue(hand: HandRank): number {
  let value = HAND_CATEGORIES.indexOf(hand.category);
  for (let i = 0; i < 5; i++) value = value * 15 + (hand.ranks[i] ?? 0);
  return value;
}

/** Positive when `a` beats `b`, negative when `b` beats `a`, 0 for a split. */
export function compareHands(a: HandRank, b: HandRank): number {
  return handValue(a) - handValue(b);
}

/**
 * The high card of the best straight among `values` (distinct, descending), or 0. An ace plays
 * low in the wheel (5-4-3-2-A), so a 5-high straight is the lowest.
 */
function straightHigh(values: number[]): number {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high--) {
    if ([0, 1, 2, 3, 4].every((d) => set.has(high - d))) return high;
  }
  return 0;
}

/** The cards of a straight topped by `high`, one per rank, the ace standing in for 1 in the wheel. */
function straightCards(cards: readonly Card[], high: number): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < 5; d++) {
    const want = high - d === 1 ? 14 : high - d;
    const card = cards.find((c) => rankValue(c.rank) === want);
    if (card) out.push(card);
  }
  return out;
}

const descending = (a: Card, b: Card): number => rankValue(b.rank) - rankValue(a.rank);

/**
 * The best five-card hand within 5 to 7 cards, without enumerating combinations: rank counts
 * give the paired categories, suit counts the flushes, and the distinct ranks the straights.
 */
export function evaluateBest(input: readonly Card[]): HandRank {
  if (input.length < 5 || input.length > 7) throw new Error(`evaluateBest: ${input.length} cards`);
  const cards = [...input].sort(descending);
  const counts = new Map<number, Card[]>();
  const suits = new Map<string, Card[]>();
  for (const c of cards) {
    const v = rankValue(c.rank);
    counts.set(v, [...(counts.get(v) ?? []), c]);
    suits.set(c.suit, [...(suits.get(c.suit) ?? []), c]);
  }
  // Groups by size, then by rank, so quads come before trips and the higher pair before the lower.
  const groups = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const distinct = groups.map(([v]) => v).sort((a, b) => b - a);
  const flush = [...suits.values()].find((s) => s.length >= 5);

  if (flush) {
    const high = straightHigh(flush.map((c) => rankValue(c.rank)));
    if (high > 0) return { category: 'straightFlush', ranks: [high], cards: straightCards(flush, high) };
  }
  const quads = groups.find(([, g]) => g.length === 4);
  if (quads) {
    const kicker = cards.find((c) => rankValue(c.rank) !== quads[0]);
    return { category: 'fourOfAKind', ranks: [quads[0], kicker ? rankValue(kicker.rank) : 0], cards: kicker ? [...quads[1], kicker] : [...quads[1]] };
  }
  const trips = groups.find(([, g]) => g.length === 3);
  const pairOrBetter = groups.find(([v, g]) => g.length >= 2 && v !== trips?.[0]);
  if (trips && pairOrBetter) {
    return { category: 'fullHouse', ranks: [trips[0], pairOrBetter[0]], cards: [...trips[1], ...pairOrBetter[1].slice(0, 2)] };
  }
  if (flush) {
    const best = flush.slice(0, 5);
    return { category: 'flush', ranks: best.map((c) => rankValue(c.rank)), cards: best };
  }
  const high = straightHigh(distinct);
  if (high > 0) return { category: 'straight', ranks: [high], cards: straightCards(cards, high) };
  if (trips) {
    const kickers = cards.filter((c) => rankValue(c.rank) !== trips[0]).slice(0, 2);
    return { category: 'threeOfAKind', ranks: [trips[0], ...kickers.map((c) => rankValue(c.rank))], cards: [...trips[1], ...kickers] };
  }
  const pairs = groups.filter(([, g]) => g.length === 2);
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const kicker = cards.find((c) => rankValue(c.rank) !== p1[0] && rankValue(c.rank) !== p2[0]);
    return { category: 'twoPair', ranks: [p1[0], p2[0], kicker ? rankValue(kicker.rank) : 0], cards: kicker ? [...p1[1], ...p2[1], kicker] : [...p1[1], ...p2[1]] };
  }
  if (pairs.length === 1) {
    const kickers = cards.filter((c) => rankValue(c.rank) !== pairs[0][0]).slice(0, 3);
    return { category: 'pair', ranks: [pairs[0][0], ...kickers.map((c) => rankValue(c.rank))], cards: [...pairs[0][1], ...kickers] };
  }
  const best = cards.slice(0, 5);
  return { category: 'highCard', ranks: best.map((c) => rankValue(c.rank)), cards: best };
}

/** Exactly five cards: evaluateBest on them (the brute-force reference uses this per combination). */
export function evaluateFive(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) throw new Error(`evaluateFive: ${cards.length} cards`);
  return evaluateBest(cards);
}

/** "Two pair, kings and fives", "Royal flush", "Ace high". */
export function handName(hand: HandRank): string {
  const [a, b] = hand.ranks;
  switch (hand.category) {
    case 'straightFlush':
      return a === 14 ? 'Royal flush' : `Straight flush, ${RANK_NAMES[a]} high`;
    case 'fourOfAKind':
      return `Four of a kind, ${plural(a)}`;
    case 'fullHouse':
      return `Full house, ${plural(a)} over ${plural(b)}`;
    case 'flush':
      return `Flush, ${RANK_NAMES[a]} high`;
    case 'straight':
      return `Straight, ${RANK_NAMES[a]} high`;
    case 'threeOfAKind':
      return `Three of a kind, ${plural(a)}`;
    case 'twoPair':
      return `Two pair, ${plural(a)} and ${plural(b)}`;
    case 'pair':
      return `Pair of ${plural(a)}`;
    case 'highCard':
      return `${RANK_NAMES[a][0].toUpperCase()}${RANK_NAMES[a].slice(1)} high`;
  }
}

/** Every 5-card combination of `cards` (the brute-force reference for tests). */
export function choose5(cards: readonly Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}
