import type { HangmanView } from '@shared/games/hangman/protocol';
import { describeMask, layoutGuess } from '../../../platform/lib/wordMask';
import { livesText } from '../lib/text';
import { LivesFigure } from './Figure';

interface Props {
  view: HangmanView;
  /** The hangman (and everyone at the summary) sees the word itself; letters not guessed yet are shown faint. */
  showWord: boolean;
}

/** The word so far, the wrong letters and the lives: the one strip every screen shows. */
export function WordStrip({ view, showWord }: Props) {
  const word = showWord ? view.word : undefined;
  const source = word ?? view.mask;
  const { groups } = layoutGuess(source, '');
  return (
    <div className="hm-strip" data-testid="hangman-strip">
      <div
        className="hm-word"
        role="img"
        aria-label={word ? `The word is ${word}` : describeMask(view.mask)}
        data-testid={word ? 'hangman-word' : 'hangman-mask'}
        data-mask={view.mask}
        data-word={word}
      >
        {view.mask === '' && !word ? (
          <span className="hm-word__pending">Waiting for a word</span>
        ) : (
          groups.map((slots, g) => (
            // One group per word so a narrow screen wraps between words, never inside one.
            <span key={g} className="hm-word__group" aria-hidden="true">
              {slots.map((slot, i) => {
                if (slot.kind === 'sep') {
                  return (
                    <span key={i} className="hm-tile hm-tile--sep">
                      {slot.char}
                    </span>
                  );
                }
                const letter = slot.hint ?? '';
                const revealed = letter !== '' && view.usedLetters.includes(letter);
                const secret = letter !== '' && !revealed;
                return (
                  <span key={i} className={`hm-tile${revealed ? ' hm-tile--revealed' : secret ? ' hm-tile--secret' : ' hm-tile--hidden'}`} data-testid="word-tile">
                    {letter}
                  </span>
                );
              })}
            </span>
          ))
        )}
      </div>
      <div className="hm-strip__side">
        <LivesFigure wrong={view.wrong} maxWrong={view.maxWrong} />
        <div className="hm-strip__facts">
          <span className="hm-strip__lives" data-testid="hangman-lives-text">
            {livesText(view.lives)}
          </span>
          <span
            className="hm-strip__wrong"
            aria-label={view.wrongLetters.length ? `Wrong letters: ${view.wrongLetters.join(', ')}` : 'No wrong letters yet'}
            data-testid="wrong-letters"
            data-count={view.wrongLetters.length}
          >
            {view.wrongLetters.length ? (
              view.wrongLetters.map((l) => (
                <span key={l} className="hm-strip__wrong-letter">
                  {l}
                </span>
              ))
            ) : (
              <span className="hm-strip__wrong-none">No wrong letters yet</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
