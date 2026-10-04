/** The engine never names a game: modules come from the registry, keyed by the room's gameId. */
import type { GameId } from '../../../shared/platform/games.js';
import { GAMES } from '../../games/index.js';
import type { AnyGameServerModule } from '../game.js';

export function moduleFor(gameId: GameId): AnyGameServerModule {
  return GAMES[gameId];
}
