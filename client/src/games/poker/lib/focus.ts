/**
 * What the Poker table is following (pure, for the screen and the tests): the player to act and
 * who is next round the table; the showdown while the hands turn over; then the winner of the main
 * pot (me, when I took any of it); nothing to follow while dealing, holding or at the end. The line
 * under the ribbon says it, and the stage at the bottom of the table shows the hand that matters.
 */
import type { PokerView } from '@shared/games/poker/protocol';
import { winnings, type PokerTable } from './table';

export type PkFocus =
  /** `next` is the next seat still to act after this one, round the table; null when nobody else is. */
  | { kind: 'turn'; playerId: string; mine: boolean; next: string | null }
  | { kind: 'result'; playerId: string; mine: boolean }
  | { kind: 'idle'; reason: 'dealing' | 'showdown' | 'held' | 'over' };

export interface FocusInput {
  view: PokerView;
  /** The hand on screen. */
  table: PokerTable | null;
  /** The hand's outcome is on screen. */
  outcomesShown: boolean;
  held: boolean;
  meId: string | null;
}

/** The next seat round the table after `playerId` that still has a move to make. */
function nextToAct(view: PokerView, playerId: string): string | null {
  const at = view.order.indexOf(playerId);
  for (let k = 1; k < view.order.length; k++) {
    const id = view.order[(at + k) % view.order.length];
    if (view.players[id]?.status === 'waiting') return id;
  }
  return null;
}

export function focusOf({ view, table, outcomesShown, held, meId }: FocusInput): PkFocus {
  if (view.phase === 'gameOver') return { kind: 'idle', reason: 'over' };
  if (view.phase === 'acting') {
    if (!view.turn) return { kind: 'idle', reason: 'dealing' };
    return { kind: 'turn', playerId: view.turn, mine: view.turn === meId, next: nextToAct(view, view.turn) };
  }
  const results = table?.results ?? null;
  if (results && outcomesShown) {
    const won = winnings(results);
    const winner = meId !== null && (won[meId] ?? 0) > 0 ? meId : results.pots[0]?.winners[0]?.playerId;
    if (winner) return { kind: 'result', playerId: winner, mine: winner === meId };
  }
  if (held) return { kind: 'idle', reason: 'held' };
  return { kind: 'idle', reason: results ? 'showdown' : 'dealing' };
}

/**
 * Whose cards take the stage at the bottom of the table: mine whenever I hold cards in the hand
 * on the table (theirs are backs until a showdown, so my own are what I follow); otherwise the
 * hand in play, then the winner's; a spectator before the deal sees nobody's.
 */
export function stageOwner(focus: PkFocus, table: PokerTable | null, meId: string | null): string | null {
  if (meId !== null && (table?.seats[meId]?.cards.length ?? 0) > 0) return meId;
  return focus.kind === 'idle' ? null : focus.playerId;
}

/** The stage's kind, for its data: my turn reads `mine`, another's `turn`, the rest as the focus. */
export function stageKind(focus: PkFocus): string {
  if (focus.kind === 'turn') return focus.mine ? 'mine' : 'turn';
  return focus.kind;
}
