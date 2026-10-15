/**
 * Pure helpers for the party: who is ready for the next game, whether the host may start, and
 * how the podium reads for each player. Shared by the lobby, the podium and their tests.
 */
import type { GameMeta } from '@shared/platform/games';
import type { PlayerPublic, PodiumEntry, RoomState } from '@shared/platform/protocol';

/** "3+ players" for a game that seats any number, "2 to 23 players" with a seat limit. */
export function playerCountLabel(meta: GameMeta): string {
  if (meta.maxPlayers === null) return `${meta.minPlayers}+ players`;
  if (meta.maxPlayers === meta.minPlayers) return `${meta.minPlayers} players`;
  return `${meta.minPlayers} to ${meta.maxPlayers} players`;
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Players who could play the next game: connected and not sitting out. */
export function eligiblePlayers(room: RoomState): PlayerPublic[] {
  return room.players.filter((p) => p.connected && !p.sittingOut);
}

/** The server seats the host by their pressing Start, so the host counts as ready unless sitting out. */
export function isReady(player: PlayerPublic): boolean {
  return player.ready || (player.isHost && !player.sittingOut);
}

export function readyPlayers(room: RoomState): PlayerPublic[] {
  return eligiblePlayers(room).filter(isReady);
}

/** Eligible players who have not readied up: a start now would sit them out. */
export function notReadyPlayers(room: RoomState): PlayerPublic[] {
  return eligiblePlayers(room).filter((p) => !isReady(p));
}

export function canStart(room: RoomState, meta: GameMeta): boolean {
  return readyPlayers(room).length >= meta.minPlayers;
}

/** "2 of 4 ready" */
export function readyLine(room: RoomState): string {
  return `${readyPlayers(room).length} of ${eligiblePlayers(room).length} ready`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Podium entries ranked first (ties share the rank), best score first. */
export function podiumOrder(room: RoomState): PodiumEntry[] {
  return (room.podium ?? []).slice().sort((a, b) => a.rank - b.rank || b.score - a.score);
}

export function winners(room: RoomState): PodiumEntry[] {
  return podiumOrder(room).filter((e) => e.rank === 1);
}

function nameOf(room: RoomState, playerId: string): string {
  return room.players.find((p) => p.id === playerId)?.name ?? 'Someone';
}

/** "Alice wins!", "Alice and Bob tie!", or a thank-you when nobody is on the podium. */
export function winnerHeadline(room: RoomState): string {
  const top = winners(room);
  if (top.length === 0) return 'Thanks for playing!';
  if (top.length === 1) return `${nameOf(room, top[0].playerId)} wins!`;
  return `${listNames(top.map((e) => nameOf(room, e.playerId)))} tie!`;
}

/** What the podium says to this player: "You won!", "You came 2nd", or null for someone who sat the game out. */
export function placeLine(room: RoomState, meId: string | null): string | null {
  if (meId === null) return null;
  const mine = podiumOrder(room).find((e) => e.playerId === meId);
  if (!mine) return null;
  if (mine.rank === 1) return winners(room).length > 1 ? 'You tied for the win!' : 'You won!';
  return `You came ${ordinal(mine.rank)}`;
}
