import type { Effect } from '../engine/effects.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { Recipients } from '../game.js';

/** Every key of a room expires after this long without a write, whatever happens to the instances. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
/** A connected player's presence key; refreshed by their client's pings and the socket's pongs. */
export const PRESENCE_TTL_MS = 60_000;

export const roomKey = (code: string): string => `room:${code}`;
/** The game side store (GameStorage): a list of items, a hash and a sequence number. */
export const sideListKey = (code: string): string => `room:${code}:side`;
export const sideHashKey = (code: string): string => `room:${code}:side:meta`;
/** Counts every side-store change (append, pop, reset); side channel messages carry it so a joiner's snapshot and the stream line up. */
export const sideSeqKey = (code: string): string => `room:${code}:side:seq`;
export const presenceKey = (code: string, playerId: string): string => `presence:${code}:${playerId}`;
export const roomChannel = (code: string): string => `room:${code}`;
/** Matches room keys only (codes are 4 characters): `room:XK4P` but not `room:XK4P:side`. */
export const ROOM_KEY_PATTERN = 'room:????';

/**
 * What instances publish on a room's channel. Every instance holding sockets for the room
 * applies these to its local sockets, the publisher included, so all instances behave the same.
 */
export type RoomChannelMessage =
  | { kind: 'effects'; version: number; data: PlatformRoomData; effects: Effect[] }
  /** A side-store change: stamped with the store's stamp and its sequence number. */
  | { kind: 'side'; seq: number; stamp: string; sends: Array<{ to: Recipients; msg: { t: string } }> };

export function parseChannelMessage(raw: string): RoomChannelMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind !== 'effects' && kind !== 'side') return null;
    return parsed as RoomChannelMessage;
  } catch {
    return null;
  }
}
