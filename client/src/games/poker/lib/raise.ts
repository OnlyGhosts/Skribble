import type { PokerActions, PokerView } from '@shared/games/poker/protocol';
import { highestBet } from '../hooks';

/** The bet/raise panel's window: a bet's amount, or the total a raise goes to. */
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

export function clampAmount(amount: number, range: RaiseRange): number {
  if (!Number.isFinite(amount)) return range.min;
  return Math.max(range.min, Math.min(range.max, Math.round(amount)));
}

export type PresetId = 'min' | 'half' | 'pot' | 'allIn';

export interface Preset {
  id: PresetId;
  label: string;
  amount: number;
}

/**
 * Min, half pot, pot and all in, clamped to the window. A pot-sized raise first calls, then
 * raises by the pot that call makes: to = highest bet + (pot + my call).
 */
export function presetsFor(view: PokerView, myBet: number, range: RaiseRange): Preset[] {
  const highest = highestBet(view);
  const potAfterCall = view.pot + Math.max(0, highest - myBet);
  const sized = (fraction: number) => (range.kind === 'bet' ? view.pot * fraction : highest + potAfterCall * fraction);
  return [
    { id: 'min', label: 'Min', amount: range.min },
    { id: 'half', label: '½ pot', amount: clampAmount(Math.floor(sized(0.5)), range) },
    { id: 'pot', label: 'Pot', amount: clampAmount(sized(1), range) },
    { id: 'allIn', label: 'All in', amount: range.max },
  ];
}

/** Drops a preset whose amount an earlier one already offers (Min and ½ pot often agree on a small pot). */
export function uniquePresets(presets: readonly Preset[]): Preset[] {
  return presets.filter((p, i) => presets.findIndex((q) => q.amount === p.amount) === i);
}
