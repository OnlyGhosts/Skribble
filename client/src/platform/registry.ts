import type { GameId } from '@shared/platform/games';
import type { AnyGameClientModule } from './game';

/**
 * The game modules the shell can render, installed once at start-up (main.tsx). The platform
 * never imports a game by name; keeping the registry injected also avoids an import cycle
 * between the platform (store, socket) and the games that use it.
 */
let registry: Readonly<Partial<Record<GameId, AnyGameClientModule>>> = {};

export function registerGames(games: Readonly<Record<GameId, AnyGameClientModule>>): void {
  registry = games;
}

export function registeredGame(id: GameId): AnyGameClientModule | null {
  return registry[id] ?? null;
}
