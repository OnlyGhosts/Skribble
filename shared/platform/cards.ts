/**
 * The standard 52-card deck shared by the card games: ranks, suits, fresh decks and a shuffle
 * that draws every index from an injected rng, so a reducer stays deterministic.
 */

export const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const CARD_SUITS = ['S', 'H', 'D', 'C'] as const;

export type CardRank = (typeof CARD_RANKS)[number];
export type CardSuit = (typeof CARD_SUITS)[number];

export interface Card {
  rank: CardRank;
  suit: CardSuit;
}

/** `decks` full decks in rank order within suit, suit order S, H, D, C. */
export function freshDeck(decks = 1): Card[] {
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

/** 'AS', '10H', 'KD' -> a card; throws on anything else (tests and fixtures). */
export function cardOf(text: string): Card {
  const rank = text.slice(0, -1);
  const suit = text.slice(-1);
  if (!isCardRank(rank) || !isCardSuit(suit)) throw new Error(`not a card: ${text}`);
  return { rank, suit };
}

export function isCardRank(s: string): s is CardRank {
  return (CARD_RANKS as readonly string[]).includes(s);
}

export function isCardSuit(s: string): s is CardSuit {
  return (CARD_SUITS as readonly string[]).includes(s);
}
