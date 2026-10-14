import { useEffect, useRef } from 'react';
import type { BattleshipsRoomState, BattleshipsView, OwnBoardView } from '@shared/games/battleships/protocol';
import { Timer } from '../../../platform/components/Timer';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { moveShip, skipMove } from '../actions';
import { nameOf } from '../hooks';
import { shipSpan } from '../lib/placement';
import { useBattleships } from '../store';
import { ArrowIcon } from './Icons';

interface Props {
  room: BattleshipsRoomState;
  view: BattleshipsView;
  board: OwnBoardView | null;
  meId: string;
  paused: boolean;
}

/** The line everyone but the shooter sees while a move window is open: a sentence and its clock. */
export function MoveNotice({ room, view, paused }: Pick<Props, 'room' | 'view' | 'paused'>) {
  return (
    <div className="banner banner--info bs-banner" role="status" data-testid="move-notice">
      <span>
        {`${nameOf(room, view.turn?.shooterId)} rolled a ${view.dice ?? '?'} and may be moving a ship`}
        <span className="ellipsis" aria-hidden="true" />
      </span>
      <Timer endsAt={view.endsAt} size="md" warnUnder={3} paused={paused} />
    </div>
  );
}

/**
 * The move window after a lucky roll, under the shooter's own board: each row names a ship by
 * the cells it covers and lights its hull on the board while pointed at; the arrows slide it one
 * cell forward or back along its axis. The window opens on every 5 or 6, so with nothing able to
 * move the panel says so and only Carry on is left.
 */
export function MovePanel({ view, board, meId, paused }: Omit<Props, 'room'>) {
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const setHighlight = useBattleships((s) => s.setHighlight);
  const panel = useRef<HTMLElement>(null);
  const shooter = view.turn?.shooterId ?? null;
  const mine = shooter === meId && board !== null;
  // The panel sits under the board, below the fold on a small phone: the twelve seconds start with it in view.
  useEffect(() => {
    if (mine) panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [mine]);
  if (!mine) return null;
  const ships = board.ships.filter((s) => board.movable.some((m) => m.id === s.id));
  const point = (id: string | null) => () => setHighlight(id);
  return (
    <section className="bs-move card" ref={panel} data-testid="move-panel" data-movable={ships.length}>
      <header className="bs-move__head">
        <div>
          <p className="overlay__kicker">You rolled a {view.dice}</p>
          <h2 className="bs-move__title">{ships.length > 0 ? 'Move a ship?' : 'No ship can move'}</h2>
          <p className="bs-move__hint">
            {ships.length > 0 ? 'Slide an undamaged ship one cell along its length, never under a shot. Nobody else will know.' : 'Every ship afloat is damaged or boxed in. Nobody else knows that.'}
          </p>
        </div>
        <Timer endsAt={view.endsAt} size="md" warnUnder={3} tickUnder={3} paused={paused} />
      </header>
      {ships.length > 0 && (
        <ul className="bs-move__list" onPointerLeave={point(null)}>
          {ships.map((s) => {
            const can = board.movable.find((m) => m.id === s.id);
            return (
              <li key={s.id} className="bs-move__row" data-testid="move-row" data-ship-id={s.id} onPointerEnter={point(s.id)} onFocus={point(s.id)} onBlur={point(null)}>
                <span className="bs-move__ship">
                  {Array.from({ length: s.length }, (_, i) => (
                    <span key={i} className="bs-tray__seg" aria-hidden="true" />
                  ))}
                  <small data-testid="move-span">{shipSpan(s)}</small>
                </span>
                <button
                  type="button"
                  className="btn btn--secondary bs-move__btn"
                  onClick={() => moveShip(s.id, 'back')}
                  disabled={!connected || !can?.back}
                  aria-label={`Move ${shipSpan(s)} ${s.horizontal ? 'left' : 'up'}`}
                  data-testid="move-back"
                  data-ship-id={s.id}
                >
                  <ArrowIcon size={18} direction={s.horizontal ? 'left' : 'up'} />
                </button>
                <button
                  type="button"
                  className="btn btn--secondary bs-move__btn"
                  onClick={() => moveShip(s.id, 'forward')}
                  disabled={!connected || !can?.forward}
                  aria-label={`Move ${shipSpan(s)} ${s.horizontal ? 'right' : 'down'}`}
                  data-testid="move-forward"
                  data-ship-id={s.id}
                >
                  <ArrowIcon size={18} direction={s.horizontal ? 'right' : 'down'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn btn--ghost btn--block" onClick={skipMove} disabled={!connected} data-testid="skip-move">
        {ships.length > 0 ? 'Keep them where they are' : 'Carry on'}
      </button>
    </section>
  );
}
