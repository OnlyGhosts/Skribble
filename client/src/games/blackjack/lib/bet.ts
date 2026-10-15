/** The bet field's arithmetic: the window a seat may stake in, the remembered amount and the 1/2, 2x and MAX buttons. */

export interface BetWindow {
  /** Always 1: there is no table minimum. */
  min: number;
  /** The whole stack, the stake already down included: there is no table maximum either. */
  max: number;
}

/** The window for a seat with `chips` behind and `staked` already down; null with no chips at all. */
export function betWindow(chips: number, staked: number): BetWindow | null {
  const max = chips + staked;
  return max >= 1 ? { min: 1, max } : null;
}

/** The amount offered before a player has bet on this device: a hundredth of the starting stack, at least 1 chip. */
export function suggestedBet(startingChips: number): number {
  return Math.max(1, Math.floor(startingChips / 100));
}

export function clampBet(amount: number, w: BetWindow): number {
  if (!Number.isFinite(amount)) return w.min;
  return Math.max(w.min, Math.min(w.max, Math.round(amount)));
}

/** A typed amount as a whole number of chips, or null for a blank or unreadable field. */
export function parseBet(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n > 0 ? n : null;
}

/** The amount the field starts from: the last bet placed on this device, else `suggested`, clamped to the window. */
export function defaultBet(lastBet: number | null, w: BetWindow, suggested: number = w.min): number {
  return clampBet(lastBet ?? suggested, w);
}

/** What the Bet button sends for the field's text: clamped into the window, or null when the field is blank. */
export function betAmount(text: string, w: BetWindow): number | null {
  const n = parseBet(text);
  return n === null ? null : clampBet(n, w);
}

export const halfBet = (amount: number, w: BetWindow): number => clampBet(Math.floor(amount / 2), w);
export const doubleBet = (amount: number, w: BetWindow): number => clampBet(amount * 2, w);
