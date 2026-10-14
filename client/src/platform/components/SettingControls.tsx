import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Building blocks for settings panels, shared by the platform fields and the games' own
 * `SettingsFields`: a labelled row with the current value, a debounced range slider and a toggle.
 * Test ids follow the field name: settings-row-<id>, settings-value-<id>, settings-<id>.
 */

const RANGE_DEBOUNCE_MS = 150;

interface RowProps {
  label: string;
  hint?: string;
  control?: ReactNode;
  testId: string;
  value: string;
}

export function SettingRow({ label, hint, control, testId, value }: RowProps) {
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
  /** Changes with every server snapshot; a snapshot that echoes an unchanged value still resyncs the thumb. */
  revision: unknown;
}

/** Range input that tracks the drag immediately but sends at most one patch per short pause. */
export function RangeControl({ id, value, min, max, step = 1, onCommit, label, revision }: RangeProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setLocal(value), [value]);
  // The server may refuse a patch and echo the old value: with no pending drag, follow it.
  useEffect(() => {
    if (timer.current === null) setLocal(value);
  }, [value, revision]);
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

/** A range row in one go: the slider for editors, the value for everyone. */
export function RangeSetting(props: Omit<RangeProps, 'id'> & { id: string; canEdit: boolean; display?: string; hint?: string; rowLabel?: string }) {
  const { id, canEdit, display, hint, rowLabel, ...range } = props;
  return <SettingRow label={rowLabel ?? range.label} testId={id} value={display ?? String(range.value)} hint={hint} control={canEdit && <RangeControl id={id} {...range} />} />;
}

interface ToggleProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
  label: string;
  hint?: string;
}

export function ToggleSetting({ id, checked, disabled, onChange, label, hint }: ToggleProps) {
  return (
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`} data-testid={`settings-row-${id}`}>
      <input type="checkbox" data-testid={`settings-${id}`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      <span className="toggle__body">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

const WORD_LIST_DEBOUNCE_MS = 500;
/** How long a local word-list edit outranks the server copy while its echo is in flight. */
const PENDING_EDIT_GRACE_MS = 3000;

interface WordListProps {
  id: string;
  label: string;
  /** The server's list. */
  words: readonly string[];
  canEdit: boolean;
  /** The game's parser: free text to the normalised list the server would store. */
  parse(text: string): string[];
  onCommit(words: string[]): void;
  placeholder?: string;
  maxLength?: number;
}

/**
 * A free-text word list (custom words): editors type comma or newline separated words into a
 * textarea that patches the server after a short pause; everyone else reads the list. Test ids:
 * settings-row-<id>, settings-<id>-count, settings-<id>.
 */
export function WordListSetting({ id, label, words, canEdit, parse, onCommit, placeholder, maxLength }: WordListProps) {
  const [text, setText] = useState(() => words.join('\n'));
  const [focused, setFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editedAt = useRef<number | null>(null);

  // Keep the textarea in step with the server unless the host is mid-edit or waiting for the
  // echo of an edit they just made.
  useEffect(() => {
    if (focused) return;
    const fromServer = words.join('\n');
    const local = parse(text).join('\n');
    if (local === fromServer) {
      editedAt.current = null;
      return;
    }
    if (editedAt.current !== null && Date.now() - editedAt.current < PENDING_EDIT_GRACE_MS) return;
    editedAt.current = null;
    setText(fromServer);
  }, [words, focused, text, parse]);

  useEffect(
    () => () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
    },
    [],
  );

  const flush = (value: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    onCommit(parse(value));
  };

  const onChange = (value: string) => {
    setText(value);
    editedAt.current = Date.now();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flush(value), WORD_LIST_DEBOUNCE_MS);
  };

  const count = canEdit ? parse(text).length : words.length;

  return (
    <div className="setting" data-testid={`settings-row-${id}`}>
      <div className="setting__head">
        <label className="setting__label" htmlFor={id}>
          {label}
        </label>
        <span className="setting__value" data-testid={`settings-${id}-count`}>
          {count} {count === 1 ? 'word' : 'words'}
        </span>
      </div>
      {canEdit ? (
        <textarea
          id={id}
          className="textarea"
          data-testid={`settings-${id}`}
          rows={3}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          value={text}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (debounce.current !== null) flush(text);
          }}
        />
      ) : (
        <p className="setting__readonly-words">{words.length ? words.join(', ') : 'None'}</p>
      )}
    </div>
  );
}
