import { locationById } from '@shared/games/spygame/locations';
import type { SpygameView } from '@shared/games/spygame/protocol';
import { LocationTile } from './LocationTile';

/** The 24 places the spy is choosing from, as a reference for agents and spectators; agents see theirs ticked. */
export function CandidateGrid({ view }: { view: SpygameView }) {
  return (
    <section className="card spy-grid-card" aria-label="Possible locations">
      <header className="spy-grid-card__head">
        <h2 className="spy-grid-card__title">The spy's options</h2>
        <p className="spy-grid-card__hint">Keep your answers vague enough that none of these gives it away.</p>
      </header>
      <ol className="spy-grid spy-grid--reference" data-testid="candidate-grid">
        {view.candidates.map((id) => {
          const location = locationById(id);
          if (!location) return null;
          const state = view.spyGuessed.includes(id) ? 'ruledOut' : id === view.locationId ? 'real' : 'idle';
          return (
            <li key={id}>
              <LocationTile location={location} size="sm" state={state} testId="candidate-tile" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
