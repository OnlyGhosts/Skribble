import type { PlayerPublic } from '@shared/platform/protocol';
import { isReady } from '../lib/party';
import { PLATFORM_SOUNDS } from '../lib/platformSounds';
import { countMeIn, setReady, setSitOut } from '../net/actions';
import { CheckIcon } from './Icons';

interface Props {
  me: PlayerPublic;
  /** Where the controls sit: the lobby card or the podium; only the copy differs. */
  context: 'lobby' | 'podium';
}

/** Which controls a player gets between games; never two buttons that do the same job. */
export type ReadyState = 'host' | 'notReady' | 'ready' | 'sittingOut';

export function readyState(me: PlayerPublic): ReadyState {
  if (me.sittingOut) return 'sittingOut';
  if (me.isHost) return 'host';
  return isReady(me) ? 'ready' : 'notReady';
}

/**
 * The choice everyone makes between games. Not ready: one "I'm ready" plus a small "Sit this one
 * out". Ready: the same button checked ("You're ready", tap to undo) and the same small link.
 * Sitting out: only "Count me in", which comes back in and readies in one tap. The host is in by
 * pressing Start, so on the podium their button is a statement rather than a question, and in the
 * lobby (where Start is on screen) they only get the small link.
 */
export function ReadyControls({ me, context }: Props) {
  const state = readyState(me);
  const ready = state === 'ready' || state === 'host';
  return (
    <div className="ready-controls" data-testid="ready-controls" data-ready={isReady(me)} data-sitting-out={me.sittingOut} data-state={state}>
      {state === 'sittingOut' ? (
        <>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            aria-pressed={true}
            onClick={() => {
              PLATFORM_SOUNDS.play('ready');
              countMeIn(me.isHost);
            }}
            data-testid="sitout-toggle"
          >
            Count me in
          </button>
          <p className="field__hint ready-controls__hint" data-testid="sitout-hint">
            You'll watch the next game.
          </p>
        </>
      ) : state === 'host' && context === 'lobby' ? (
        // In the lobby the host's Start button already says they are in; only the way out is left.
        <button type="button" className="text-btn sitout-toggle" aria-pressed={false} onClick={() => setSitOut(true)} data-testid="sitout-toggle">
          Sit this one out
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`btn btn--lg btn--block ready-toggle${state === 'host' ? ' ready-toggle--host' : ''}${ready ? ' is-ready' : ' btn--primary'}`}
            aria-pressed={ready}
            disabled={state === 'host'}
            onClick={() => {
              if (!me.ready) PLATFORM_SOUNDS.play('ready');
              setReady(!me.ready);
            }}
            data-testid="ready-toggle"
          >
            {state === 'host' ? (
              <>
                <CheckIcon size={18} /> You start the game
              </>
            ) : ready ? (
              <>
                <CheckIcon size={18} /> You're ready
              </>
            ) : context === 'podium' ? (
              'Ready for the next game'
            ) : (
              "I'm ready"
            )}
          </button>
          <button type="button" className="text-btn sitout-toggle" aria-pressed={false} onClick={() => setSitOut(true)} data-testid="sitout-toggle">
            Sit this one out
          </button>
        </>
      )}
    </div>
  );
}
