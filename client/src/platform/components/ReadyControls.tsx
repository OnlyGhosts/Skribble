import type { ReactNode } from 'react';
import type { PlayerPublic } from '@shared/platform/protocol';
import { isReady } from '../lib/party';
import { PLATFORM_SOUNDS } from '../lib/platformSounds';
import { countMeIn, setReady, setSitOut } from '../net/actions';
import { CheckIcon } from './Icons';

interface Props {
  me: PlayerPublic;
  /** More buttons beside "Sit this one out", in the same style (the room's "Change my look"). */
  extra?: ReactNode;
}

/** Which controls a player gets between games; never two buttons that do the same job. */
export type ReadyState = 'host' | 'notReady' | 'ready' | 'sittingOut';

export function readyState(me: PlayerPublic): ReadyState {
  if (me.sittingOut) return 'sittingOut';
  if (me.isHost) return 'host';
  return isReady(me) ? 'ready' : 'notReady';
}

/**
 * The choice everyone makes between games. Not ready: one big "I'm ready" over a row of secondary
 * buttons, "Sit this one out" first. Ready: the same big button checked ("You're ready", tap to
 * undo) over the same row. Sitting out: "Count me in", which comes back in and readies in one tap,
 * replaces "Sit this one out". The host is in by pressing Start, which is on screen, so they only
 * get the row.
 */
export function ReadyControls({ me, extra }: Props) {
  const state = readyState(me);
  const ready = state === 'ready' || state === 'host';
  const sitOut = (
    <button type="button" className="btn btn--secondary sitout-toggle" aria-pressed={false} onClick={() => setSitOut(true)} data-testid="sitout-toggle">
      Sit this one out
    </button>
  );
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
      ) : (
        // The host's Start button already says they are in; only the way out is left.
        state !== 'host' && (
          <button
            type="button"
            className={`btn btn--lg btn--block ready-toggle${ready ? ' is-ready' : ' btn--primary'}`}
            aria-pressed={ready}
            onClick={() => {
              if (!me.ready) PLATFORM_SOUNDS.play('ready');
              setReady(!me.ready);
            }}
            data-testid="ready-toggle"
          >
            {ready ? (
              <>
                <CheckIcon size={18} /> You're ready
              </>
            ) : (
              "I'm ready"
            )}
          </button>
        )
      )}
      {(state !== 'sittingOut' || extra) && (
        <div className="ready-controls__more">
          {state !== 'sittingOut' && sitOut}
          {extra}
        </div>
      )}
    </div>
  );
}
