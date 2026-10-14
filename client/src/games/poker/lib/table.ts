/**
 * The hand the Poker screen draws, as plain data: who was dealt in, the board, the chips in the
 * middle, every seat's cards (mine face up, everyone else's face down until a showdown shows them)
 * and how the hand ended. Every card has a stable key so the timeline can tell which ones are new
 * between two snapshots.
 */
import type { Card, PokerPotView, PokerResults, PokerSeatStatus, PokerStreet, PokerView } from '@shared/games/poker/protocol';

export interface SeatModel {
  /** Mine face up; anyone else's null until a showdown shows them; none when not dealt in. */
  cards: (Card | null)[];
  status: PokerSeatStatus;
  /** Chips bet on the current street. */
  bet: number;
  /** Chips in the middle from this seat this hand, the current street included. */
  committed: number;
  chips: number;
}

export interface PokerTable {
  hand: number;
  street: PokerStreet | null;
  /** Seats dealt in, in seat order. */
  order: string[];
  dealerId: string | null;
  community: Card[];
  /** Every chip in the middle right now (0 once the hand is paid out). */
  pot: number;
  pots: PokerPotView[];
  seats: Record<string, SeatModel>;
  results: PokerResults | null;
}

export const holeKey = (playerId: string, index: number): string => `h/${playerId}/${index}`;
export const boardKey = (index: number): string => `b/${index}`;

/** The hand on the table, or null before the first deal. */
export function tableOf(view: PokerView | null | undefined, meId: string | null): PokerTable | null {
  if (!view || view.hand === 0 || view.order.length === 0) return null;
  const seats: Record<string, SeatModel> = {};
  for (const id of view.order) {
    const p = view.players[id];
    if (!p) continue;
    const revealed = view.results?.revealed[id];
    let cards: (Card | null)[] = [];
    if (id === meId && view.myCards.length > 0) cards = [...view.myCards];
    else if (revealed) cards = [...revealed.cards];
    else if (p.status !== 'out') cards = [null, null];
    seats[id] = { cards, status: p.status, bet: p.bet, committed: p.committed, chips: p.chips };
  }
  return {
    hand: view.hand,
    street: view.street,
    order: view.order.filter((id) => seats[id] !== undefined),
    dealerId: view.dealerId,
    community: [...view.community],
    pot: view.pot,
    pots: view.pots,
    seats,
    results: view.results,
  };
}

/** The seats in the order a dealer deals: starting left of the button, round the table. */
export function dealingOrder(table: Pick<PokerTable, 'order' | 'dealerId'>): string[] {
  const at = table.dealerId === null ? -1 : table.order.indexOf(table.dealerId);
  return table.order.map((_, k) => table.order[(at + 1 + k) % table.order.length]);
}

/** What each seat took from the pots at the end of the hand. */
export function winnings(results: PokerResults | null): Record<string, number> {
  const won: Record<string, number> = {};
  for (const pot of results?.pots ?? []) for (const w of pot.winners) won[w.playerId] = (won[w.playerId] ?? 0) + w.amount;
  return won;
}

/** Every chip the hand's pots held. */
export function potsTotal(results: PokerResults | null): number {
  return (results?.pots ?? []).reduce((sum, p) => sum + p.amount, 0);
}

/** The chips a seat had put in before the current street (its bet on the street not counted). */
export function committedBefore(table: PokerTable, id: string): number {
  const seat = table.seats[id];
  if (!seat) return 0;
  // A settled hand has spent its committed chips: what the seat put in is what it won minus its net.
  if (table.results) return (winnings(table.results)[id] ?? 0) - (table.results.net[id] ?? 0);
  return seat.committed - seat.bet;
}

/** Still holding cards: in the hand and not folded. */
export function holding(seat: SeatModel | undefined): boolean {
  return seat !== undefined && (seat.status === 'waiting' || seat.status === 'acting' || seat.status === 'allIn');
}
