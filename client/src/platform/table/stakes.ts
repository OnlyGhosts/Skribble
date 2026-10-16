/**
 * The two numbers every card table shows for a player, worded so they are never confused: the
 * stack as "1,000 chips" and the stake as "Bet 10" (Poker's middle as "Pot 120"). Pure, for the
 * labels and the tests.
 */
import { formatChips, shortChips } from '../lib/format';

/**
 * How a number is written: in full ("1,500"), short for a small tile ("1.5k"), or `fit`: in full,
 * swapped for the short form only where the tile is too narrow for it (Stakes.tsx, table.css).
 */
export type StakeFormat = 'full' | 'short' | 'fit';

/** The figure as text: `fit` reads in full (a label, an aria line). */
export function chipFigure(n: number, format: StakeFormat = 'full'): string {
  return format === 'short' ? shortChips(n) : formatChips(n);
}

/** "1,000 chips", "1 chip", "0 chips". */
export function stackText(n: number, format: StakeFormat = 'full'): string {
  return `${chipFigure(n, format)} ${n === 1 ? 'chip' : 'chips'}`;
}

/** "Bet 10", or with another word: "Pot 120", "Raise 40". */
export function stakeText(n: number, word = 'Bet', format: StakeFormat = 'full'): string {
  return `${word} ${chipFigure(n, format)}`;
}
