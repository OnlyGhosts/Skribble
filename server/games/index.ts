/** Every game the server can run, keyed by GameId. The platform engine resolves modules from here. */
import type { GameId } from '../../shared/platform/games.js';
import type { AnyGameServerModule } from '../platform/game.js';
import { blackjackModule } from './blackjack/module.js';
import { pokerModule } from './poker/module.js';
import { quipgameModule } from './quipgame/module.js';
import { scribbleModule } from './scribble/module.js';
import { spygameModule } from './spygame/module.js';
import { templateModule } from './template/module.js';

export const GAMES: Readonly<Record<GameId, AnyGameServerModule>> = {
  scribble: scribbleModule,
  spygame: spygameModule,
  quipgame: quipgameModule,
  blackjack: blackjackModule,
  poker: pokerModule,
  template: templateModule,
};
