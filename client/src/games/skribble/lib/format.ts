import type { TurnEndReason } from '@shared/games/skribble/protocol';

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

export function placeholderFor(phaseKind: string | undefined, isDrawer: boolean, hasGuessed: boolean, participating = true): string {
  if (phaseKind !== 'drawing') return 'Chat...';
  // A spectator's lines are plain chat, never guesses.
  if (!participating) return "You're watching this one. Chat...";
  // The server delivers the drawer's lines to players who already know the word only.
  if (isDrawer) return 'Chat with players who guessed...';
  return hasGuessed ? 'Chat with players who guessed...' : 'Type your guess...';
}
