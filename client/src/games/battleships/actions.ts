import type { MoveDirection } from '@shared/games/battleships/protocol';
import { socket } from '../../platform/net/socket';
import { layoutKey, layoutSoFar } from './lib/placement';
import { useBattleshipsStore } from './store';

/** Sends the draft as the fleet's layout so far (teammates watch every drop) whenever it differs from what the server holds. */
export function commitDraft(lengths: readonly number[]): void {
  const store = useBattleshipsStore.getState();
  const ships = layoutSoFar(store.draft, lengths);
  if (ships.length === 0) return;
  const key = layoutKey(ships);
  if (key === store.adopted) return;
  if (socket.send({ t: 'place', ships })) useBattleshipsStore.setState({ adopted: key });
}

export function tapOwnCell(x: number, y: number, size: number, lengths: readonly number[]): void {
  useBattleshipsStore.getState().tapCell(x, y, size, lengths);
  commitDraft(lengths);
}

export function rotateShip(size: number, lengths: readonly number[]): void {
  useBattleshipsStore.getState().rotate(size);
  commitDraft(lengths);
}

export function autoPlace(): void {
  socket.send({ t: 'autoPlace' });
}

export function placeReady(lengths: readonly number[]): void {
  commitDraft(lengths);
  socket.send({ t: 'placeReady' });
}

export function fire(): void {
  const { aim } = useBattleshipsStore.getState();
  if (!aim) return;
  if (socket.send({ t: 'fire', targetId: aim.sideId, x: aim.x, y: aim.y })) useBattleshipsStore.getState().setAim(null);
}

/** A tap on a target cell: the first aims, the second (on the same cell) fires. */
export function tapTargetCell(sideId: string, x: number, y: number): void {
  const store = useBattleshipsStore.getState();
  const { aim } = store;
  if (aim && aim.sideId === sideId && aim.x === x && aim.y === y) return fire();
  store.setAim({ sideId, x, y });
}

export function moveShip(shipId: string, direction: MoveDirection): void {
  socket.send({ t: 'move', shipId, direction });
}

export function skipMove(): void {
  socket.send({ t: 'skipMove' });
}
