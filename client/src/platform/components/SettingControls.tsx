import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { looksLikeText, mergeWordFile, wordFileProblem, wordFileSummary } from '../lib/wordFile';
import { UploadIcon } from './Icons';

/**
 * Building blocks for the host's settings panel, shared by the platform fields and the games' own
 * `SettingsFields`: a titled setting with its control, a debounced range slider that shows its
 * value, a toggle and a word list. The chosen option is the readout: the title row carries no
 * value of its own. Test ids follow the field name: settings-row-<id>, settings-<id>.
 */

const RANGE_DEBOUNCE_MS = 150;

interface RowProps {
  label: string;
  hint?: string;
  control?: ReactNode;
  testId: string;
}

export function SettingRow({ label, hint, control, testId }: RowProps) {
  return (
    <div className="setting" data-testid={`settings-row-${testId}`}>
      <span className="setting__label">{label}</span>
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
  /** The readout beside the slider ("80s", "Never"); the number itself by default. Keep it short: every slider in the panel gets the widest one's width. */
  format?(v: number): string;
}

/** The widest readout, in characters, a slider can show over its whole range. */
export function longestReadout(min: number, max: number, step: number, format: (v: number) => string): number {
  let longest = 0;
  for (let v = min; v <= max; v += step) longest = Math.max(longest, format(v).length);
  return longest;
}

interface ReadoutWidths {
  /** The widest readout of every slider in the scope, in characters. */
  chars: number;
  report(key: string, chars: number | null): void;
}

const ReadoutWidthContext = createContext<ReadoutWidths | null>(null);

/**
 * Gives every slider inside it one readout width, the widest any of them can show, so the tracks
 * line up down the panel and none changes length as its value moves.
 */
export function ReadoutWidthScope({ children }: { children: ReactNode }) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const report = useCallback((key: string, chars: number | null) => {
    setWidths((all) => {
      if (chars === null) {
        if (!(key in all)) return all;
        const { [key]: _gone, ...rest } = all;
        return rest;
      }
      return all[key] === chars ? all : { ...all, [key]: chars };
    });
  }, []);
  const chars = Math.max(0, ...Object.values(widths));
  const value = useMemo(() => ({ chars, report }), [chars, report]);
  return <ReadoutWidthContext.Provider value={value}>{children}</ReadoutWidthContext.Provider>;
}

/** The readout's width: the scope's shared one, or this slider's own widest outside a scope. */
function useReadoutChars(own: number): number {
  const scope = useContext(ReadoutWidthContext);
  const key = useId();
  const report = scope?.report;
  useLayoutEffect(() => {
    if (!report) return undefined;
    report(key, own);
    return () => report(key, null);
  }, [report, key, own]);
  return Math.max(own, scope?.chars ?? 0);
}

/** The nearest value on the slider's step grid, inside its range: a glide while dragging ends on it. */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const snapped = min + Math.round((v - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * Range input that tracks the drag immediately but sends at most one patch per short pause, and
 * at once when the thumb is let go (the native change event). Its value reads beside it
 * (`settings-value-<id>`) and follows the thumb while it moves. A pointer drag glides (the
 * thumb follows the finger, not the step grid) and snaps to the step when let go; the keyboard
 * steps as ever.
 */
export function RangeControl({ id, value, min, max, step = 1, onCommit, label, revision, format = String }: RangeProps) {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const snapRef = useRef((v: number) => v);
  snapRef.current = (v: number) => snapToStep(v, min, max, step);
  const snap = snapRef.current;
  const readoutChars = useReadoutChars(longestReadout(min, max, step, format));
  useEffect(() => setLocal(value), [value]);
  // The server may refuse a patch and echo the old value: with no pending drag, follow it.
  useEffect(() => {
    if (timer.current === null && !draggingRef.current) setLocal(value);
  }, [value, revision]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const settle = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    // React's onChange is the input event; the native change event fires once a keyboard step or a drag ends.
    const release = () => {
      if (timer.current === null) return;
      settle();
      commitRef.current(snapRef.current(Number(input.value)));
    };
    const start = () => {
      draggingRef.current = true;
      setDragging(true);
    };
    // The finger lifts anywhere on the page: the thumb snaps to its step and that value goes out at once.
    const end = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const snapped = snapRef.current(Number(input.value));
      setLocal(snapped);
      settle();
      commitRef.current(snapped);
    };
    input.addEventListener('change', release);
    input.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      input.removeEventListener('change', release);
      input.removeEventListener('pointerdown', start);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      settle();
    };
  }, []);
  return (
    <div className="range-field">
      <input
        ref={inputRef}
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={dragging ? 'any' : step}
        value={local}
        aria-label={label}
        aria-valuetext={format(snap(local))}
        data-testid={`settings-${id}`}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            onCommit(snap(v));
          }, RANGE_DEBOUNCE_MS);
        }}
      />
      <output className="range-field__value" htmlFor={id} aria-hidden="true" data-testid={`settings-value-${id}`} style={{ width: `calc(${readoutChars}ch + 18px)` }}>
        {format(snap(local))}
      </output>
    </div>
  );
}

/** A range setting in one go: the title, the slider with its value, the hint. */
export function RangeSetting(props: RangeProps & { hint?: string; rowLabel?: string }) {
  const { hint, rowLabel, ...range } = props;
  return <SettingRow label={rowLabel ?? range.label} testId={range.id} hint={hint} control={<RangeControl {...range} />} />;
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
const WORDS = { one: 'word', many: 'words' };

interface WordListProps {
  id: string;
  label: string;
  /** The server's list. */
  words: readonly string[];
  /** The game's parser: free text to the normalised list the server would store. */
  parse(text: string): string[];
  /** How the parser splits typed text into entries, so an upload can say what it left out. */
  split(text: string): string[];
  onCommit(words: string[]): void;
  placeholder?: string;
  maxLength?: number;
  /** What one entry is called ("word" by default; Quip Game's are prompts). */
  noun?: { one: string; many: string };
  autoCapitalize?: 'off' | 'sentences';
}

interface UploadStatus {
  ok: boolean;
  text: string;
}

/**
 * A free-text list (custom words): the host types comma or newline separated entries into a
 * textarea that patches the server after a short pause, or adds a .txt file's entries to it. Test
 * ids: settings-row-<id>, settings-<id> (the box), settings-<id>-count, settings-<id>-upload (the
 * button), settings-<id>-file (its file input), settings-<id>-upload-status.
 */
export function WordListSetting({ id, label, words, parse, split, onCommit, placeholder, maxLength, noun = WORDS, autoCapitalize = 'off' }: WordListProps) {
  const [text, setText] = useState(() => words.join('\n'));
  const [focused, setFocused] = useState(false);
  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editedAt = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    setUpload(null);
    editedAt.current = Date.now();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flush(value), WORD_LIST_DEBOUNCE_MS);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // The same file picked again must still fire a change.
    input.value = '';
    if (!file) return;
    const problem = wordFileProblem(file);
    if (problem) return setUpload({ ok: false, text: problem });
    let fileText: string;
    try {
      fileText = await file.text();
    } catch {
      return setUpload({ ok: false, text: "Couldn’t read that file. Try another one." });
    }
    if (!looksLikeText(fileText)) return setUpload({ ok: false, text: 'Pick a plain .txt file.' });
    const merged = mergeWordFile(text, fileText, { split, parse });
    setText(merged.text);
    editedAt.current = Date.now();
    flush(merged.text);
    setUpload({ ok: true, text: wordFileSummary(merged, noun) });
  };

  const count = parse(text).length;

  return (
    <div className="setting" data-testid={`settings-row-${id}`}>
      <label className="setting__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        data-testid={`settings-${id}`}
        rows={3}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
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
      <div className="word-list__foot">
        <span className="setting__hint" data-testid={`settings-${id}-count`}>
          {count} {count === 1 ? noun.one : noun.many}
        </span>
        <button type="button" className="btn btn--secondary btn--sm word-list__upload" onClick={() => fileRef.current?.click()} data-testid={`settings-${id}-upload`}>
          <UploadIcon size={16} /> Upload a .txt file
        </button>
        <input ref={fileRef} className="sr-only" type="file" accept=".txt,text/plain" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} data-testid={`settings-${id}-file`} />
      </div>
      {upload && (
        <p className={upload.ok ? 'field__ok' : 'field__error'} role="status" data-testid={`settings-${id}-upload-status`}>
          {upload.text}
        </p>
      )}
    </div>
  );
}
