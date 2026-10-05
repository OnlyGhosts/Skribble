import { outcomeWinner, type SpygameOutcome, type SpygamePhase, type SpygameRole } from '@shared/games/spygame/protocol';

export function winnerKicker(outcome: SpygameOutcome): string {
  return outcomeWinner(outcome) === 'spy' ? 'The spy wins the round' : 'The agents win the round';
}

export function outcomeHeadline(outcome: SpygameOutcome): string {
  switch (outcome) {
    case 'spyGuessed':
      return 'The spy found the location!';
    case 'spyWrong':
      return 'The spy guessed wrong twice';
    case 'spyCaught':
      return 'The spy was caught!';
    case 'wrongAccusation':
      return 'Wrong accusation!';
    case 'timeUp':
      return "Time's up!";
    case 'spyLeft':
      return 'The spy left the room';
  }
}

/** The one-line story of the round for the reveal. */
export function outcomeDetail(outcome: SpygameOutcome, spyName: string, locationName: string): string {
  switch (outcome) {
    case 'spyGuessed':
      return `${spyName} named the ${locationName} before anyone caught on.`;
    case 'spyWrong':
      return `${spyName} ran out of guesses. It was the ${locationName}.`;
    case 'spyCaught':
      return `The vote passed and ${spyName} was the spy. It was the ${locationName}.`;
    case 'wrongAccusation':
      return `The vote passed on the wrong player. ${spyName} slips away from the ${locationName}.`;
    case 'timeUp':
      return `The clock ran out and ${spyName} never found the ${locationName}.`;
    case 'spyLeft':
      return `${spyName} left mid-round. It was the ${locationName}.`;
  }
}

export function guessesLeftText(n: number): string {
  return n === 1 ? '1 guess left' : `${n} guesses left`;
}

export function wrongGuessNotice(guessesLeft: number): string {
  return `The spy guessed wrong — ${guessesLeftText(guessesLeft)}`;
}

export function waitingNotice(spyName: string): string {
  return `Clock paused — waiting for ${spyName} to come back`;
}

/** The toast for those who get no vote sheet: the spy, spectators and the accused. */
export function voteNotice(accuserName: string, accusedName: string, meAccused: boolean): string {
  return meAccused ? `${accuserName} accuses you of being the spy! The others are voting.` : `${accuserName} accuses ${accusedName} of being the spy — vote now`;
}

export function chatPlaceholderFor(role: SpygameRole, phase: SpygamePhase): string {
  if (phase === 'reveal') return 'Well played? Say so…';
  if (role === 'spy') return 'Blend in… (ask out loud)';
  if (role === 'spectator') return 'Watching — chat with the room';
  return 'Ask your questions out loud…';
}
