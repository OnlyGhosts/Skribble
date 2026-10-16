/**
 * A tap waiting for the table's answer. Nothing on screen changes the moment a move is sent; the
 * next snapshot does. Until it comes, every control is held, so a second tap never sends a second
 * move (a second card, the next split hand stood, a refused bet). The answer is any snapshot in
 * which the round, the turn, my cards, my bet or my sitting out differ from when the tap went out.
 */
import type { BlackjackMoveTarget, BlackjackView } from '@shared/games/blackjack/protocol';

export type PendingKind = 'bet' | 'hit' | 'stand' | 'double' | 'split' | 'sitOut' | 'dealNow' | 'skip';

export interface Pending {
  kind: PendingKind;
  /** The table as the tap saw it (answerKey). */
  key: string;
}

/** Cards I hold across my hands this round. */
export function myCards(view: BlackjackView, meId: string): number {
  return (view.players[meId]?.hands ?? []).reduce((sum, h) => sum + h.cards.length, 0);
}

/** What changes once a tap of mine has been answered (or the play moved on without it). */
export function answerKey(view: BlackjackView, meId: string): string {
  const seat = view.players[meId];
  const turn = view.turn ? `${view.turn.playerId}:${view.turn.handIndex}` : '-';
  return [view.round, view.phase, turn, myCards(view, meId), seat?.bet ?? 0, seat?.sittingOut ? 1 : 0].join('|');
}

/** Whether this snapshot answers the tap. */
export function answered(pending: Pending, view: BlackjackView, meId: string): boolean {
  return answerKey(view, meId) !== pending.key;
}

/** What a move is aimed at: the round, the hand in play, my cards. A tap that lands after the play moved on does nothing. */
export function moveTarget(view: BlackjackView, meId: string): BlackjackMoveTarget {
  return { round: view.round, handIndex: view.turn?.handIndex ?? 0, cards: myCards(view, meId) };
}
