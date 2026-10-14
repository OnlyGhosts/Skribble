import { useEffect, useRef } from 'react';
import type { MoveDirection } from '@shared/games/battleships/protocol';
import { backToChoice, confirmMove, resetMove, stepShip, turnShip, type MoveContext } from '../actions';
import { confirmProblem, movesLeft, stepGhost, turnGhost, type Step } from '../lib/moveDraft';
import { shipSpan } from '../lib/placement';
import type { TurnDraft } from '../store';
import { ArrowIcon, RotateIcon, UndoIcon } from './Icons';

interface Props {
  draft: TurnDraft;
  ctx: MoveContext;
  connected: boolean;
}

const ARROWS: ReadonlyArray<{ direction: MoveDirection; label: string }> = [
  { direction: 'up', label: 'Up' },
  { direction: 'left', label: 'Left' },
  { direction: 'down', label: 'Down' },
  { direction: 'right', label: 'Right' },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The move controls under the shooter's own board: tap a ship, then step its ghost one square at
 * a time (arrows), turn it, reset or confirm. A control that cannot act stays tappable and says
 * why (in its title for a long press or hover, and in the note line on a tap).
 */
export function MovePanel({ draft, ctx, connected }: Props) {
  const panel = useRef<HTMLElement>(null);
  // The panel sits under the board, below the fold on a small phone: it opens in view.
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const ship = ctx.ships.find((s) => s.id === draft.shipId) ?? null;
  const left = movesLeft(draft.move, ctx.roll);
  const noShip: Step = { ok: false, reason: 'Tap one of your ships first.' };
  const steps = new Map(ARROWS.map(({ direction }) => [direction, ship ? stepGhost(ship, draft.move, direction, ctx.roll, ctx.size) : noShip]));
  const turn = ship ? turnGhost(ship, draft.move, ctx.size) : noShip;
  const problem = ship ? confirmProblem(ctx.ships, ship.id, draft.move, ctx.size, ctx.shots, ctx.roll) : null;
  const hint = !ship ? 'Tap one of your ships on the board.' : draft.move === null ? `${shipSpan(ship)} picked. Slide it with the arrows or turn it.` : (problem ?? 'Looks good. Confirm to move it.');
  const control = (step: Step, act: () => void) => ({
    'aria-disabled': step.ok ? undefined : true,
    title: step.ok ? undefined : step.reason,
    'data-reason': step.ok ? undefined : step.reason,
    onClick: act,
  });

  return (
    <section className="bs-move card" ref={panel} data-testid="move-panel" data-ship-id={draft.shipId ?? undefined} data-moves-left={left}>
      <header className="bs-move__head">
        <div>
          <h2 className="bs-move__title">Move a ship</h2>
          <p className={`bs-move__hint${ship && draft.move && problem ? ' is-problem' : ''}`} data-testid="move-hint">
            {hint}
          </p>
        </div>
        <span className="bs-move__left" data-testid="moves-left" data-left={left}>
          {draft.move?.kind === 'rotate' ? 'Turned' : `${plural(left, 'move', 'moves')} left`}
        </span>
      </header>
      <div className="bs-move__pad" role="group" aria-label="Move controls">
        <button type="button" className="btn btn--secondary bs-move__btn bs-move__btn--rotate" {...control(turn, () => turnShip(ctx))} data-testid="move-rotate">
          <RotateIcon size={18} /> {draft.move?.kind === 'rotate' ? 'Undo turn' : 'Rotate'}
        </button>
        {ARROWS.map(({ direction, label }) => {
          const step = steps.get(direction) ?? noShip;
          return (
            <button
              key={direction}
              type="button"
              className={`btn btn--secondary bs-move__btn bs-move__btn--${direction}`}
              aria-label={label}
              {...control(step, () => stepShip(direction, ctx))}
              data-testid={`move-${direction}`}
            >
              <ArrowIcon size={20} direction={direction} />
            </button>
          );
        })}
        <button type="button" className="btn btn--secondary bs-move__btn bs-move__btn--reset" {...control(draft.move ? { ok: true, move: null } : { ok: false, reason: 'Nothing to reset yet.' }, () => resetMove(ctx))} data-testid="move-reset">
          <UndoIcon size={18} /> Reset
        </button>
      </div>
      {draft.note && (
        <p className="bs-move__note" role="status" data-testid="move-note">
          {draft.note}
        </p>
      )}
      <div className="bs-move__actions">
        <button type="button" className="btn btn--ghost" onClick={() => backToChoice(ctx)} data-testid="move-back">
          Back
        </button>
        <button type="button" className="btn btn--primary" onClick={() => confirmMove(ctx)} disabled={!connected || !ship || draft.move === null || problem !== null} data-testid="move-confirm">
          Confirm move
        </button>
      </div>
    </section>
  );
}
