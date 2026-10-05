import { useEffect, useRef, useState } from 'react';
import { QUIPGAME_SETTINGS_LIMITS, parseCustomPrompts, type QuipgameSettings } from '@shared/games/quipgame/protocol';
import { RangeSetting, ToggleSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const CUSTOM_DEBOUNCE_MS = 500;
/** How long a local custom-prompts edit outranks the server copy while its echo is in flight. */
const PENDING_EDIT_GRACE_MS = 3000;
const L = QUIPGAME_SETTINGS_LIMITS;

/** Quip Game's rows in the lobby settings panel: the three clocks, the toggles and the custom prompt list. */
export function QuipgameSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<QuipgameSettings>) {
  const [customText, setCustomText] = useState(() => settings.customPrompts.join('\n'));
  const [customFocused, setCustomFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editedAt = useRef<number | null>(null);

  // Keep the textarea in step with the server unless the host is mid-edit or waiting for the echo of an edit they just made.
  useEffect(() => {
    if (customFocused) return;
    const fromServer = settings.customPrompts.join('\n');
    const local = parseCustomPrompts(customText).join('\n');
    if (local === fromServer) {
      editedAt.current = null;
      return;
    }
    if (editedAt.current !== null && Date.now() - editedAt.current < PENDING_EDIT_GRACE_MS) return;
    editedAt.current = null;
    setCustomText(fromServer);
  }, [settings.customPrompts, customFocused, customText]);

  useEffect(
    () => () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
    },
    [],
  );

  const flushCustom = (text: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    patch({ customPrompts: parseCustomPrompts(text) });
  };

  const onCustomChange = (text: string) => {
    setCustomText(text);
    editedAt.current = Date.now();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flushCustom(text), CUSTOM_DEBOUNCE_MS);
  };

  const effectiveCount = canEdit ? parseCustomPrompts(customText).length : settings.customPrompts.length;
  const canUseOnly = effectiveCount >= L.customPrompts.minForOnly;
  const range = { canEdit, revision: settings };

  return (
    <>
      <RangeSetting
        id="writeSeconds"
        label="Writing time in seconds"
        rowLabel="Writing time"
        value={settings.writeSeconds}
        display={`${settings.writeSeconds}s`}
        min={L.writeSeconds.min}
        max={L.writeSeconds.max}
        step={L.writeSeconds.step}
        onCommit={(v) => patch({ writeSeconds: v })}
        hint="Time to write both answers; anyone who runs out gets a stand-in answer."
        {...range}
      />
      <RangeSetting
        id="voteSeconds"
        label="Voting time in seconds"
        rowLabel="Voting time"
        value={settings.voteSeconds}
        display={`${settings.voteSeconds}s`}
        min={L.voteSeconds.min}
        max={L.voteSeconds.max}
        step={L.voteSeconds.step}
        onCommit={(v) => patch({ voteSeconds: v })}
        {...range}
      />
      <RangeSetting
        id="resultsSeconds"
        label="Results time in seconds"
        rowLabel="Results time"
        value={settings.resultsSeconds}
        display={`${settings.resultsSeconds}s`}
        min={L.resultsSeconds.min}
        max={L.resultsSeconds.max}
        onCommit={(v) => patch({ resultsSeconds: v })}
        hint="The host can skip ahead at any time."
        {...range}
      />
      <ToggleSetting id="cheeky" checked={settings.cheeky} disabled={!canEdit} onChange={(v) => patch({ cheeky: v })} label="Cheeky prompts" hint="Adult humour: innuendo and embarrassment. Keep it off for kids." />
      <ToggleSetting id="finalRound" checked={settings.finalRound} disabled={!canEdit} onChange={(v) => patch({ finalRound: v })} label="Final round" hint="A third round: one prompt for everyone, then everyone ranks the answers." />
      <ToggleSetting id="announcer" checked={settings.announcer} disabled={!canEdit} onChange={(v) => patch({ announcer: v })} label="Announcer" hint="One player per matchup is asked to read the prompt and answers out loud." />

      <div className="setting" data-testid="settings-row-customPrompts">
        <div className="setting__head">
          <label className="setting__label" htmlFor="customPrompts">
            Custom prompts
          </label>
          <span className="setting__value" data-testid="settings-customPrompts-count">
            {effectiveCount} {effectiveCount === 1 ? 'prompt' : 'prompts'}
          </span>
        </div>
        {canEdit ? (
          <textarea
            id="customPrompts"
            className="textarea"
            data-testid="settings-customPrompts"
            rows={3}
            placeholder={'One prompt per line, e.g.\nThe worst thing to find in your sandwich'}
            autoCapitalize="sentences"
            autoComplete="off"
            value={customText}
            maxLength={L.customPrompts.maxCount * (L.customPrompts.maxLength + 1)}
            onChange={(e) => onCustomChange(e.target.value)}
            onFocus={() => setCustomFocused(true)}
            onBlur={() => {
              setCustomFocused(false);
              if (debounce.current !== null) flushCustom(customText);
            }}
          />
        ) : (
          <p className="setting__readonly-words">{settings.customPrompts.length ? settings.customPrompts.join(' · ') : 'None'}</p>
        )}
      </div>

      <ToggleSetting
        id="customPromptsOnly"
        checked={settings.customPromptsOnly}
        disabled={!canEdit || !canUseOnly}
        onChange={(v) => patch({ customPromptsOnly: v })}
        label="Use custom prompts only"
        hint={canUseOnly ? undefined : `Add at least ${L.customPrompts.minForOnly} custom prompts to enable this.`}
      />
    </>
  );
}
