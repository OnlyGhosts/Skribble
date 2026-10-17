import type { GameRules } from '../game';

export type RulesSectionKey = 'round' | 'scoring' | 'end' | 'settings' | 'watchers';

export interface RulesSection {
  key: RulesSectionKey;
  heading: string;
  text: string;
}

/** The five sections of a How to play card, in reading order, with the headings every game shares. */
export function rulesSections(rules: GameRules): RulesSection[] {
  return [
    { key: 'round', heading: rules.unit === 'hand' ? 'How a hand goes' : 'How a round goes', text: rules.round },
    { key: 'scoring', heading: 'How you score', text: rules.scoring },
    { key: 'end', heading: 'How it ends', text: rules.end },
    { key: 'settings', heading: 'What the settings change', text: rules.settings },
    { key: 'watchers', heading: 'Watching', text: rules.watchers },
  ];
}

/** "Join mid-game and you watch until the next game.": what the platform does for every game. */
export const JOIN_MID_GAME_TEXT = 'Join mid-game and you watch until the next game.';
