import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../shared/constants';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '../shared/roomCode';
import { MAX_ROOMS, RoomManager } from './roomManager';
import type { Player } from './player';
import type { Room } from './room';
import { AVATAR, FakeTransport } from './testUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function manager(rng?: () => number, maxRooms?: number): { rooms: RoomManager; transport: FakeTransport } {
  const transport = new FakeTransport();
  const rooms = new RoomManager({ transport, clock: { now: () => Date.now() }, rng, maxRooms });
  return { rooms, transport };
}

function create(rooms: RoomManager, name: string, connectionId: string): { room: Room; player: Player } {
  const result = rooms.createRoom(name, AVATAR, connectionId);
  if (!result.ok) throw new Error(`createRoom failed: ${result.code}`);
  return result;
}

describe('RoomManager', () => {
  it('creates rooms with unique valid codes and seats the host', () => {
    const { rooms, transport } = manager();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { room, player } = create(rooms, `P${i}`, `c${i}`);
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(room.code)).toBe(true);
      expect(room.hostPlayerId).toBe(player.id);
      expect(transport.last(player, 'welcome').room.code).toBe(room.code);
      codes.add(room.code);
    }
    expect(codes.size).toBe(200);
    expect(rooms.stats()).toEqual({ rooms: 200, players: 200 });
  });

  it('retries on code collisions', () => {
    // Each code consumes four rng values: AAAA, AAAA (collision), SSSS.
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    const rng = vi.fn(() => values.shift() ?? 0.9);
    const { rooms } = manager(rng);
    expect(create(rooms, 'A', 'a').room.code).toBe('AAAA');
    expect(create(rooms, 'B', 'b').room.code).toBe('SSSS');
    expect(rng).toHaveBeenCalledTimes(12);
    expect(rooms.listCodes().sort()).toEqual(['AAAA', 'SSSS']);
  });

  it('normalizes lookups and distinguishes invalid from unknown codes', () => {
    const { rooms } = manager(() => 0);
    create(rooms, 'A', 'a'); // AAAA
    expect(rooms.lookup(' aa-aa ')).toMatchObject({ ok: true });
    expect(rooms.lookup('aaaa').ok).toBe(true);
    expect(rooms.lookup('https://host/aaaa').ok).toBe(false); // too much noise -> not a code
    expect(rooms.lookup('AB')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('ABCO')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('BBBB')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(rooms.get('AAAA')).toBeDefined();
  });

  it('deletes rooms that stay empty for EMPTY_ROOM_TTL_MS and keeps ones that refill', () => {
    const { rooms } = manager();
    const { room, player } = create(rooms, 'A', 'a');
    room.leave(player);
    expect(room.isEmpty).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS - 1);
    expect(rooms.get(room.code)).toBe(room);

    // Someone joins just in time: the deletion is cancelled.
    const joined = room.join('B', AVATAR, 'b');
    expect(joined.ok).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS * 2);
    expect(rooms.get(room.code)).toBe(room);
    expect(rooms.stats()).toEqual({ rooms: 1, players: 1 });

    if (joined.ok) room.leave(joined.player);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.get(room.code)).toBeUndefined();
    expect(rooms.stats()).toEqual({ rooms: 0, players: 0 });
    expect(rooms.lookup(room.code)).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    // A destroyed room refuses new seats.
    expect(room.join('C', AVATAR, 'c').ok).toBe(false);
  });

  it('counts players in their grace period as occupying the room', () => {
    const { rooms } = manager();
    const { room, player } = create(rooms, 'A', 'a');
    room.handleDisconnect(player);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(rooms.get(room.code)).toBe(room);
    vi.advanceTimersByTime(1);
    expect(room.isEmpty).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('refuses new rooms at the cap, counting abandoned rooms until their TTL frees them', () => {
    expect(MAX_ROOMS).toBeGreaterThan(0);
    const { rooms } = manager(undefined, 3);
    const first = create(rooms, 'A', 'a');
    create(rooms, 'B', 'b');
    create(rooms, 'C', 'c');
    expect(rooms.isAtCapacity).toBe(true);
    const refused = rooms.createRoom('D', AVATAR, 'd');
    expect(refused).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(rooms.stats()).toEqual({ rooms: 3, players: 3 });

    // An abandoned room still occupies a slot until it is deleted.
    first.room.leave(first.player);
    expect(rooms.createRoom('D', AVATAR, 'd').ok).toBe(false);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.isAtCapacity).toBe(false);
    expect(create(rooms, 'D', 'd').room.code).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('destroy tears everything down', () => {
    const { rooms } = manager();
    const { room, player } = create(rooms, 'A', 'a');
    create(rooms, 'B', 'b');
    room.leave(player);
    rooms.destroy();
    expect(rooms.stats()).toEqual({ rooms: 0, players: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
