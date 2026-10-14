/**
 * When Battleships' sounds play: the die at the start of a turn, then for a shot the gun and,
 * a beat later, where it landed (a splash, an explosion, a bigger one and a sting for a sinking).
 * A shot into the viewer's own fleet lands as a thud; a ship moving whooshes only on the mover's
 * side, as the others are not told where it went.
 */
import type { BattleshipsView } from '@shared/games/battleships/protocol';
import { ONLOOKER_VOLUME, createSoundSchedule } from '../../platform/lib/sound';
import { turnKey } from './hooks';
import { battleshipsSounds as sfx } from './sounds';

/** The gap between the gun and the shot landing. */
export const SHOT_FLIGHT_MS = 260;

const schedule = createSoundSchedule();

export function clearBattleshipsSounds(): void {
  schedule.clear();
}

function onMySide(view: BattleshipsView, playerId: string): boolean {
  return view.sides.some((s) => s.id === view.mySideId && s.memberIds.includes(playerId));
}

export function playBattleshipsSounds(view: BattleshipsView, before: BattleshipsView, me: string | null): void {
  if (view.phase === 'playing' && view.turn?.roll != null && turnKey(view) !== turnKey(before)) {
    sfx.play('dice', { volume: view.turn.shooterId === me ? 1 : ONLOOKER_VOLUME });
  }
  if (before.turnNumber === view.turnNumber) return;
  const action = view.lastAction;
  if (action?.kind === 'move') {
    if (view.mySideId !== null && action.sideId === view.mySideId) sfx.play('moved');
    return;
  }
  if (action?.kind !== 'fire') return;
  const shot = action.shot;
  const mine = me !== null && shot.shooterId === me;
  const ours = onMySide(view, shot.shooterId);
  const atUs = view.mySideId !== null && shot.targetId === view.mySideId;
  sfx.play('fire', { volume: mine ? 1 : ONLOOKER_VOLUME });
  const land = Date.now() + SHOT_FLIGHT_MS;
  const level = mine || atUs ? 1 : ONLOOKER_VOLUME;
  schedule.at(land, () => {
    if (shot.result === 'miss') sfx.play('miss', { volume: level });
    else if (shot.result === 'sunk') sfx.play('sink', { volume: level });
    else if (atUs) sfx.play('struck');
    else sfx.play('hit', { volume: level });
    if (shot.result === 'sunk' && atUs) sfx.play('struck');
  });
  if (shot.result === 'sunk' && ours) schedule.at(land + 500, () => sfx.play('sinkSting'));
}
