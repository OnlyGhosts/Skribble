import type { QuipgameChoice } from '@shared/games/quipgame/protocol';
import { socket } from '../../platform/net/socket';
import { quipgameSounds } from './sounds';

export function submitAnswer(promptId: string, text: string): boolean {
  const sent = socket.send({ t: 'answer', promptId, text });
  if (sent) quipgameSounds.play('answer');
  return sent;
}

export function castVote(choice: QuipgameChoice): boolean {
  const sent = socket.send({ t: 'vote', choice });
  if (sent) quipgameSounds.play('vote');
  return sent;
}

export function submitRanking(answerIds: string[]): boolean {
  const sent = socket.send({ t: 'rank', answerIds });
  if (sent) quipgameSounds.play('vote');
  return sent;
}

/** Host only: skips the rest of a result timer. */
export function skipResult(): void {
  socket.send({ t: 'next' });
}
