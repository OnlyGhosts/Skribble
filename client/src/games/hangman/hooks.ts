import type { HangmanRoomState, HangmanView } from '@shared/games/hangman/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { PlatformStore } from '../../platform/store/usePlatformStore';

/** The platform only hands this module rooms of its own game, so the untyped room is Hangman's room. */
export function asHangmanRoom(room: RoomState): HangmanRoomState {
  return room as HangmanRoomState;
}

export const selectHangmanRoom = (s: PlatformStore): HangmanRoomState | null => (s.room ? asHangmanRoom(s.room) : null);

export const selectView = (s: PlatformStore): HangmanView | null => selectHangmanRoom(s)?.game ?? null;

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

export function isHangman(view: HangmanView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.hangmanId === playerId;
}

/** Whether it is `playerId`'s guess right now. */
export function isGuesser(view: HangmanView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.phase === 'guessing' && view.guesserId === playerId;
}

export function isOut(view: HangmanView | null, playerId: string | null): boolean {
  return playerId !== null && (view?.players[playerId]?.out ?? false);
}

/** In the game but watching this round (joined after it began) or sitting the game out. */
export function isWatching(room: HangmanRoomState, playerId: string | null): boolean {
  const player = playerOf(room, playerId);
  if (!player || !player.participating) return true;
  return !(room.game?.players[player.id]?.playing ?? false);
}

/** Identifies a hangman's turn; the section is added for a drawing step so each one keys its own strokes. */
export function turnKey(room: HangmanRoomState): string {
  const view = room.game;
  return view ? `${room.code}:${view.round}:${view.turn}:${view.hangmanId}` : room.code;
}

export function drawingKey(room: HangmanRoomState): string | null {
  const view = room.game;
  if (!view || view.phase !== 'drawing' || view.section === null) return null;
  return `${turnKey(room)}:${view.section}`;
}

/** A new turn: the first snapshot with a game, a new hangman or a new word being chosen. */
export function isNewTurn(prev: HangmanRoomState | null, next: HangmanRoomState): boolean {
  if (!prev?.game || !next.game) return true;
  if (prev.game.round !== next.game.round || prev.game.turn !== next.game.turn || prev.game.hangmanId !== next.game.hangmanId) return true;
  return next.game.phase === 'choosing' && prev.game.phase !== 'choosing';
}

/** A drawing step began (or moved to the next section). */
export function isNewSection(prev: HangmanRoomState | null, next: HangmanRoomState): boolean {
  if (next.game?.phase !== 'drawing') return false;
  return prev?.game?.phase !== 'drawing' || prev.game.section !== next.game.section || isNewTurn(prev, next);
}

/** A phone turned sideways: the canvas sits beside the strip and the keys (the second half of PHONE_QUERY). */
export const LANDSCAPE_QUERY = '(min-aspect-ratio: 3/2) and (max-height: 520px)';

export type ScrollTarget = 'top' | 'canvas';

/**
 * Where the scrolling column should be when something new opens for this player: the canvas at
 * the top of the view when the hangman starts a section, the word strip (the top) when a new
 * turn starts or a guess becomes theirs. A new `key` is the cue; the same key means stay put, so
 * a player who scrolled down to a control is not pulled back by the next snapshot.
 */
export function scrollAnchor(room: HangmanRoomState, meId: string | null): { key: string; to: ScrollTarget } | null {
  const view = room.game;
  if (!view) return null;
  if (view.phase === 'drawing' && isHangman(view, meId)) return { key: `section:${drawingKey(room) ?? turnKey(room)}`, to: 'canvas' };
  if (isGuesser(view, meId)) return { key: `guess:${turnKey(room)}:${view.guesserId}:${view.usedLetters.length}:${view.wrong}`, to: 'top' };
  return { key: `turn:${turnKey(room)}`, to: 'top' };
}
