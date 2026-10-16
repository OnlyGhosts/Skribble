import type { ScribblePhase, ScribbleRoomState, ScribbleView } from '@shared/games/scribble/protocol';
import type { RoomState } from '@shared/platform/protocol';
import type { PlatformStore } from '../../platform/store/usePlatformStore';

/**
 * Scribble's reading of the platform store. The platform only hands this module rooms of its own
 * game, so the untyped room is Scribble's room.
 */
export function asScribbleRoom(room: RoomState): ScribbleRoomState {
  return room as ScribbleRoomState;
}

export const selectScribbleRoom = (s: PlatformStore): ScribbleRoomState | null => (s.room ? asScribbleRoom(s.room) : null);

export const selectView = (s: PlatformStore): ScribbleView | null => selectScribbleRoom(s)?.game ?? null;

export const selectPhase = (s: PlatformStore): ScribblePhase | null => selectView(s)?.phase ?? null;

export function drawerIdOf(view: ScribbleView | null): string | null {
  const phase = view?.phase;
  return phase && 'drawerId' in phase ? phase.drawerId : null;
}

export const selectDrawerId = (s: PlatformStore): string | null => drawerIdOf(selectView(s));

export const selectIsDrawer = (s: PlatformStore): boolean => {
  const drawerId = selectDrawerId(s);
  return drawerId !== null && drawerId === s.playerId;
};

export function hasGuessed(view: ScribbleView | null, playerId: string | null): boolean {
  return playerId !== null && (view?.players[playerId]?.guessedThisTurn ?? false);
}

export const selectHasGuessed = (s: PlatformStore): boolean => hasGuessed(selectView(s), s.playerId);

/** Identifies a drawing turn; `null` outside the drawing phase. */
export function drawingTurnKey(room: ScribbleRoomState | null): string | null {
  const view = room?.game;
  if (!room || !view || view.phase.kind !== 'drawing') return null;
  return `${room.code}:${view.round}:${view.turn}:${view.phase.drawerId}`;
}

/** A new turn starts whenever the round/turn counters move or a choosing/drawing phase begins. */
export function isNewTurn(prev: ScribbleRoomState | null, next: ScribbleRoomState): boolean {
  if (!prev?.game || !next.game) return true;
  if (prev.game.round !== next.game.round || prev.game.turn !== next.game.turn) return true;
  const kind = next.game.phase.kind;
  return (kind === 'choosing' || kind === 'drawing') && prev.game.phase.kind !== kind;
}
