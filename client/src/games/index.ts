/** Every game the client can render, keyed by GameId; installed into the platform shell by main.tsx. */
import type { GameId } from '@shared/platform/games';
import type { AnyGameClientModule } from '../platform/game';
import { skribbleClient } from './skribble/module';
import { templateClient } from './template/module';

export const GAMES: Readonly<Record<GameId, AnyGameClientModule>> = {
  skribble: skribbleClient,
  template: templateClient,
};
