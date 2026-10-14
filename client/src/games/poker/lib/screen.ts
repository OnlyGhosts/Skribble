/** What the table shows at `now` for cards and outcomes, read off the hand and its timeline (pure, for the components and the tests). */
import type { Card } from '@shared/games/poker/protocol';
import { boardKey, holeKey, winnings, type PokerTable } from './table';
import { cardMotion, cardShown, departure, faceDown, flipping, outcomesShown, type Timeline } from './timeline';

export interface CardOnScreen {
  key: string;
  /** Null shows the back. */
  card: Card | null;
  motion: 'deal' | 'move' | null;
  flipping: boolean;
  /** On its way to the muck. */
  leaving: boolean;
}

function onScreen(timeline: Timeline, key: string, card: Card | null, now: number): CardOnScreen | null {
  if (!cardShown(timeline, key, now)) return null;
  const down = card === null || faceDown(timeline, key, now);
  return { key, card: down ? null : card, motion: cardMotion(timeline, key, now), flipping: !down && flipping(timeline, key, now), leaving: false };
}

/** A seat's hole cards as they stand at `now`: dealt so far, face down until shown, a folded hand gone to the muck (mine stay, dimmed). */
export function holeOnScreen(table: PokerTable | null, timeline: Timeline, id: string, meId: string | null, now: number): CardOnScreen[] {
  const seat = table?.seats[id];
  if (!seat) return [];
  const out: CardOnScreen[] = [];
  seat.cards.forEach((card, i) => {
    const key = holeKey(id, i);
    const shown = onScreen(timeline, key, card, now);
    if (!shown) return;
    if (seat.status === 'folded' && id !== meId) {
      const where = departure(timeline, key, now);
      if (where === 'gone') return;
      shown.leaving = where === 'leaving';
    }
    out.push(shown);
  });
  return out;
}

/** The board's five places at `now`: a card (face down while it turns over) or null for an empty slot. */
export function boardOnScreen(table: PokerTable | null, timeline: Timeline, now: number): (CardOnScreen | null)[] {
  return Array.from({ length: 5 }, (_, i) => {
    const card = table?.community[i];
    return card ? onScreen(timeline, boardKey(i), card, now) : null;
  });
}

/** The cards that play for the main pot's winner, lifted once the outcome shows. */
export function winningCards(table: PokerTable | null, timeline: Timeline, now: number): Card[] {
  const results = table?.results;
  if (!results || results.uncontested || !outcomesShown(timeline, now)) return [];
  const winner = results.pots[0]?.winners[0]?.playerId;
  return winner ? (results.revealed[winner]?.best ?? []) : [];
}

export const sameCard = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

/** What a seat took from the pots, once the table shows the outcome (0 otherwise). */
export function wonOnScreen(table: PokerTable | null, timeline: Timeline, id: string, now: number): number {
  if (!table?.results || !outcomesShown(timeline, now)) return 0;
  return winnings(table.results)[id] ?? 0;
}
