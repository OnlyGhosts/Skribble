import { letterCounts } from '../lib/format';

interface Props {
  /** Shown in full to the drawer and to players who already guessed. */
  word?: string;
  mask?: string;
  isDrawer: boolean;
}

export function WordDisplay({ word, mask, isDrawer }: Props) {
  if (word) {
    return (
      <div className="word word--plain" data-testid="word-plain">
        <span className="word__label">{isDrawer ? 'Draw this' : 'The word'}</span>
        <span className="word__text">{word}</span>
      </div>
    );
  }
  if (!mask) return null;
  return (
    <div className="word word--mask" data-testid="word-mask" aria-label={`Word with ${letterCounts(mask)} letters`}>
      <span className="word__label">Guess the word</span>
      <span className="word__tiles" aria-hidden="true">
        {mask.split(' ').map((part, w) => (
          // One group per word so a narrow screen wraps between words, never inside one.
          <span key={w} className="word__group">
            {part.split('').map((ch, i) => {
              if (ch === '_') return <span key={i} className="tile tile--hidden" />;
              return (
                <span key={i} className={`tile${/[-']/.test(ch) ? ' tile--punct' : ' tile--revealed'}`}>
                  {ch}
                </span>
              );
            })}
          </span>
        ))}
      </span>
      <span className="word__count">{letterCounts(mask)}</span>
    </div>
  );
}
