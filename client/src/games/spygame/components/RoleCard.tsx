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
        <span className="spy-role__mark" aria-hidden="true">
          <SpyIcon size={28} />
        </span>
        <h1 className="spy-role__title">You are the spy</h1>
        <p className="spy-role__text">Ask and answer like you belong there. Work out the location from the chatter, then tap it twice below.</p>
        {guesses}
      </section>
    );
  }

  if (view.role === 'spectator') {
    return (
      <section className="card spy-role spy-role--spectator" aria-label="Your role" data-testid="spygame-role" data-role="spectator">
        <h1 className="spy-role__title">You'll join the next round</h1>
        <p className="spy-role__text">Someone in the room is the spy. Watch how it plays out; your seat is ready for the next round.</p>
        {guesses}
      </section>
    );
  }

  const location = view.locationId ? locationById(view.locationId) : undefined;
  return (
    <section className="card spy-role spy-role--agent" aria-label="Your role" data-testid="spygame-role" data-role="agent">
      {location && <LocationTile location={location} size="lg" testId="spygame-location" />}
      <div className="spy-role__row">
        <p className="spy-role__text spy-role__text--strong">You are not the spy</p>
        {guesses}
      </div>
    </section>
  );
}
