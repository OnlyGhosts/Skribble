import { useEffect, useState, type KeyboardEvent } from 'react';
import { formatChips, parseChipAmount } from '../lib/format';
import { ChipIcon } from './Chips';
import { SettingRow } from './SettingControls';

interface Props {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  presets: readonly number[];
  canEdit: boolean;
  onCommit(value: number): void;
  hint?: string;
  /** The read-only value; the formatted amount by default. */
  display?: string;
}

/**
 * A chip amount setting: preset buttons for the usual stacks and a number field (the phone's
 * numeric keyboard) for anything else, committed on blur or Enter and clamped to the limits. A
 * field left blank commits nothing and shows the value again. Test ids: `settings-<id>` (the
 * field), `settings-<id>-<preset>`, plus the row's `settings-row-<id>` / `settings-value-<id>`.
 */
export function ChipsSetting({ id, label, value, min, max, presets, canEdit, onCommit, hint, display }: Props) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const commit = (next: number) => {
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  const commitText = () => commit(parseChipAmount(text, min, max) ?? value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
    }
  };
  const control = (
    <div className="chips-setting" data-testid={`settings-${id}-control`}>
      <div className="chips-setting__presets" role="group" aria-label={`${label} presets`}>
        {presets.map((preset) => (
          <button key={preset} type="button" className={`chips-setting__preset${preset === value ? ' is-selected' : ''}`} aria-pressed={preset === value} onClick={() => commit(preset)} data-testid={`settings-${id}-${preset}`}>
            {formatChips(preset)}
          </button>
        ))}
      </div>
      <label className="chips-setting__field">
        <ChipIcon size={18} className="chip-count__coin" />
        <span className="sr-only">{label}</span>
        <input
          className="input chips-setting__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={text}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onKeyDown={onKeyDown}
          data-testid={`settings-${id}`}
        />
      </label>
    </div>
  );
  return <SettingRow label={label} testId={id} value={display ?? formatChips(value)} hint={hint} control={canEdit ? control : undefined} />;
}
