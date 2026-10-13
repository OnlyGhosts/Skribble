import type { PlayerPublic } from '@shared/platform/protocol';
import { isReady } from '../lib/party';
import { setReady, setSitOut } from '../net/actions';
import { CheckIcon, EyeIcon } from './Icons';

interface Props {
  me: PlayerPublic;
  /** Where the controls sit: the lobby card or the podium; only the copy differs. */
  context: 'lobby' | 'podium';
}

/**
 * The two choices everyone makes between games: ready up for the next one, or sit it out while
 * staying in the party. Sitting out clears the ready state (the server does the same). The host
 * is in by pressing Start, so their toggle shows as ready and says so instead of asking.
 */
export function ReadyControls({ me, context }: Props) {
  const readyLabel = context === 'podium' ? 'Ready for the next game' : "I'm ready";
  const ready = isReady(me);
  const hostStarts = me.isHost && !me.sittingOut;
  return (
    <div className="ready-controls" data-testid="ready-controls" data-ready={ready} data-sitting-out={me.sittingOut}>
      <button
        type="button"
        className={`btn btn--lg btn--block ready-toggle${hostStarts ? ' ready-toggle--host' : ''}${ready ? ' is-ready' : ' btn--primary'}`}
        aria-pressed={ready}
        disabled={me.sittingOut || hostStarts}
        onClick={() => setReady(!me.ready)}
        data-testid="ready-toggle"
      >
        {hostStarts ? (
          <>
            <CheckIcon size={18} /> You're in — you start the game
          </>
        ) : ready ? (
          <>
            <CheckIcon size={18} /> You're ready
          </>
        ) : (
          readyLabel
        )}
      </button>
      <button type="button" className={`btn btn--ghost btn--block sitout-toggle${me.sittingOut ? ' is-sitting-out' : ''}`} aria-pressed={me.sittingOut} onClick={() => setSitOut(!me.sittingOut)} data-testid="sitout-toggle">
        <EyeIcon size={16} /> {me.sittingOut ? "Count me in" : 'Sit this one out'}
      </button>
      {me.sittingOut && (
        <p className="field__hint" data-testid="sitout-hint">
          You stay in the party and watch the next game.
        </p>
      )}
    </div>
  );
}
