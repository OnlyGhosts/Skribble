import type { TurnEndReason } from '@shared/games/scribble/protocol';
import { WATCHING_TEXT } from '../../../platform/lib/watching';

export function turnEndReasonText(reason: TurnEndReason, drawerName: string): string {
  switch (reason) {
    case 'allGuessed':
      return 'Everyone guessed it!';
    case 'timeUp':
      return "Time's up!";
    case 'drawerLeft':
      return `${drawerName} left or lost connection, so the turn was skipped.`;
    case 'noWordChosen':
      return `${drawerName} didn't pick a word in time.`;
  }
}

/** Letter counts per word, e.g. "ice cream" -> "3 5". */
export function letterCounts(mask: string): string {
  return mask
    .split(' ')
    .filter(Boolean)
    .map((w) => String(w.replace(/-/g, '').length))
    .join(' ');
}

/** The line under the guess feed for anyone not typing a guess right now. */
export function guessBoxLine(phaseKind: string | undefined, isDrawer: boolean, hasGuessed: boolean, participating = true): string {
  if (!participating) return WATCHING_TEXT;
  if (phaseKind === 'choosing') return isDrawer ? 'Pick a word to draw' : 'Get ready to guess';
  if (phaseKind === 'turnEnd') return 'Next turn soon';
  if (phaseKind !== 'drawing') return 'Game over';
  if (isDrawer) return 'Guesses show up here';
  return hasGuessed ? 'You got it! Others are still guessing' : 'Type your guess';
}
