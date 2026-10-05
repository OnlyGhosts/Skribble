/** Every game the server can run, keyed by GameId. The platform engine resolves modules from here. */
import type { GameId } from '../../shared/platform/games.js';
import type { AnyGameServerModule } from '../platform/game.js';
import { quipgameModule } from './quipgame/module.js';
import { skribbleModule } from './skribble/module.js';
import { spygameModule } from './spygame/module.js';
import { templateModule } from './template/module.js';

export const GAMES: Readonly<Record<GameId, AnyGameServerModule>> = {
  skribble: skribbleModule,
  spygame: spygameModule,
  quipgame: quipgameModule,
  template: templateModule,
};
