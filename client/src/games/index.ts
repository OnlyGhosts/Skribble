/** Every game the client can render, keyed by GameId; installed into the platform shell by main.tsx. */
import type { GameId } from '@shared/platform/games';
import type { AnyGameClientModule } from '../platform/game';
import { blackjackClient } from './blackjack/module';
import { pokerClient } from './poker/module';
import { quipgameClient } from './quipgame/module';
import { scribbleClient } from './scribble/module';
import { spygameClient } from './spygame/module';
import { templateClient } from './template/module';

export const GAMES: Readonly<Record<GameId, AnyGameClientModule>> = {
  scribble: scribbleClient,
  quipgame: quipgameClient,
  spygame: spygameClient,
  blackjack: blackjackClient,
  poker: pokerClient,
  template: templateClient,
};
