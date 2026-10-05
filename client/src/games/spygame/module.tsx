/**
 * The Spy Game's client module. Phase 1 ships the server rules with this placeholder screen so the
 * registry stays complete; the real screen, settings rows and location tiles follow.
 */
import type { SpygameSettings, SpygameView } from '@shared/games/spygame/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { SpyGameScreen } from './Screen';

export const spygameClient = defineGameClient<SpygameView, SpygameSettings>({
  meta: gameById('spygame'),
  Screen: SpyGameScreen,
});
