import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../shared/constants';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '../shared/roomCode';
import { RoomManager } from './roomManager';
import { AVATAR, FakeTransport } from './testUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function manager(rng?: () => number): { rooms: RoomManager; transport: FakeTransport } {
  const transport = new FakeTransport();
  const rooms = new RoomManager({ transport, clock: { now: () => Date.now() }, rng });
  return { rooms, transport };
}

describe('RoomManager', () => {
  it('creates rooms with unique valid codes and seats the host', () => {
    const { rooms, transport } = manager();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { room, player } = rooms.createRoom(`P${i}`, AVATAR, `c${i}`);
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
    expect(rooms.createRoom('A', AVATAR, 'a').room.code).toBe('AAAA');
    expect(rooms.createRoom('B', AVATAR, 'b').room.code).toBe('SSSS');
    expect(rng).toHaveBeenCalledTimes(12);
    expect(rooms.listCodes().sort()).toEqual(['AAAA', 'SSSS']);
  });

  it('normalizes lookups and distinguishes invalid from unknown codes', () => {
    const { rooms } = manager(() => 0);
    rooms.createRoom('A', AVATAR, 'a'); // AAAA
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
    const { room, player } = rooms.createRoom('A', AVATAR, 'a');
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
    const { room, player } = rooms.createRoom('A', AVATAR, 'a');
    room.handleDisconnect(player);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(rooms.get(room.code)).toBe(room);
    vi.advanceTimersByTime(1);
    expect(room.isEmpty).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('destroy tears everything down', () => {
    const { rooms } = manager();
    const { room, player } = rooms.createRoom('A', AVATAR, 'a');
    rooms.createRoom('B', AVATAR, 'b');
    room.leave(player);
    rooms.destroy();
    expect(rooms.stats()).toEqual({ rooms: 0, players: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
