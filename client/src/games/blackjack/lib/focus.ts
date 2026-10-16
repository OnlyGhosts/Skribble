/**
 * What the Blackjack table is following, phase by phase (pure, for the screen and the tests): the
 * hand being played and who is next; the dealer while the reveal plays; my own outcome once the
 * round settles (through the results pause, until my next bet goes down); who has bet and who we
 * wait for while the bets go down. The line under the ribbon says it, and the stage at the bottom
 * of the table shows the hand in play.
 */
import type { BlackjackView, HandOutcome } from '@shared/games/blackjack/protocol';
import { pendingBettors } from '../hooks';
import type { TableHand, TableModel } from './table';

export type BjFocus =
  /** `next` is who plays after this seat; null when the dealer is next. */
  | { kind: 'turn'; playerId: string; handIndex: number; mine: boolean; next: string | null }
  | { kind: 'dealer' }
  | { kind: 'bets'; placed: string[]; waiting: string[] }
  | { kind: 'result'; playerId: string }
  /** `next`: the results pause before the next round, for someone with no hand in it. */
  | { kind: 'idle'; reason: 'held' | 'over' | 'next' };

export interface SubjectInput {
  view: BlackjackView;
  /** The table on screen (the settled round stays up through the next betting). */
  table: TableModel | null;
  /** The settled round's reveal is still playing on screen. */
  dealerPlaying: boolean;
  /** The settled outcomes are on screen. */
  outcomesShown: boolean;
  meId: string | null;
}

/** The next seat in play order with a hand still to play, after `playerId`. */
function nextToPlay(view: BlackjackView, playerId: string): string | null {
  const at = view.order.indexOf(playerId);
  return view.order.slice(at + 1).find((id) => (view.players[id]?.hands ?? []).some((h) => h.status === 'waiting' || h.status === 'acting')) ?? null;
}

export function focusOf({ view, table, dealerPlaying, outcomesShown, meId }: SubjectInput): BjFocus {
  if (view.phase === 'held') return { kind: 'idle', reason: 'held' };
  if (dealerPlaying) return { kind: 'dealer' };
  if (view.phase === 'acting') {
    if (!view.turn) return { kind: 'dealer' };
    const { playerId, handIndex } = view.turn;
    return { kind: 'turn', playerId, handIndex, mine: playerId === meId, next: nextToPlay(view, playerId) };
  }
  const settledMine = meId !== null && Boolean(table?.settled) && outcomesShown && (table?.hands[meId]?.length ?? 0) > 0;
  if (view.phase === 'ending' || view.phase === 'gameOver') return settledMine && meId !== null ? { kind: 'result', playerId: meId } : { kind: 'idle', reason: 'over' };
  if (view.phase === 'results') return settledMine && meId !== null ? { kind: 'result', playerId: meId } : { kind: 'idle', reason: 'next' };
  // Betting: my outcome stays up until my next stake goes down.
  if (settledMine && meId !== null && (view.players[meId]?.bet ?? 0) === 0) return { kind: 'result', playerId: meId };
  return { kind: 'bets', placed: view.order.filter((id) => (view.players[id]?.bet ?? 0) > 0), waiting: pendingBettors(view) };
}

/** A stable key per subject: a new key slides the line under the ribbon over to it. */
export function focusKey(s: BjFocus): string {
  switch (s.kind) {
    case 'turn':
      return `turn:${s.playerId}`;
    case 'result':
      return `result:${s.playerId}`;
    case 'idle':
      return `idle:${s.reason}`;
    default:
      return s.kind;
  }
}

/** How a seat's round went, once settled: won more than staked, lost, or a push; a lone natural is a blackjack. */
export function seatOutcome(hands: readonly TableHand[]): HandOutcome | null {
  if (hands.length === 0 || hands.some((h) => h.outcome === null)) return null;
  if (hands.length === 1) return hands[0].outcome;
  const back = hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
  const staked = hands.reduce((sum, h) => sum + h.bet, 0);
  return back > staked ? 'win' : back === staked ? 'push' : 'loss';
}

/**
 * Whose hands take the stage at the bottom of the table: another player's on their turn (their
 * hits are what everyone watches, and a seat is too small to follow them), otherwise mine when I
 * am seated; a spectator sees the hand in play, or nothing.
 */
export function stageOwner(focus: BjFocus, seated: boolean, meId: string): string | null {
  if (focus.kind === 'turn' && !focus.mine) return focus.playerId;
  return seated ? meId : null;
}

/** The stage's kind, for its data: my turn reads `mine`, another's `turn`, the rest as the focus. */
export function stageKind(focus: BjFocus): string {
  if (focus.kind === 'turn') return focus.mine ? 'mine' : 'turn';
  return focus.kind;
}
