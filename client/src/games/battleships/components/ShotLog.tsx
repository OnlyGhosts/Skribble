import type { BattleshipsRoomState, BattleshipsView } from '@shared/games/battleships/protocol';
import { DiceIcon } from '../../../platform/components/Icons';
import { nameOf, sideLabel } from '../hooks';
import { shotSummary } from '../lib/text';

/** The last few shots, newest first. */
export function ShotLog({ room, view }: { room: BattleshipsRoomState; view: BattleshipsView }) {
  const shots = [...view.log].reverse();
  if (shots.length === 0) {
    return (
      <p className="bs-log__empty" data-testid="shot-log-empty">
        No shots yet.
      </p>
    );
  }
  return (
    <ol className="bs-log" aria-label="Shot log" data-testid="shot-log">
      {shots.map((shot, i) => (
        <li key={`${view.turnNumber}-${i}`} className={`bs-log__row bs-log__row--${shot.result}`} data-testid="shot-log-entry" data-result={shot.result} data-auto={shot.auto ? 'true' : undefined}>
          <span className="bs-log__who">
            {nameOf(room, shot.shooterId)} → {sideLabel(room, view, shot.targetId)}
          </span>
          <span className="bs-log__what">
            {shotSummary(shot)}
            {shot.auto ? ' (auto)' : ''}
          </span>
          {shot.dice !== null && (
            <span className="bs-log__dice" aria-label={`Rolled ${shot.dice}`}>
              <DiceIcon size={12} /> {shot.dice}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
