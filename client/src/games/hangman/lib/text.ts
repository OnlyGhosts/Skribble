import { HANGMAN_SECTIONS, type HangmanOutcome, type HangmanPhase } from '@shared/games/hangman/protocol';

export function sectionName(section: number): string {
  return HANGMAN_SECTIONS[section - 1] ?? `section ${section}`;
}

/** "Section 3 of 10: the beam". */
export function sectionLabel(section: number, maxWrong: number): string {
  return `Section ${section} of ${maxWrong}: the ${sectionName(section)}`;
}

/** The turn summary's headline. */
export function outcomeText(outcome: HangmanOutcome | null, hangmanName: string, solverName: string): string {
  switch (outcome?.kind) {
    case 'solved':
      return `${solverName} solved it!`;
    case 'hangmanWins':
      return `${hangmanName} wins the word!`;
    case 'hangmanLeft':
      return `${hangmanName} left the game.`;
    case 'noGuessers':
      return 'Nobody was left to guess.';
    default:
      return 'Turn over';
  }
}

export function chatPlaceholderFor(phase: HangmanPhase | undefined, myGuess: boolean, participating: boolean): string {
  if (!participating) return "You're watching this one. Chat...";
  if (phase === 'guessing' && myGuess) return 'Chat... (guess with the keys)';
  return 'Chat...';
}

export function livesText(lives: number): string {
  return `${lives} ${lives === 1 ? 'life' : 'lives'} left`;
}
