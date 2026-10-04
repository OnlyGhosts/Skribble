import { letterCounts } from '../lib/format';
import { hintMatches, layoutGuess, type GuessSlot } from '../lib/mask';
import { useGameStore } from '../store/useGameStore';

interface Props {
  /** Shown in full to the drawer and to players who already guessed. */
  word?: string;
  mask?: string;
  isDrawer: boolean;
}

type LetterSlot = Extract<GuessSlot, { kind: 'letter' }>;

function maskTileClass(slot: LetterSlot): string {
  // `tile--hidden` / `tile--revealed` always describe the mask itself; the typed state is layered on top.
  const classes = ['tile', slot.hint ? 'tile--revealed' : 'tile--hidden'];
  if (slot.typed) classes.push('tile--typed');
  if (slot.hint && slot.typed) classes.push(hintMatches(slot.typed, slot.hint) ? 'tile--match' : 'tile--mismatch');
  if (slot.active) classes.push('tile--active');
  return classes.join(' ');
}

export function WordDisplay({ word, mask, isDrawer }: Props) {
  // The guesser's draft mirrors into the header tiles so the typed letters appear wherever the mask is shown.
  const draft = useGameStore((s) => s.guessDraft);
  if (word) {
    return (
      <div className="word word--plain" data-testid="word-plain">
        <span className="word__label">{isDrawer ? 'Draw this' : 'The word'}</span>
        <span className="word__text">{word}</span>
      </div>
    );
  }
  if (!mask) return null;
  const { groups } = layoutGuess(mask, draft);
  return (
    <div className="word word--mask" data-testid="word-mask" aria-label={`Word with ${letterCounts(mask)} letters`}>
      <span className="word__label">Guess the word</span>
      <span className="word__tiles" aria-hidden="true">
        {groups.map((slots, w) => (
          // One group per word so a narrow screen wraps between words, never inside one.
          <span key={w} className="word__group">
            {slots.map((slot, i) =>
              slot.kind === 'sep' ? (
                <span key={i} className="tile tile--punct">
                  {slot.char}
                </span>
              ) : (
                <span key={i} className={maskTileClass(slot)}>
                  {slot.typed ?? slot.hint ?? ''}
                </span>
              ),
            )}
          </span>
        ))}
      </span>
      <span className="word__count">{letterCounts(mask)}</span>
    </div>
  );
}
