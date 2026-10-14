import { useEffect, type ReactNode } from 'react';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface Props {
  used: readonly string[];
  wrong: readonly string[];
  /** True for the player whose guess it is: the unused keys are tappable (and the keyboard works). */
  enabled: boolean;
  onPick(letter: string): void;
  /** Rendered after the keys, in the grid's last row (the "risk the word" button). */
  children?: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/** The 26 letter keys: used ones are disabled, right ones green, wrong ones red. */
export function LetterGrid({ used, wrong, enabled, onPick, children }: Props) {
  // A physical keyboard picks a letter too, unless the player is typing somewhere.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const letter = e.key.toUpperCase();
      if (letter.length !== 1 || letter < 'A' || letter > 'Z' || used.includes(letter)) return;
      e.preventDefault();
      onPick(letter);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, used, onPick]);

  return (
    <div className="hm-keys" role="group" aria-label="Letters" data-testid="letter-grid" data-enabled={enabled}>
      {LETTERS.map((letter) => {
        const isUsed = used.includes(letter);
        const state = isUsed ? (wrong.includes(letter) ? 'wrong' : 'correct') : 'idle';
        return (
          <button
            key={letter}
            type="button"
            className={`hm-key hm-key--${state}`}
            disabled={!enabled || isUsed}
            onClick={() => onPick(letter)}
            aria-label={state === 'idle' ? `Guess ${letter}` : `${letter}: ${state === 'correct' ? 'in the word' : 'not in the word'}`}
            data-testid="letter-key"
            data-letter={letter}
            data-state={state}
          >
            {letter}
          </button>
        );
      })}
      {children}
    </div>
  );
}
