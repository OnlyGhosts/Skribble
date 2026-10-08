/**
 * Holding for disconnected players, shared by the games that pause at a boundary (next turn, next
 * round) while seated players are away. The platform renders the hold as RoomState.waiting; the
 * game keeps its own holding state and resumes when enough players are connected again.
 */
import type { GameEffect, PlatformPlayer } from '../platform/game.js';

/**
 * How long a held game waits after enough players are back before it goes on. Hosting cuts every
 * socket of a room at the same instant and the clients reconnect at once, in any order: starting
 * the round on the very reconnect that reaches the minimum would seat it without the stragglers.
 * Every further reconnect (or join) during the settle restarts it.
 */
export const RESUME_SETTLE_MS = 2000;

/** Seated players whose socket is down: the ones a held game waits for, in join order. */
export function missingPlayers(players: PlatformPlayer[]): PlatformPlayer[] {
  return players.filter((p) => !p.connected);
}

/**
 * The effects of entering or refreshing a hold: the platform's waiting state, a chat line the
 * first time (`fresh`) and a snapshot so everyone sees the hold at once (a tick carries none).
 * None of them carries a game message, so they fit any game's effect list.
 */
export function holdEffects(players: PlatformPlayer[], fresh: boolean): GameEffect<never>[] {
  const missing = missingPlayers(players);
  const effects: GameEffect<never>[] = [{ type: 'waiting', missing: missing.map((p) => p.id) }];
  if (fresh) effects.push({ type: 'chat', to: 'all', kind: 'system', text: `Waiting for ${missing.map((p) => p.name).join(', ')} to reconnect…` });
  effects.push({ type: 'snapshot', to: 'all' });
  return effects;
}

/** The effect that ends a hold; the game's own snapshot of whatever comes next follows it. */
export function resumeEffect(): GameEffect<never> {
  return { type: 'waiting', missing: null };
}
