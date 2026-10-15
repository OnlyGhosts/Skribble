import { useEffect, useImperativeHandle, useRef, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, extractRoomCode } from '@shared/platform/roomCode';
import { clearChar, padCode, typedText, writeChars } from '../lib/codeInput';

/** Faint hints in the empty boxes; never a prefilled value. */
const PLACEHOLDERS = ['A', 'B', 'C', 'D'];

export interface CodeInputHandle {
  /** Moves the focus to one box (clamped), e.g. the first invalid one after an error. */
  focus(index?: number): void;
}

interface Props {
  value: string;
  onChange(code: string): void;
  onSubmit(): void;
  /** Called when the user typed a letter/digit the alphabet excludes (I, L, O, 0, 1). */
  onInvalidChar(): void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** The id of a visible "Room code" label; without one the group labels itself. */
  labelledBy?: string;
  /** The id of the hint or error text under the boxes. */
  describedBy?: string;
  ref?: Ref<CodeInputHandle>;
}

/** Splits raw typed/pasted text into accepted characters, reporting whether anything was rejected. */
function filterChars(raw: string): { accepted: string; rejected: boolean } {
  let accepted = '';
  let rejected = false;
  for (const ch of raw.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) accepted += ch;
    else if (/[A-Z0-9]/.test(ch)) rejected = true;
  }
  return { accepted, rejected };
}

/**
 * Four single-character boxes that behave like one field: uppercase, auto-advance, Backspace
 * back, arrow keys, paste of a code or an invite link, Enter submits. Never submits on its own
 * when the fourth character lands.
 */
export function CodeInput({ value, onChange, onSubmit, onInvalidChar, disabled, invalid, autoFocus, labelledBy, describedBy, ref }: Props) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = padCode(value);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const focusBox = (i: number) => {
    const idx = Math.max(0, Math.min(ROOM_CODE_LENGTH - 1, i));
    const el = inputs.current[idx];
    el?.focus();
    el?.select();
  };

  useImperativeHandle(ref, () => ({ focus: (index = 0) => focusBox(index) }));

  const writeFrom = (start: number, text: string) => {
    const next = writeChars(value, start, text);
    onChange(next.code);
    focusBox(next.focus);
  };

  const handleChange = (i: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange(clearChar(value, i));
      return;
    }
    // A full box receiving another key keeps the newest character (replace-and-advance).
    const typed = typedText(raw, chars[i]);
    const { accepted, rejected } = filterChars(typed);
    if (rejected) onInvalidChar();
    if (accepted) writeFrom(i, accepted);
  };

  // Retyping the character a box already holds leaves its value as it was, so React sends no
  // change and the focus would stay put: the next key then lands in this box ("NZEH" over
  // "ZZZZ" came out "NEHZ"). The input event still comes, so advance from it.
  const handleSameInput = (i: number) => (e: FormEvent<HTMLInputElement>) => {
    const typed = e.currentTarget.value.toUpperCase();
    if (typed !== '' && typed === chars[i]) writeFrom(i, typed);
  };

  const handleKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Backspace':
        if (!chars[i] && i > 0) {
          e.preventDefault();
          onChange(clearChar(value, i - 1));
          focusBox(i - 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusBox(i - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusBox(i + 1);
        break;
      case 'Enter':
        e.preventDefault();
        onSubmit();
        break;
      default:
        break;
    }
  };

  const handlePaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const full = extractRoomCode(text);
    if (full) {
      onChange(full);
      focusBox(ROOM_CODE_LENGTH - 1);
      return;
    }
    const { accepted, rejected } = filterChars(text);
    if (rejected) onInvalidChar();
    if (accepted) writeFrom(i, accepted);
  };

  // Typing directly on the container (e.g. automation focusing the group) fills the first empty box.
  const handleGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      onSubmit();
      return;
    }
    if (e.key.length !== 1) return;
    const { accepted, rejected } = filterChars(e.key);
    if (rejected) onInvalidChar();
    if (!accepted) return;
    e.preventDefault();
    const firstEmpty = chars.findIndex((c) => !c);
    writeFrom(firstEmpty < 0 ? ROOM_CODE_LENGTH - 1 : firstEmpty, accepted);
  };

  return (
    <div
      className={`code-input${invalid ? ' is-invalid' : ''}`}
      data-testid="code-input"
      role="group"
      aria-label={labelledBy ? undefined : 'Room code'}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={handleGroupKeyDown}
    >
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          className="code-input__box"
          data-testid={`code-input-${i}`}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label={`Letter ${i + 1}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={PLACEHOLDERS[i]}
          maxLength={ROOM_CODE_LENGTH}
          value={ch}
          disabled={disabled}
          onChange={handleChange(i)}
          onInput={handleSameInput(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handlePaste(i)}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </div>
  );
}
