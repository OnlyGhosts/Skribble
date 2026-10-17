/**
 * Click Race: the template client module. Copy this folder for a new game. The platform renders
 * the front door, the room, players and the results; a module only needs a Screen (and,
 * optionally, settings rows and the hooks listed in platform/game.ts).
 */
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { ClickRaceArt } from './art';
import { templateRules } from './rules';
import { ClickRaceScreen } from './Screen';
import { ClickRaceSettingsFields } from './SettingsFields';
import './template.css';

export const templateClient = defineGameClient<TemplateView, TemplateSettings>({
  meta: gameById('template'),
  Screen: ClickRaceScreen,
  rules: templateRules,
  Art: ClickRaceArt,
  SettingsFields: ClickRaceSettingsFields,
});
