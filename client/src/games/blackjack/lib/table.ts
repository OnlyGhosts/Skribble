/**
 * The table the screen draws, as plain data: the round in play, or the last settled round while
 * the next one is being bet on. Every card has a stable key so the timeline can tell which ones
 * are new between two snapshots.
 */
import { handTotal } from '@shared/games/blackjack/cards';
import type { BlackjackView, Card, HandOutcome, HandStatus, HandView, SettledHandView } from '@shared/games/blackjack/protocol';

export interface TableHand {
  cards: Card[];
  bet: number;
  status: HandStatus;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  /** Set once the round has settled. */
  outcome: HandOutcome | null;
  /** Chips the hand returned (0 on a loss); null before the settle. */
  payout: number | null;
}

export interface TableModel {
  round: number;
  settled: boolean;
  /** The dealer had blackjack at the peek. */
  peeked: boolean;
  /** Seats dealt, in play order. */
  order: string[];
  /** `null` is the hole card, face down. */
  dealer: (Card | null)[];
  hands: Record<string, TableHand[]>;
}

function liveHand(h: HandView): TableHand {
  return { cards: h.cards, bet: h.bet, status: h.status, doubled: h.doubled, fromSplit: h.fromSplit, splitAces: h.splitAces, outcome: null, payout: null };
}

function settledHand(h: SettledHandView): TableHand {
  return { ...liveHand(h), outcome: h.outcome, payout: h.payout };
}

/** The round on the table: the live one once dealt, otherwise the last settled one, otherwise none. */
export function tableOf(view: BlackjackView | null | undefined): TableModel | null {
  if (!view) return null;
  if (view.dealer.cards.length > 0) {
    const hands: Record<string, TableHand[]> = {};
    for (const id of view.order) hands[id] = (view.players[id]?.hands ?? []).map(liveHand);
    return {
      round: view.round,
      settled: false,
      peeked: false,
      order: [...view.order],
      dealer: view.dealer.holeHidden ? [...view.dealer.cards, null] : [...view.dealer.cards],
      hands,
    };
  }
  const last = view.lastRound;
  if (!last) return null;
  const hands: Record<string, TableHand[]> = {};
  for (const id of last.order) hands[id] = (last.hands[id] ?? []).map(settledHand);
  return { round: last.round, settled: true, peeked: last.peeked, order: [...last.order], dealer: [...last.dealer.cards], hands };
}

export const dealerKey = (index: number): string => `d${index}`;

export function cardKey(playerId: string, hand: number, index: number, card: Card): string {
  return `${playerId}/${hand}/${index}/${card.rank}${card.suit}`;
}

/**
 * Every card on the table in the order a dealer puts them down: a first card to each seat, the
 * dealer's up card, a second card to each seat, the hole card; then every further card seat by
 * seat and hand by hand (hits, doubles, split cards); then the dealer's draws.
 */
export function dealOrder(table: TableModel): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const round of [0, 1]) {
    for (const id of table.order) {
      const card = table.hands[id]?.[0]?.cards[round];
      if (card) push(cardKey(id, 0, round, card));
    }
    if (table.dealer.length > round) push(dealerKey(round));
  }
  for (const id of table.order) {
    (table.hands[id] ?? []).forEach((hand, h) => hand.cards.forEach((card, i) => push(cardKey(id, h, i, card))));
  }
  for (let i = 2; i < table.dealer.length; i++) push(dealerKey(i));
  return keys;
}

/** The cards of each seat by key, for spotting a card that only moved (a split). */
export function seatCards(table: TableModel, playerId: string): Map<string, string> {
  const out = new Map<string, string>();
  (table.hands[playerId] ?? []).forEach((hand, h) => hand.cards.forEach((card, i) => out.set(cardKey(playerId, h, i, card), `${card.rank}${card.suit}`)));
  return out;
}

export interface ShownTotal {
  total: number;
  soft: boolean;
}

/** The total of the cards on show (a face-down card counts for nothing). */
export function shownTotal(cards: readonly (Card | null)[]): ShownTotal | null {
  const up = cards.filter((c): c is Card => c !== null);
  if (up.length === 0) return null;
  return handTotal(up);
}

/** "17", or "7/17" while an ace still counts both ways and the hand can still draw. */
export function totalText({ total, soft }: ShownTotal, open = true): string {
  return open && soft && total < 21 ? `${total - 10}/${total}` : String(total);
}
