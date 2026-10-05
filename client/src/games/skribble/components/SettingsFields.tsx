import { useEffect, useRef, useState } from 'react';
import { SKRIBBLE_SETTINGS_LIMITS, parseCustomWords, type SkribbleSettings } from '@shared/games/skribble/protocol';
import { RangeSetting, ToggleSetting } from '../../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../../platform/game';

const CUSTOM_WORDS_DEBOUNCE_MS = 500;
/** How long a local custom-words edit outranks the server copy while its echo is in flight. */
const PENDING_EDIT_GRACE_MS = 3000;
const L = SKRIBBLE_SETTINGS_LIMITS;

/** Skribble's rows in the lobby settings panel: rounds, draw time, hints, word choices and the custom word list. */
export function SkribbleSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<SkribbleSettings>) {
  const [customText, setCustomText] = useState(() => settings.customWords.join('\n'));
  const [customFocused, setCustomFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editedAt = useRef<number | null>(null);

  // Keep the textarea in step with the server unless the host is mid-edit or waiting for the
  // echo of an edit they just made.
  useEffect(() => {
    if (customFocused) return;
    const fromServer = settings.customWords.join('\n');
    const local = parseCustomWords(customText).join('\n');
    if (local === fromServer) {
      editedAt.current = null;
      return;
    }
    if (editedAt.current !== null && Date.now() - editedAt.current < PENDING_EDIT_GRACE_MS) return;
    editedAt.current = null;
    setCustomText(fromServer);
  }, [settings.customWords, customFocused, customText]);

  useEffect(
    () => () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
    },
    [],
  );

  const flushCustomWords = (text: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    patch({ customWords: parseCustomWords(text) });
  };

  const onCustomChange = (text: string) => {
    setCustomText(text);
    editedAt.current = Date.now();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flushCustomWords(text), CUSTOM_WORDS_DEBOUNCE_MS);
  };

  const parsedCount = parseCustomWords(customText).length;
  const effectiveCount = canEdit ? parsedCount : settings.customWords.length;
  const canUseOnly = effectiveCount >= L.customWords.minForOnly;
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

      <div className="setting" data-testid="settings-row-customWords">
        <div className="setting__head">
          <label className="setting__label" htmlFor="customWords">
            Custom words
          </label>
          <span className="setting__value" data-testid="settings-customWords-count">
            {effectiveCount} {effectiveCount === 1 ? 'word' : 'words'}
          </span>
        </div>
        {canEdit ? (
          <textarea
            id="customWords"
            className="textarea"
            data-testid="settings-customWords"
            rows={3}
            placeholder="cat, dog, hot dog — comma or newline separated"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            value={customText}
            maxLength={L.customWords.maxCount * (L.customWords.maxLength + 1)}
            onChange={(e) => onCustomChange(e.target.value)}
            onFocus={() => setCustomFocused(true)}
            onBlur={() => {
              setCustomFocused(false);
              if (debounce.current !== null) flushCustomWords(customText);
            }}
          />
        ) : (
          <p className="setting__readonly-words">{settings.customWords.length ? settings.customWords.join(', ') : 'None'}</p>
        )}
      </div>

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
