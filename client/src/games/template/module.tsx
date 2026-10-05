/**
 * Click Race: the template client module. Copy this folder for a new game. The platform renders
 * the library card, the game home, the lobby, chat, players and the podium; a module only needs
 * a Screen (and, optionally, settings rows and the hooks listed in platform/game.ts).
 */
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { ClickRaceScreen } from './Screen';
import { ClickRaceSettingsFields } from './SettingsFields';
import './template.css';

export const templateClient = defineGameClient<TemplateView, TemplateSettings>({
  meta: gameById('template'),
  Screen: ClickRaceScreen,
  SettingsFields: ClickRaceSettingsFields,
});
