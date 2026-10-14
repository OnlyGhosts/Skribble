import { cellKey, cellLabel } from '@shared/games/battleships/fleet';
import type { BattleshipsRoomState, BattleshipsView, TargetGridView } from '@shared/games/battleships/protocol';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { fire, tapTargetCell } from '../actions';
import { fleetStatus, isShooter, sideLabel, sideOf } from '../hooks';
import { useBattleships } from '../store';
import { Board } from './Board';
import { CrosshairIcon } from './Icons';

interface Props {
  room: BattleshipsRoomState;
  view: BattleshipsView;
  target: TargetGridView;
  meId: string;
  holding: boolean;
  /** Aiming is open: the viewer's turn, in fire mode. */
  aiming: boolean;
  /** Back to Fire or Move (move or fire only). */
  onBack?(): void;
}

/** The fleet of a side as pills: a ship per length, crossed once sunk. */
export function FleetPills({ fleet, sunkLengths, testId }: { fleet: readonly number[]; sunkLengths: readonly number[]; testId: string }) {
  return (
    <ul className="bs-fleet" aria-label="Fleet" data-testid={testId}>
      {fleetStatus(fleet, sunkLengths).map((s, i) => (
        <li key={i} className={`bs-fleet__ship${s.sunk ? ' bs-fleet__ship--sunk' : ''}`} data-length={s.length} data-sunk={s.sunk ? 'true' : undefined} aria-label={`${s.length}-ship${s.sunk ? ', sunk' : ''}`}>
          {Array.from({ length: s.length }, (_, j) => (
            <span key={j} className="bs-fleet__seg" aria-hidden="true" />
          ))}
        </li>
      ))}
    </ul>
  );
}

/** One opponent's grid: the shots everyone landed on it, and, on the viewer's turn, a two-tap Fire. */
export function TargetPanel({ room, view, target, meId, holding, aiming, onBack }: Props) {
  const aim = useBattleships((s) => s.aim);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const side = sideOf(view, target.sideId);
  const alive = side?.alive ?? false;
  const canFire = aiming && view.phase === 'playing' && isShooter(view, meId) && alive && !holding && !view.paused;
  const aimedHere = aim && aim.sideId === target.sideId ? aim : null;
  const freshHere = view.lastShot && view.lastShot.targetId === target.sideId ? view.lastShot : null;
  const label = sideLabel(room, view, target.sideId);
  return (
    <section className="bs-target card" data-testid="target" data-side={target.sideId} data-alive={alive} data-can-fire={canFire}>
      <header className="bs-target__head">
        <div className="bs-target__who">
          <strong>{label}</strong>
          <small data-testid="ships-left" data-left={target.shipsLeft}>
            {view.phase === 'placing' ? (side?.ready ? 'Fleet in position' : 'Placing their fleet…') : alive ? `${target.shipsLeft} of ${target.shipsTotal} ships afloat` : 'Fleet sunk'}
          </small>
        </div>
        <FleetPills fleet={view.fleet} sunkLengths={target.sunkLengths} testId="target-fleet" />
      </header>
      <Board
        size={view.boardSize}
        shots={target.shots}
        aimed={aimedHere ? cellKey(aimedHere.x, aimedHere.y) : null}
        fresh={freshHere}
        onCell={canFire ? (x, y) => tapTargetCell(target.sideId, x, y) : undefined}
        disabledCell={(x, y) => target.shots[cellKey(x, y)] !== undefined}
        testId="target-board"
        label={`${label}'s waters`}
      />
      {canFire && (
        <div className="bs-target__fire">
          <span className="bs-target__aim" data-testid="aim" data-cell={aimedHere ? cellLabel(aimedHere.x, aimedHere.y) : undefined}>
            {aimedHere ? 'Aiming at' : 'Tap a cell to aim'}
          </span>
          <div className="bs-target__buttons">
            {onBack && (
              <button type="button" className="btn btn--ghost bs-back" onClick={onBack} data-testid="fire-back">
                Back
              </button>
            )}
            <button type="button" className="btn btn--primary bs-fire" onClick={fire} disabled={!connected || !aimedHere} data-testid="fire">
              <CrosshairIcon size={18} /> {aimedHere ? `Fire at ${cellLabel(aimedHere.x, aimedHere.y)}` : 'Fire'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
