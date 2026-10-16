import { QUIPGAME_SETTINGS_LIMITS, parseCustomPrompts, splitCustomPrompts, type QuipgameSettings } from '@shared/games/quipgame/protocol';
import { ToggleSetting, WordListSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = QUIPGAME_SETTINGS_LIMITS;
const PROMPTS = { one: 'prompt', many: 'prompts' };

/**
 * Quip Game's rows in the lobby settings panel: the custom prompt list. The clocks are fixed, and
 * every game has the final round and an announcer.
 */
export function QuipgameSettingsFields({ settings, patch }: SettingsFieldsProps<QuipgameSettings>) {
  const canUseOnly = settings.customPrompts.length >= L.customPrompts.minForOnly;
  return (
    <>
      <WordListSetting
        id="customPrompts"
        label="Custom prompts"
        words={settings.customPrompts}
        parse={parseCustomPrompts}
        split={splitCustomPrompts}
        onCommit={(customPrompts) => patch({ customPrompts })}
        placeholder={'One prompt per line, e.g.\nThe worst thing to find in your sandwich'}
        maxLength={L.customPrompts.maxCount * (L.customPrompts.maxLength + 1)}
        noun={PROMPTS}
        autoCapitalize="sentences"
      />

      <ToggleSetting
        id="customPromptsOnly"
        checked={settings.customPromptsOnly}
        disabled={!canUseOnly}
        onChange={(v) => patch({ customPromptsOnly: v })}
        label="Use custom prompts only"
        hint={canUseOnly ? undefined : `Add at least ${L.customPrompts.minForOnly} custom prompts to enable this.`}
      />
    </>
  );
}
