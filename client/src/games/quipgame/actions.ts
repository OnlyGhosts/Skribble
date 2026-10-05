import type { QuipgameChoice } from '@shared/games/quipgame/protocol';
import { socket } from '../../platform/net/socket';

export function submitAnswer(promptId: string, text: string): boolean {
  return socket.send({ t: 'answer', promptId, text });
}

export function castVote(choice: QuipgameChoice): boolean {
  return socket.send({ t: 'vote', choice });
}

export function submitRanking(answerIds: string[]): boolean {
  return socket.send({ t: 'rank', answerIds });
}

/** Host only: skips the rest of a result timer. */
export function skipResult(): void {
  socket.send({ t: 'next' });
}
