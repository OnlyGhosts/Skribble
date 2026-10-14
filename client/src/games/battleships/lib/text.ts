import { cellLabel } from '@shared/games/battleships/fleet';
import type { BattleshipsPhase, ShotEvent } from '@shared/games/battleships/protocol';

/** "B4: hit" style summary of a shot, for the log. */
export function shotSummary(shot: ShotEvent): string {
  const where = cellLabel(shot.x, shot.y);
  switch (shot.result) {
    case 'miss':
      return `${where}: miss`;
    case 'hit':
      return `${where}: hit!`;
    case 'sunk':
      return `${where}: sunk a ${shot.length ?? '?'}-ship!`;
  }
}

/** The toast for a roll that opens a move window; lower rolls only show in the dice pill and the log. */
export function diceText(shooter: string, dice: number): string {
  return `${shooter} rolled a ${dice} — a ship may slip away!`;
}

/** The shot counter in the top bar: the narrowest phones get a number, not a word. */
export function turnKicker(phase: BattleshipsPhase, turnNumber: number, narrow: boolean, phone: boolean): string {
  if (phase === 'placing') return phone ? 'Placing' : 'Placing fleets';
  return narrow ? `#${turnNumber}` : `Shot ${turnNumber}`;
}

export function chatPlaceholderFor(phase: BattleshipsPhase | undefined, myTurn: boolean, watching: boolean): string | undefined {
  if (phase === undefined) return undefined;
  if (watching) return 'Watching the battle… say something';
  if (phase === 'placing') return 'Say something while the fleets line up…';
  if (myTurn) return 'Call your shot on the grid, or talk big here…';
  return 'Talk big here…';
}
