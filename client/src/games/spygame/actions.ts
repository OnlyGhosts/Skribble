import { socket } from '../../platform/net/socket';

export function guessLocation(locationId: string): void {
  socket.send({ t: 'guess', locationId });
}

export function accusePlayer(playerId: string): void {
  socket.send({ t: 'accuse', playerId });
}

export function castVote(yes: boolean): void {
  socket.send({ t: 'vote', yes });
}

/** Host only: skips the rest of the reveal. */
export function skipReveal(): void {
  socket.send({ t: 'nextRound' });
}

/** Host only, from the reveal: back to the lobby. */
export function endGame(): void {
  socket.send({ t: 'endGame' });
}
