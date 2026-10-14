import { SKRIBBLE_SETTINGS_LIMITS, parseCustomWords, type SkribbleSettings } from '@shared/games/skribble/protocol';
import { RangeSetting, ToggleSetting, WordListSetting } from '../../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../../platform/game';

const L = SKRIBBLE_SETTINGS_LIMITS;

/** Skribble's rows in the lobby settings panel: rounds, draw time, hints, word choices and the custom word list. */
export function SkribbleSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<SkribbleSettings>) {
  const canUseOnly = settings.customWords.length >= L.customWords.minForOnly;
  const range = { canEdit, revision: settings };

  return (
    <>
      <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} hint="Everyone draws once per round." {...range} />
      <RangeSetting
        id="drawTime"
        label="Draw time in seconds"
        rowLabel="Draw time"
        value={settings.drawTime}
        display={`${settings.drawTime}s`}
        min={L.drawTime.min}
        max={L.drawTime.max}
        step={L.drawTime.step}
        onCommit={(v) => patch({ drawTime: v })}
        {...range}
      />
      <RangeSetting
        id="hints"
        label="Letter hints per word"
        rowLabel="Hints"
        value={settings.hints}
        display={settings.hints === 0 ? 'none' : String(settings.hints)}
        min={L.hints.min}
        max={L.hints.max}
        onCommit={(v) => patch({ hints: v })}
        hint="Letters revealed over the turn (never more than half the word)."
        {...range}
      />
      <RangeSetting
        id="wordChoices"
        label="Words to choose from"
        rowLabel="Word choices"
        value={settings.wordChoices}
        min={L.wordChoices.min}
        max={L.wordChoices.max}
        onCommit={(v) => patch({ wordChoices: v })}
        {...range}
      />
      <WordListSetting
        id="customWords"
        label="Custom words"
        words={settings.customWords}
        canEdit={canEdit}
        parse={parseCustomWords}
        onCommit={(customWords) => patch({ customWords })}
        placeholder="cat, dog, hot dog (comma or new line)"
        maxLength={L.customWords.maxCount * (L.customWords.maxLength + 1)}
      />
      <ToggleSetting
        id="customWordsOnly"
        checked={settings.customWordsOnly}
        disabled={!canEdit || !canUseOnly}
        onChange={(v) => patch({ customWordsOnly: v })}
        label="Use custom words only"
        hint={canUseOnly ? undefined : `Add at least ${L.customWords.minForOnly} custom words to enable this.`}
      />
    </>
  );
}
