import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { CHAT_MAX_LENGTH } from '@shared/platform/constants';
import { describeMask, groupMetrics, hintMatches, layoutGuess, type GuessSlot } from '../lib/wordMask';
import { FINE_POINTER_QUERY, matchesMedia } from '../lib/media';
import { SendIcon } from './Icons';

/** Overflow letters shown as tiles before collapsing the rest into a "+N" chip. */
const OVERFLOW_VISIBLE = 8;
const PLACEHOLDER = 'Type your guess...';

export interface GuessTilesProps {
  /** The server's mask of the word: "_" per hidden letter, revealed letters as themselves, separators kept. */
  mask: string;
  draft: string;
  onDraftChange(draft: string): void;
  /** Sends the draft; returns true when it went out (the draft is then cleared by the caller). */
  onSubmit(text: string): boolean;
  /** False while the socket is down: the tiles stay typeable, the Send button waits. */
  canSend: boolean;
  /**
   * Shared with another input that takes turns in the same slot: set when this input unmounts
   * while focused so its replacement takes the focus (and keeps the phone keyboard open).
   */
  focusMemory?: RefObject<boolean>;
}

type LetterSlot = Extract<GuessSlot, { kind: 'letter' }>;

function groupStyle(slots: GuessSlot[]): CSSProperties {
  const { letters, seps } = groupMetrics(slots);
  return { '--letters': letters, '--seps': seps } as CSSProperties;
}

/** Totals over the whole phrase: the stylesheet sizes the tiles so it fits one row on short viewports. */
function barStyle(groups: GuessSlot[][]): CSSProperties {
  let letters = 0;
  let seps = 0;
  for (const slots of groups) {
    const metrics = groupMetrics(slots);
    letters += metrics.letters;
    seps += metrics.seps;
  }
  return { '--total-letters': Math.max(1, letters), '--total-seps': seps, '--groups': Math.max(1, groups.length) } as CSSProperties;
}

/** Scrolls the tile row sideways (when it scrolls at all) so the active tile stays in view. */
function revealActiveTile(row: HTMLElement | null): void {
  if (!row || row.scrollWidth <= row.clientWidth) return;
  const active = row.querySelector<HTMLElement>('.gtile--active');
  if (!active) return;
  const left = active.offsetLeft - row.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
}

function tileClass(slot: LetterSlot): string {
  const classes = ['gtile', 'gtile--letter'];
  if (slot.hint) classes.push('gtile--hint');
  if (slot.typed) classes.push('gtile--filled');
  if (slot.hint && slot.typed) classes.push(hintMatches(slot.typed, slot.hint) ? 'gtile--match' : 'gtile--mismatch');
  if (slot.active) classes.push('gtile--active');
  return classes.join(' ');
}

/**
 * Type into the blanks: the word-length tiles are the field. A real <input> covers the whole
 * label (transparent, never hidden) so the native keyboard opens from it and keystrokes, paste,
 * IME composition and autofill all keep working. The draft is the caller's (its game store), so
 * it survives a remount and can be dropped at turn boundaries.
 */
export function GuessTiles({ mask, draft, onDraftChange, onSubmit, canSend, focusMemory }: GuessTilesProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLSpanElement | null>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    // Take over the focus from the input this one replaces; on desktop-class devices a fresh
    // turn focuses the tiles right away (no keyboard can pop up there).
    if (focusMemory?.current || matchesMedia(FINE_POINTER_QUERY)) {
      if (focusMemory) focusMemory.current = false;
      input?.focus();
    }
    return () => {
      if (focusMemory) focusMemory.current = input !== null && document.activeElement === input;
    };
  }, [focusMemory]);

  const { groups, overflow } = layoutGuess(mask, draft);
  useLayoutEffect(() => revealActiveTile(rowRef.current), [mask, draft]);
  const sendable = canSend && draft.trim().length > 0;
  const descriptionId = 'chat-input-description';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSubmit(draft.trim())) onDraftChange('');
    // Same handler as the Enter/Send gesture: keeps the phone keyboard open.
    inputRef.current?.focus();
  };

  const visibleOverflow = overflow.slice(0, OVERFLOW_VISIBLE);
  const hiddenOverflow = overflow.length - visibleOverflow.length;

  return (
    <form className="guess-form" onSubmit={submit} data-testid="guess-form">
      <label className={`guess-tiles${focused ? ' is-focused' : ''}`} data-testid="guess-tiles">
        <span ref={rowRef} className="guess-tiles__groups" style={barStyle(groups)} aria-hidden="true">
          {groups.map((slots, g) => (
            // The letter and separator counts let the tiles shrink so a word never breaks mid-word.
            <span key={g} className="guess-tiles__group" style={groupStyle(slots)}>
              {slots.map((slot, i) =>
                slot.kind === 'sep' ? (
                  <span key={i} className="gtile gtile--sep">
                    {slot.char}
                  </span>
                ) : (
                  <span key={i} className={tileClass(slot)} data-testid="guess-tile" data-filled={slot.typed ? 'true' : 'false'} data-char={slot.typed ?? ''}>
                    {slot.typed ?? slot.hint ?? ''}
                  </span>
                ),
              )}
            </span>
          ))}
          {overflow.length > 0 && (
            <span className="guess-tiles__overflow" data-testid="guess-overflow">
              {visibleOverflow.map((ch, i) => (
                <span key={i} className="gtile gtile--overflow">
                  {ch}
                </span>
              ))}
              {hiddenOverflow > 0 && <span className="gtile gtile--more">+{hiddenOverflow}</span>}
            </span>
          )}
        </span>
        <input
          ref={inputRef}
          className="guess-tiles__input"
          data-testid="chat-input"
          type="text"
          value={draft}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={PLACEHOLDER}
          aria-label={PLACEHOLDER}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          inputMode="text"
          aria-describedby={descriptionId}
          onChange={(e) => onDraftChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </label>
      {/* The tiles are decorative for assistive tech; this is where a screen reader learns the word's shape and hints. */}
      <span id={descriptionId} className="sr-only" aria-live="polite" data-testid="guess-description">
        {describeMask(mask)}
      </span>
      <button type="submit" className="btn btn--primary guess-form__send" disabled={!sendable} aria-label="Send guess" data-testid="chat-send">
        <SendIcon size={18} />
      </button>
    </form>
  );
}
