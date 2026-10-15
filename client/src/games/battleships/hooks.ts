import type { BattleshipsRoomState, BattleshipsView, ShotEvent, SideView, TargetGridView } from '@shared/games/battleships/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { TurnDraft, TurnMode } from './store';

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

export function sideOf(view: BattleshipsView, sideId: string | null | undefined): SideView | undefined {
  return sideId ? view.sides.find((s) => s.id === sideId) : undefined;
}

export function mySide(view: BattleshipsView): SideView | undefined {
  return sideOf(view, view.mySideId);
}

/** How a side is named on screen: "Team A" in teams, the player's name in solo (a departed fleet keeps a label). */
export function sideLabel(room: RoomState, view: BattleshipsView, sideId: string): string {
  if (view.mode === 'teams') return `Team ${sideId}`;
  const side = sideOf(view, sideId);
  return side && side.memberIds.length > 0 ? nameOf(room, side.memberIds[0]) : 'A departed fleet';
}

/** Whether `playerId` fires (or moves) right now. */
export function isShooter(view: BattleshipsView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.turn !== null && view.turn.shooterId === playerId;
}

export function isEliminated(view: BattleshipsView | null, playerId: string | null): boolean {
  if (!view || playerId === null) return false;
  const side = view.sides.find((s) => s.memberIds.includes(playerId));
  return side !== undefined && !side.alive;
}

/** In the room but without a fleet: joined after the fleets were placed, or sitting the game out. */
export function isWatching(view: BattleshipsView, playerId: string | null): boolean {
  return playerId === null || !view.sides.some((s) => s.memberIds.includes(playerId));
}

/** The target grids the viewer may fire at: opponents still afloat. */
export function liveTargets(view: BattleshipsView): TargetGridView[] {
  return view.targets.filter((t) => sideOf(view, t.sideId)?.alive);
}

/** The tab to show: the chosen one while it exists, else the own fleet, else the first target. */
export function resolveTab(view: BattleshipsView, tab: string | null): string | null {
  if (tab !== null && view.targets.some((t) => t.sideId === tab)) return tab;
  if (view.myBoard) return null;
  return view.targets[0]?.sideId ?? null;
}

/** The target to open when a turn comes round: the one on show if it is still afloat, else the first afloat. */
export function targetForTurn(view: BattleshipsView, tab: string | null): string | null {
  const alive = liveTargets(view);
  if (tab !== null && alive.some((t) => t.sideId === tab)) return tab;
  return alive[0]?.sideId ?? null;
}

/** The first snapshot of a game (a welcome, or the lobby turning into a game). */
export function isNewGame(prev: BattleshipsRoomState | null, next: BattleshipsRoomState): boolean {
  return next.game !== null && (prev?.game === null || prev === null || prev.phase === 'lobby');
}

/**
 * The shot fired since `prev` (the final shot of the game included), or null. Keyed on the turn's
 * own action: after a move `lastShot` still holds the shot before it, which must not replay.
 */
export function newShot(prev: BattleshipsView | null, next: BattleshipsView): ShotEvent | null {
  if (prev !== null && prev.turnNumber === next.turnNumber) return null;
  return next.lastAction?.kind === 'fire' ? next.lastAction.shot : null;
}

/** The viewer's side went down since `prev`. */
export function mySideSunk(prev: BattleshipsView | null, next: BattleshipsView, playerId: string | null): boolean {
  return isEliminated(next, playerId) && !isEliminated(prev, playerId);
}

/** The fleet as a row of pills: each ship's length and whether it is gone, longest first. */
export function fleetStatus(fleet: readonly number[], sunkLengths: readonly number[]): Array<{ length: number; sunk: boolean }> {
  const left = [...sunkLengths];
  return fleet.map((length) => {
    const i = left.indexOf(length);
    if (i >= 0) left.splice(i, 1);
    return { length, sunk: i >= 0 };
  });
}

/** Ties the shooter's draft to one turn: a new turn, a new shooter or a fresh roll after a hold all start over. */
export function turnKey(view: BattleshipsView): string {
  return view.turn ? `${view.turnNumber}:${view.turn.shooterId}:${view.turn.roll ?? '-'}` : '';
}

/** What the viewer is doing with their turn: the draft's mode when it belongs to this turn, else where a turn starts. */
export function turnModeOf(view: BattleshipsView, draft: TurnDraft): TurnMode {
  if (!view.moveOrFire || view.turn?.roll === null) return 'fire';
  return draft.key === turnKey(view) ? draft.mode : 'choose';
}
