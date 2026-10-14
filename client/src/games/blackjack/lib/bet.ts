/** The bet field's arithmetic: the window a seat may stake in, the remembered amount and the 1/2, 2x and MAX buttons. */

export interface BetWindow {
  min: number;
  /** The table maximum or what the player holds, whichever is less (their stake down included). */
  max: number;
}

/** The window for a seat with `chips` behind and `staked` already down; null when even the minimum is out of reach. */
export function betWindow(minBet: number, maxBet: number, chips: number, staked: number): BetWindow | null {
  const max = Math.min(maxBet, chips + staked);
  return max >= minBet ? { min: minBet, max } : null;
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

/** The amount the field starts from: the last bet placed on this device, else the minimum, clamped to the window. */
export function defaultBet(lastBet: number | null, w: BetWindow): number {
  return clampBet(lastBet ?? w.min, w);
}

/** What the Bet button sends for the field's text: clamped into the window, or null when the field is blank. */
export function betAmount(text: string, w: BetWindow): number | null {
  const n = parseBet(text);
  return n === null ? null : clampBet(n, w);
}

export const halfBet = (amount: number, w: BetWindow): number => clampBet(Math.floor(amount / 2), w);
export const doubleBet = (amount: number, w: BetWindow): number => clampBet(amount * 2, w);
