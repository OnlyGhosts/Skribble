/**
 * Poker's client module. The table screen arrives with the client phase; until then the platform
 * shell renders this placeholder so the registry, the lobby picker and the podium already work.
 */
import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { PokerScreen } from './Screen';

export const pokerClient = defineGameClient<PokerView, PokerSettings>({
  meta: gameById('poker'),
  Screen: PokerScreen,
});
