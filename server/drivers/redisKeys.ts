import type { DrawOp } from '../../shared/protocol';
import type { Effect } from '../engine/effects';
import type { RoomData } from '../engine/state';

/** Every key of a room expires after this long without a write, whatever happens to the instances. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
/** A connected player's presence key; refreshed by their client's pings and the socket's pongs. */
export const PRESENCE_TTL_MS = 60_000;

export const roomKey = (code: string): string => `room:${code}`;
export const canvasKey = (code: string): string => `room:${code}:canvas`;
export const canvasMetaKey = (code: string): string => `room:${code}:canvas:meta`;
export const presenceKey = (code: string, playerId: string): string => `presence:${code}:${playerId}`;
export const roomChannel = (code: string): string => `room:${code}`;
/** Matches room keys only (codes are 4 characters): `room:XK4P` but not `room:XK4P:canvas`. */
export const ROOM_KEY_PATTERN = 'room:????';

/**
 * What instances publish on a room's channel. Every instance holding sockets for the room
 * applies these to its local sockets, the publisher included, so all instances behave the same.
 */
export type RoomChannelMessage =
  | { kind: 'effects'; version: number; data: RoomData; effects: Effect[] }
  | { kind: 'draw'; drawerId: string; ops: DrawOp[] }
  | { kind: 'undo' }
  | { kind: 'clear' };

export function parseChannelMessage(raw: string): RoomChannelMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind !== 'effects' && kind !== 'draw' && kind !== 'undo' && kind !== 'clear') return null;
    return parsed as RoomChannelMessage;
  } catch {
    return null;
  }
}
