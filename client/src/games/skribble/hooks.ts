import type { SkribblePhase, SkribbleRoomState, SkribbleView } from '@shared/games/skribble/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { PlatformStore } from '../../platform/store/usePlatformStore';

/**
 * Skribble's reading of the platform store. The platform only hands this module rooms of its own
 * game, so the untyped room is Skribble's room.
 */
export function asSkribbleRoom(room: RoomState): SkribbleRoomState {
  return room as SkribbleRoomState;
}

export const selectSkribbleRoom = (s: PlatformStore): SkribbleRoomState | null => (s.room ? asSkribbleRoom(s.room) : null);

export const selectView = (s: PlatformStore): SkribbleView | null => selectSkribbleRoom(s)?.game ?? null;

export const selectPhase = (s: PlatformStore): SkribblePhase | null => selectView(s)?.phase ?? null;

export function drawerIdOf(view: SkribbleView | null): string | null {
  const phase = view?.phase;
  return phase && 'drawerId' in phase ? phase.drawerId : null;
}

export const selectDrawerId = (s: PlatformStore): string | null => drawerIdOf(selectView(s));

export const selectIsDrawer = (s: PlatformStore): boolean => {
  const drawerId = selectDrawerId(s);
  return drawerId !== null && drawerId === s.playerId;
};

export function hasGuessed(view: SkribbleView | null, playerId: string | null): boolean {
  return playerId !== null && (view?.players[playerId]?.guessedThisTurn ?? false);
}

export const selectHasGuessed = (s: PlatformStore): boolean => hasGuessed(selectView(s), s.playerId);

export const selectDrawer = (s: PlatformStore): PlayerPublic | null => {
  const drawerId = selectDrawerId(s);
  return drawerId ? (s.room?.players.find((p) => p.id === drawerId) ?? null) : null;
};

/** Identifies a drawing turn; `null` outside the drawing phase. */
export function drawingTurnKey(room: SkribbleRoomState | null): string | null {
  const view = room?.game;
  if (!room || !view || view.phase.kind !== 'drawing') return null;
  return `${room.code}:${view.round}:${view.turn}:${view.phase.drawerId}`;
}

/** A new turn starts whenever the round/turn counters move or a choosing/drawing phase begins. */
export function isNewTurn(prev: SkribbleRoomState | null, next: SkribbleRoomState): boolean {
  if (!prev?.game || !next.game) return true;
  if (prev.game.round !== next.game.round || prev.game.turn !== next.game.turn) return true;
  const kind = next.game.phase.kind;
  return (kind === 'choosing' || kind === 'drawing') && prev.game.phase.kind !== kind;
}
