import { evaluateBest, handName, rankValue, type HandRank } from '@shared/games/poker/hands';
import type { Card, PokerLastAction, PokerPhase, PokerSeatStatus, PokerStreet, PokerView } from '@shared/games/poker/protocol';
import { formatChips } from '../../../platform/lib/format';

export { formatChips };

/** "Hand 3 of 10" (or "Hand 3/10" in the phone bar); "Hand 3" when the game runs until one stack is left. */
export function handLabel(view: Pick<PokerView, 'hand' | 'totalHands'>, long: boolean): string {
  const hand = Math.max(1, view.hand);
  if (view.totalHands === 0) return `Hand ${hand}`;
  return long ? `Hand ${hand} of ${view.totalHands}` : `Hand ${hand}/${view.totalHands}`;
}

const STREETS: Record<PokerStreet, string> = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

export function streetLabel(street: PokerStreet | null): string {
  return street ? STREETS[street] : 'Dealing';
}

export function blindsLabel(view: Pick<PokerView, 'blinds'>): string {
  return `${formatChips(view.blinds.small)}/${formatChips(view.blinds.big)}`;
}

/** The phase in a few words; `short` is the phone header's narrow slot. */
export function phaseKicker(view: PokerView, turnName: string, mine: boolean, short = false): string {
  switch (view.phase) {
    case 'acting':
      if (mine) return short ? 'Your move' : `${streetLabel(view.street)} — your move`;
      return short ? `${turnName}'s move` : `${streetLabel(view.street)} — ${turnName} to act`;
    case 'results':
      return view.paused ? 'Paused' : 'Showdown';
    case 'gameOver':
      return 'Game over';
  }
}

export function chatPlaceholderFor(phase: PokerPhase | undefined, inHand: boolean): string | undefined {
  switch (phase) {
    case 'acting':
      return inHand ? 'Table talk…' : 'Watching this hand…';
    case 'results':
      return 'Nice hand…';
    default:
      return undefined;
  }
}

const STATUS_LABELS: Record<PokerSeatStatus, string> = { waiting: 'In', acting: 'Acting', folded: 'Folded', allIn: 'All in', out: 'Out' };

export function statusLabel(status: PokerSeatStatus): string {
  return STATUS_LABELS[status];
}

/** What a seat did last on this street: "Check", "Call 20", "Raise to 80", "All in 300", "BB 10". */
export function lastActionLabel(action: PokerLastAction | null): string {
  if (!action) return '';
  const n = formatChips(action.amount);
  switch (action.kind) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return `Call ${n}`;
    case 'bet':
      return `Bet ${n}`;
    case 'raise':
      return `Raise to ${n}`;
    case 'allIn':
      return `All in ${n}`;
    case 'smallBlind':
      return `SB ${n}`;
    case 'bigBlind':
      return `BB ${n}`;
  }
}

/** The chips a hand moved: "+150", "−50", "±0". */
export function netLabel(net: number): string {
  if (net > 0) return `+${formatChips(net)}`;
  if (net < 0) return `−${formatChips(-net)}`;
  return '±0';
}

/**
 * What my cards make right now, for the hint under them: the best five of everything once five
 * are out ("Two pair, kings and fives"), a pocket pair or the high card before the flop.
 */
export function handHint(myCards: readonly Card[], community: readonly Card[]): string | null {
  if (myCards.length < 2) return null;
  const all = [...myCards, ...community];
  if (all.length >= 5) return handName(evaluateBest(all));
  const values = myCards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const hand: HandRank = values[0] === values[1] ? { category: 'pair', ranks: [values[0]], cards: [...myCards] } : { category: 'highCard', ranks: values, cards: [...myCards] };
  return handName(hand);
}
