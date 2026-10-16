import type { PlayerPublic } from '@shared/platform/protocol';

/**
 * The line every game shows a spectator of the whole game: someone who sat it out or joined it
 * mid-way. They play from the next game on (a sit-out player once they count back in).
 */
export const WATCHING_TEXT = "You're watching. You can play the next game.";

/** True when I watch the running game rather than play in it (the platform's spectators). */
export function isWatching(players: readonly Pick<PlayerPublic, 'id' | 'participating'>[], meId: string): boolean {
  return players.find((p) => p.id === meId)?.participating !== true;
}
