/** The raise field's arithmetic: the window a bet or raise may go in, the typed amount and the 1/2 pot, Pot and MAX buttons. */
import type { PokerActions, PokerView } from '@shared/games/poker/protocol';
import { highestBet } from '../hooks';

/** A bet's amount, or the total a raise goes to. */
export interface RaiseRange {
  kind: 'bet' | 'raise';
  min: number;
  max: number;
}

export function raiseRange(actions: PokerActions): RaiseRange | null {
  if (actions.canBet) return { kind: 'bet', min: actions.minBet, max: actions.maxBet };
  if (actions.canRaise) return { kind: 'raise', min: actions.minRaiseTo, max: actions.maxRaiseTo };
  return null;
}

/**
 * Whether the amount row is a bet or a raise: what my actions offer on my turn; off my turn, what
 * the table says (a bet on a street after the flop nobody has bet on yet, a raise otherwise, the
 * blinds being bets), so the label does not change the moment my turn comes.
 */
export function wagerKind(view: Pick<PokerView, 'street' | 'players'>, range: RaiseRange | null): RaiseRange['kind'] {
  if (range) return range.kind;
  return view.street !== null && view.street !== 'preflop' && highestBet(view) === 0 ? 'bet' : 'raise';
}

export function clampAmount(amount: number, range: RaiseRange): number {
  if (!Number.isFinite(amount)) return range.min;
  return Math.max(range.min, Math.min(range.max, Math.round(amount)));
}

/** What the Bet / Raise button sends for the field's text: clamped into the window, or null for a blank or unreadable field. */
export function amountFrom(text: string, range: RaiseRange): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return clampAmount(Number(trimmed), range);
}

/**
 * A pot-sized bet or raise times `fraction`, clamped to the window. A pot-sized raise first
 * calls, then raises by the pot that call makes: to = highest bet + (pot + my call) * fraction.
 */
export function potSized(view: Pick<PokerView, 'pot' | 'players'>, myBet: number, range: RaiseRange, fraction: number): number {
  const highest = highestBet(view);
  const potAfterCall = view.pot + Math.max(0, highest - myBet);
  const sized = range.kind === 'bet' ? view.pot * fraction : highest + potAfterCall * fraction;
  return clampAmount(Math.floor(sized), range);
}
