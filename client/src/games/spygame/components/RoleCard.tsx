import { locationById } from '@shared/games/spygame/locations';
import type { SpygameView } from '@shared/games/spygame/protocol';
import { guessesLeftText } from '../lib/text';
import { SpyIcon } from './Icons';
import { LocationTile } from './LocationTile';

/** What this player is this round: the agents' location, the spy's brief, or the spectator's wait. */
export function RoleCard({ view }: { view: SpygameView }) {
  const guesses = (
    <span className="pill spy-role__guesses" data-testid="spygame-guesses-left" data-count={view.guessesLeft}>
      {view.role === 'spy' ? `You have ${guessesLeftText(view.guessesLeft)}` : `Spy guesses left: ${view.guessesLeft}`}
    </span>
  );

  if (view.role === 'spy') {
    return (
      <section className="card spy-role spy-role--spy" aria-label="Your role" data-testid="spygame-role" data-role="spy">
        <div className="spy-role__head">
          <span className="spy-role__mark" aria-hidden="true">
            <SpyIcon size={22} />
          </span>
          <h1 className="spy-role__title">You are the spy</h1>
        </div>
        <p className="spy-role__text">Blend in. Work out the location from the questions, then tap it twice below.</p>
        {guesses}
      </section>
    );
  }

  if (view.role === 'spectator') {
    return (
      <section className="card spy-role spy-role--spectator" aria-label="Your role" data-testid="spygame-role" data-role="spectator">
        <h1 className="spy-role__title">You'll join the next round</h1>
        <p className="spy-role__text">Someone here is the spy. Watch how it plays out.</p>
        {guesses}
      </section>
    );
  }

  const location = view.locationId ? locationById(view.locationId) : undefined;
  return (
    <section className="card spy-role spy-role--agent" aria-label="Your role" data-testid="spygame-role" data-role="agent">
      <h1 className="spy-role__title">You are not the spy</h1>
      {location && <LocationTile location={location} size="lg" label="Your location" testId="spygame-location" />}
      {guesses}
    </section>
  );
}
