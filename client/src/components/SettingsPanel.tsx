import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SETTINGS_LIMITS, parseCustomWords, type RoomSettings, type RoomSettingsPatch } from '@shared/settings';
import { updateSettings } from '../net/actions';

interface Props {
  settings: RoomSettings;
  isHost: boolean;
}

const CUSTOM_WORDS_DEBOUNCE_MS = 500;
const RANGE_DEBOUNCE_MS = 150;
/** How long a local custom-words edit outranks the server copy while its echo is in flight. */
const PENDING_EDIT_GRACE_MS = 3000;

function Row({ label, hint, control, testId, value }: { label: string; hint?: string; control?: ReactNode; testId: string; value: string }) {
  return (
    <div className="setting" data-testid={`settings-row-${testId}`}>
      <div className="setting__head">
        <span className="setting__label">{label}</span>
        <span className="setting__value" data-testid={`settings-value-${testId}`}>
          {value}
        </span>
      </div>
      {control}
      {hint && <p className="setting__hint">{hint}</p>}
    </div>
  );
}

interface RangeProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit(v: number): void;
  label: string;
}

/** Range input that tracks the drag immediately but sends at most one patch per short pause. */
function RangeControl({ id, value, min, max, step = 1, onCommit, label }: RangeProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setLocal(value), [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <input
      id={id}
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={local}
      aria-label={label}
      aria-valuetext={String(local)}
      data-testid={`settings-${id}`}
      onChange={(e) => {
        const v = Number(e.target.value);
        setLocal(v);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          onCommit(v);
        }, RANGE_DEBOUNCE_MS);
      }}
    />
  );
}

export function SettingsPanel({ settings, isHost }: Props) {
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

  const send = (patch: RoomSettingsPatch) => {
    if (isHost) updateSettings(patch);
  };

  const flushCustomWords = (text: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    send({ customWords: parseCustomWords(text) });
  };

  const onCustomChange = (text: string) => {
    setCustomText(text);
    editedAt.current = Date.now();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flushCustomWords(text), CUSTOM_WORDS_DEBOUNCE_MS);
  };

  const parsedCount = parseCustomWords(customText).length;
  const effectiveCount = isHost ? parsedCount : settings.customWords.length;
  const canUseOnly = effectiveCount >= SETTINGS_LIMITS.customWords.minForOnly;
  const L = SETTINGS_LIMITS;

  return (
    <div className={`settings${isHost ? '' : ' settings--readonly'}`} data-testid="settings-panel">
      {!isHost && <p className="settings__note">Only the host can change settings.</p>}

      <Row
        label="Rounds"
        testId="rounds"
        value={String(settings.rounds)}
        control={isHost && <RangeControl id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => send({ rounds: v })} />}
        hint="Everyone draws once per round."
      />
      <Row
        label="Draw time"
        testId="drawTime"
        value={`${settings.drawTime}s`}
        control={
          isHost && (
            <RangeControl id="drawTime" label="Draw time in seconds" value={settings.drawTime} min={L.drawTime.min} max={L.drawTime.max} step={L.drawTime.step} onCommit={(v) => send({ drawTime: v })} />
          )
        }
      />
      <Row
        label="Max players"
        testId="maxPlayers"
        value={String(settings.maxPlayers)}
        control={isHost && <RangeControl id="maxPlayers" label="Maximum players" value={settings.maxPlayers} min={L.maxPlayers.min} max={L.maxPlayers.max} onCommit={(v) => send({ maxPlayers: v })} />}
      />
      <Row
        label="Hints"
        testId="hints"
        value={settings.hints === 0 ? 'none' : String(settings.hints)}
        control={isHost && <RangeControl id="hints" label="Letter hints per word" value={settings.hints} min={L.hints.min} max={L.hints.max} onCommit={(v) => send({ hints: v })} />}
        hint="Letters revealed over the turn (never more than half the word)."
      />
      <Row
        label="Word choices"
        testId="wordChoices"
        value={String(settings.wordChoices)}
        control={isHost && <RangeControl id="wordChoices" label="Words to choose from" value={settings.wordChoices} min={L.wordChoices.min} max={L.wordChoices.max} onCommit={(v) => send({ wordChoices: v })} />}
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
        {isHost ? (
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

      <label className={`toggle${!isHost || !canUseOnly ? ' toggle--disabled' : ''}`} data-testid="settings-row-customWordsOnly">
        <input
          type="checkbox"
          data-testid="settings-customWordsOnly"
          checked={settings.customWordsOnly}
          disabled={!isHost || !canUseOnly}
          onChange={(e) => send({ customWordsOnly: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span className="toggle__body">
          <span className="toggle__label">Use custom words only</span>
          {!canUseOnly && (
            <span className="toggle__hint">Add at least {L.customWords.minForOnly} custom words to enable this.</span>
          )}
        </span>
      </label>

      <label className={`toggle${!isHost ? ' toggle--disabled' : ''}`} data-testid="settings-row-allowMidGameJoin">
        <input
          type="checkbox"
          data-testid="settings-allowMidGameJoin"
          checked={settings.allowMidGameJoin}
          disabled={!isHost}
          onChange={(e) => send({ allowMidGameJoin: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span className="toggle__body">
          <span className="toggle__label">Allow joining mid-game</span>
          <span className="toggle__hint">Friends with the code can hop in while a game is running.</span>
        </span>
      </label>
    </div>
  );
}
