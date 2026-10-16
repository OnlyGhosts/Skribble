import { SCRIBBLE_SETTINGS_LIMITS, parseCustomWords, type ScribbleSettings } from '@shared/games/scribble/protocol';
import { splitWordList } from '@shared/platform/words';
import { RangeSetting, ToggleSetting, WordListSetting } from '../../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../../platform/game';

const L = SCRIBBLE_SETTINGS_LIMITS;

/** Scribble's rows in the lobby settings panel: rounds, hints, word choices and the custom word list. The draw time is fixed. */
export function ScribbleSettingsFields({ settings, patch }: SettingsFieldsProps<ScribbleSettings>) {
  const canUseOnly = settings.customWords.length >= L.customWords.minForOnly;
  const range = { revision: settings };

  return (
    <>
      <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} hint="Everyone draws once per round." {...range} />
      <RangeSetting
        id="hints"
        label="Letter hints per word"
        rowLabel="Hints"
        value={settings.hints}
        format={(v) => (v === 0 ? 'None' : String(v))}
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
        parse={parseCustomWords}
        split={splitWordList}
        onCommit={(customWords) => patch({ customWords })}
        placeholder="cat, dog, hot dog (comma or new line)"
        maxLength={L.customWords.maxCount * (L.customWords.maxLength + 1)}
      />
      <ToggleSetting
        id="customWordsOnly"
        checked={settings.customWordsOnly}
        disabled={!canUseOnly}
        onChange={(v) => patch({ customWordsOnly: v })}
        label="Use custom words only"
        hint={canUseOnly ? undefined : `Add at least ${L.customWords.minForOnly} custom words to enable this.`}
      />
    </>
  );
}
