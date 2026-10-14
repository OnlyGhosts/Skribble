import { HANGMAN_SETTINGS_LIMITS, parseHangmanCustomWords, type HangmanSettings } from '@shared/games/hangman/protocol';
import { RangeSetting, ToggleSetting, WordListSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = HANGMAN_SETTINGS_LIMITS;

/** Hangman's rows in the lobby settings panel: rounds, the two clocks and the custom word list. */
export function HangmanSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<HangmanSettings>) {
  const canUseOnly = settings.customWords.length >= L.customWords.minForOnly;
  const range = { canEdit, revision: settings };
  return (
    <>
      <RangeSetting
        id="rounds"
        label="Rounds"
        value={settings.rounds}
        min={L.rounds.min}
        max={L.rounds.max}
        onCommit={(v) => patch({ rounds: v })}
        hint="Everyone is the hangman once per round."
        {...range}
      />
      <RangeSetting
        id="guessSeconds"
        label="Guess time in seconds"
        rowLabel="Guess time"
        value={settings.guessSeconds}
        display={`${settings.guessSeconds}s`}
        min={L.guessSeconds.min}
        max={L.guessSeconds.max}
        onCommit={(v) => patch({ guessSeconds: v })}
        hint="How long each guesser has for a letter or the word."
        {...range}
      />
      <RangeSetting
        id="drawSeconds"
        label="Draw time in seconds"
        rowLabel="Draw time"
        value={settings.drawSeconds}
        display={`${settings.drawSeconds}s`}
        min={L.drawSeconds.min}
        max={L.drawSeconds.max}
        onCommit={(v) => patch({ drawSeconds: v })}
        hint="How long the hangman has to draw each piece after a wrong guess."
        {...range}
      />
      <WordListSetting
        id="customWords"
        label="Custom words"
        words={settings.customWords}
        canEdit={canEdit}
        parse={parseHangmanCustomWords}
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
