import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { CHAT_MAX_LENGTH } from '@shared/constants';
import { describeMask, groupMetrics, hintMatches, layoutGuess, type GuessSlot } from '../lib/mask';
import { FINE_POINTER_QUERY, matchesMedia } from '../lib/media';
import { sendChat } from '../net/actions';
import { useGameStore } from '../store/useGameStore';
import { SendIcon } from './Icons';

/** Overflow letters shown as tiles before collapsing the rest into a "+N" chip. */
const OVERFLOW_VISIBLE = 8;

interface Props {
  mask: string;
  /**
   * Shared with the plain chat input: set when this input unmounts while focused so the input
   * that replaces it (after a correct guess) takes the focus and the phone keyboard stays open.
   */
  focusMemory: RefObject<boolean>;
}

type LetterSlot = Extract<GuessSlot, { kind: 'letter' }>;

function groupStyle(slots: GuessSlot[]): CSSProperties {
  const { letters, seps } = groupMetrics(slots);
  return { '--letters': letters, '--seps': seps } as CSSProperties;
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
 * The guesser's input during a drawing turn: the word-length tiles are the field. A real
 * <input> covers the whole label (transparent, never hidden) so the native keyboard opens from
 * it and keystrokes, paste, IME composition and autofill all keep working.
 */
export function GuessInput({ mask, focusMemory }: Props) {
  const draft = useGameStore((s) => s.guessDraft);
  const setDraft = useGameStore((s) => s.setGuessDraft);
  const connected = useGameStore((s) => s.connection === 'connected');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    // Take over the focus from the input this one replaces; on desktop-class devices a fresh
    // turn focuses the tiles right away (no keyboard can pop up there).
    if (focusMemory.current || matchesMedia(FINE_POINTER_QUERY)) {
      focusMemory.current = false;
      input?.focus();
    }
    return () => {
      focusMemory.current = input !== null && document.activeElement === input;
    };
  }, [focusMemory]);

  const { groups, overflow } = layoutGuess(mask, draft);
  const canSend = connected && draft.trim().length > 0;
  const descriptionId = 'guess-word-description';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sendChat(draft.trim())) setDraft('');
    // Same handler as the Enter/Send gesture: keeps the phone keyboard open.
    inputRef.current?.focus();
  };

  const visibleOverflow = overflow.slice(0, OVERFLOW_VISIBLE);
  const hiddenOverflow = overflow.length - visibleOverflow.length;

  return (
    <form className="guess-form" onSubmit={submit} data-testid="guess-form">
      <label className={`guess-tiles${focused ? ' is-focused' : ''}`} data-testid="guess-tiles">
        <span className="guess-tiles__groups" aria-hidden="true">
          {groups.map((slots, g) => (
            // The letter and separator counts let the tiles shrink so a word never breaks mid-word.
            <span key={g} className="guess-tiles__group" style={groupStyle(slots)}>
              {slots.map((slot, i) =>
                slot.kind === 'sep' ? (
                  <span key={i} className="gtile gtile--sep">
                    {slot.char}
                  </span>
                ) : (
                  <span
                    key={i}
                    className={tileClass(slot)}
                    data-testid="guess-tile"
                    data-filled={slot.typed ? 'true' : 'false'}
                    data-char={slot.typed ?? ''}
                  >
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
          placeholder="Type your guess..."
          aria-label="Type your guess"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          inputMode="text"
          aria-describedby={descriptionId}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </label>
      {/* The tiles are decorative for assistive tech; this is where a screen reader learns the word's shape and hints. */}
      <span id={descriptionId} className="sr-only" aria-live="polite" data-testid="guess-description">
        {describeMask(mask)}
      </span>
      <button type="submit" className="btn btn--primary guess-form__send" disabled={!canSend} aria-label="Send guess" data-testid="chat-send">
        <SendIcon size={18} />
      </button>
    </form>
  );
}
