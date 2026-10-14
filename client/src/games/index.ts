/** Every game the client can render, keyed by GameId; installed into the platform shell by main.tsx. */
import type { GameId } from '@shared/platform/games';
import type { AnyGameClientModule } from '../platform/game';
import { battleshipsClient } from './battleships/module';
import { hangmanClient } from './hangman/module';
import { quipgameClient } from './quipgame/module';
import { skribbleClient } from './skribble/module';
import { spygameClient } from './spygame/module';
import { templateClient } from './template/module';

export const GAMES: Readonly<Record<GameId, AnyGameClientModule>> = {
  skribble: skribbleClient,
  quipgame: quipgameClient,
  spygame: spygameClient,
  hangman: hangmanClient,
  battleships: battleshipsClient,
  template: templateClient,
};
