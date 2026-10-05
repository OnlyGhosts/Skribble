import { locationById } from '@shared/games/spygame/locations';
import type { SpygameView } from '@shared/games/spygame/protocol';
import { guessLocation } from '../actions';
import { canGuessNow } from '../hooks';
import { useSpygame } from '../store';
import { LocationTile } from './LocationTile';

/**
 * The spy's 24 candidates in two columns of twelve. One tap highlights a tile, a second tap on the
 * same tile sends the guess; tapping another tile moves the highlight. Wrong guesses stay crossed out.
 */
export function GuessGrid({ view }: { view: SpygameView }) {
  const highlighted = useSpygame((s) => s.highlightedLocation);
  const highlight = useSpygame((s) => s.highlightLocation);
  const canGuess = canGuessNow(view);

  const tap = (id: string) => {
    if (!canGuess) return;
    if (highlighted === id) {
      highlight(null);
      guessLocation(id);
    } else {
      highlight(id);
    }
  };

  return (
    <section className="card spy-grid-card" aria-label="Guess the location">
      <header className="spy-grid-card__head">
        <h2 className="spy-grid-card__title">Where are they?</h2>
        <p className="spy-grid-card__hint">{canGuess ? 'Tap a place, then tap it again to guess.' : view.phase === 'voting' ? 'A vote is running.' : view.phase === 'playing' ? 'The clock is paused.' : 'The round is over.'}</p>
      </header>
      <ol className="spy-grid spy-grid--guess" data-testid="guess-grid">
        {view.candidates.map((id) => {
          const location = locationById(id);
          if (!location) return null;
          const ruledOut = view.spyGuessed.includes(id);
          // A disabled tile never shows as highlighted: the confirm hint would be a lie.
          const state = ruledOut ? 'ruledOut' : highlighted === id && canGuess ? 'highlighted' : 'idle';
          return (
            <li key={id}>
              <LocationTile
                location={location}
                size="md"
                state={state}
                onClick={() => tap(id)}
                disabled={ruledOut || !canGuess}
                testId="guess-tile"
                hint={state === 'highlighted' ? 'Tap again to confirm' : undefined}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
