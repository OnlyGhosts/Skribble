import { locationById } from '@shared/games/spygame/locations';
import type { SpygameView } from '@shared/games/spygame/protocol';
import { guessesLeftText } from '../lib/text';
import { SpyIcon } from './Icons';
import { LocationTile } from './LocationTile';

/** The spy's guesses left, in the head of the places grid they are made from. */
export function GuessesLeft({ view }: { view: SpygameView }) {
  return (
    <span className="pill spy-role__guesses" data-testid="spygame-guesses-left" data-count={view.guessesLeft}>
      {view.role === 'spy' ? guessesLeftText(view.guessesLeft) : `Spy guesses left: ${view.guessesLeft}`}
    </span>
  );
}

/**
 * What this player is this round: the agents' location, the spy's brief, or the spectator's wait.
 * `watching`: a spectator of the whole game (sat it out or joined mid-way), not just of this round.
 */
export function RoleCard({ view, watching = false }: { view: SpygameView; watching?: boolean }) {
  if (view.role === 'spy') {
    return (
      <section className="card spy-role spy-role--spy" aria-label="Your role" data-testid="spygame-role" data-role="spy">
        <div className="spy-role__head">
          <span className="spy-role__mark" aria-hidden="true">
            <SpyIcon size={22} />
          </span>
          <h1 className="spy-role__title">You are the spy</h1>
        </div>
        <p className="spy-role__text">Blend in and work out where they are.</p>
      </section>
    );
  }

  if (view.role === 'spectator') {
    return (
      <section className="card spy-role spy-role--spectator" aria-label="Your role" data-testid="spygame-role" data-role="spectator" data-watching={watching}>
        <h1 className="spy-role__title">{watching ? "You're watching" : "You'll join the next round"}</h1>
        <p className="spy-role__text">{watching ? 'Someone here is the spy. You can play the next game.' : 'Someone here is the spy. Watch how it plays out.'}</p>
      </section>
    );
  }

  const location = view.locationId ? locationById(view.locationId) : undefined;
  return (
    <section className="card spy-role spy-role--agent" aria-label="Your role" data-testid="spygame-role" data-role="agent">
      <h1 className="spy-role__title">You are not the spy</h1>
      {location && <LocationTile location={location} size="lg" label="Your location" testId="spygame-location" />}
    </section>
  );
}
