import type { RollStage } from '../store';
import { Die } from './Die';
import { CrosshairIcon, MoveIcon } from './Icons';

interface Props {
  roll: number;
  stage: RollStage;
  /** Why Move is not on offer this turn (moved last turn, no ship has room), or null. */
  moveBlocked: string | null;
  onFire(): void;
  onMove(): void;
}

/** The start of the shooter's turn under move or fire: the die lands, then Fire or Move up to the roll. */
export function TurnChoice({ roll, stage, moveBlocked, onFire, onMove }: Props) {
  const rolling = stage === 'rolling';
  return (
    <section className="bs-turn card" data-testid="turn-choice" data-roll={roll} data-move-blocked={moveBlocked ? 'true' : undefined}>
      <Die value={roll} rolling={rolling} size="lg" testId="turn-die" />
      <div className="bs-turn__body">
        <p className="bs-turn__title">{rolling ? 'Rolling…' : `You rolled a ${roll}`}</p>
        <div className="bs-turn__actions">
          <button type="button" className="btn btn--primary bs-turn__btn" onClick={onFire} disabled={rolling} data-testid="choose-fire">
            <CrosshairIcon size={18} /> Fire
          </button>
          <button
            type="button"
            className="btn btn--secondary bs-turn__btn"
            onClick={moveBlocked ? undefined : onMove}
            disabled={rolling}
            aria-disabled={moveBlocked ? true : undefined}
            title={moveBlocked ?? undefined}
            data-testid="choose-move"
          >
            <MoveIcon size={18} /> {rolling ? 'Move' : `Move (up to ${roll})`}
          </button>
        </div>
        {moveBlocked && !rolling && (
          <p className="bs-turn__why" data-testid="move-blocked">
            {moveBlocked}
          </p>
        )}
      </div>
    </section>
  );
}
