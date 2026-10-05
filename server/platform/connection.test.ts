import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS } from '../../shared/platform/constants.js';
import {
  CLOSE_REMOVED,
  CLOSE_REPLACED,
  GAME_MESSAGE_RATE_LIMIT_PER_SECOND,
  HEARTBEAT_INTERVAL_MS,
  ROOM_RATE_LIMIT_COUNT,
  ROOM_RATE_LIMIT_WINDOW_MS,
  SocketHub,
  handleConnection,
} from './connection.js';
import { MemoryDriver } from './drivers/memory.js';
import type { RoomManager } from './drivers/roomManager.js';
import { FakeSocket } from './drivers/testSocket.js';
import { AVATAR } from './drivers/testUtils.js';
import type { GameDriver, RoomInbound, Seat } from './drivers/types.js';

interface World {
  hub: SocketHub;
  rooms: RoomManager;
  connect: () => FakeSocket;
}

function world(): World {
  // Deterministic rng that still yields a different code per room: AAAA, DDDD, GGGG, ...
  let calls = 0;
  const rng = (): number => (Math.floor(calls++ / 4) * 0.1) % 1;
  const driver = new MemoryDriver({ clock: { now: () => Date.now() }, rng });
  const connect = (): FakeSocket => {
    const ws = new FakeSocket();
    handleConnection(ws, { driver, clock: { now: () => Date.now() } });
    return ws;
  };
  return { hub: driver.hub, rooms: driver.rooms, connect };
}

/** Creates a room on `host` and joins `guest`; returns the code. */
function pair(w: World, host: FakeSocket, guest: FakeSocket): string {
  host.receive({ t: 'create', gameId: 'skribble', name: 'Alice', avatar: AVATAR });
  const code = host.last('welcome').room.code;
  guest.receive({ t: 'join', code, name: 'Bob', avatar: AVATAR });
  return code;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleConnection', () => {
  it('rejects malformed input without crashing', () => {
    const w = world();
    const ws = w.connect();
    ws.receive('{not json', true);
    ws.receive({ t: 5 });
    ws.receive({ t: 'join', code: 'ABCD', name: '', avatar: AVATAR });
    ws.receive({ t: 'create', gameId: 'chess', name: 'Al', avatar: AVATAR });
    ws.emit('message', Buffer.from('x'), true);
    expect(ws.errors()).toEqual(['INVALID_MESSAGE', 'INVALID_MESSAGE', 'INVALID_MESSAGE', 'INVALID_MESSAGE', 'INVALID_MESSAGE']);
    expect(ws.last('error').message.length).toBeGreaterThan(0);
    // Unknown and game messages are the room's business: without a seat they are refused, not parsed.
    ws.receive({ t: 'nope' });
    ws.receive({ t: 'draw', ops: [] });
    expect(ws.errors().slice(-2)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });

  it('answers ping with the server time and rejects room actions before joining', () => {
    const w = world();
    const ws = w.connect();
    ws.receive({ t: 'ping' });
    expect(ws.last('pong').serverTime).toBe(Date.now());
    ws.receive({ t: 'chat', text: 'hi' });
    ws.receive({ t: 'start' });
    expect(ws.errors()).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });

  it('creates, joins by code and routes room messages', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    const code = pair(w, host, guest);
    expect(code).toBe('AAAA');
    expect(guest.last('welcome').room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(host.last('room').room.players).toHaveLength(2);
    expect(host.last('chat').message.text).toBe('Bob joined');
    expect(w.rooms.stats()).toEqual({ rooms: 1, players: 2 });

    const stranger = w.connect();
    stranger.receive({ t: 'join', code: 'ZZZZ', name: 'Zed', avatar: AVATAR });
    stranger.receive({ t: 'join', code: 'A', name: 'Zed', avatar: AVATAR });
    stranger.receive({ t: 'join', code: 'aa aa', name: 'Zed', avatar: AVATAR });
    expect(stranger.errors()).toEqual(['ROOM_NOT_FOUND', 'INVALID_CODE']);
    expect(stranger.last('welcome').room.code).toBe('AAAA');

    host.receive({ t: 'start' });
    expect(host.last('room').room.game?.phase.kind).toBe('choosing');
    expect(guest.last('room').room.game?.phase.kind).toBe('choosing');
    // Game messages are validated by the room's game, not the connection layer.
    host.receive({ t: 'chooseWord', index: 'first' });
    expect(host.errors()).toEqual(['INVALID_MESSAGE']);
    host.receive({ t: 'chooseWord', index: 0 });
    host.receive({ t: 'draw', ops: [{ k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 2 }] });
    expect(host.ofType('draw')).toHaveLength(0);
    expect(guest.ofType('draw')).toHaveLength(1);
    expect(stranger.ofType('draw')).toHaveLength(1);
  });

  it('rate-limits chat per player and drops floods of draw batches', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    pair(w, host, guest);
    for (let i = 0; i < CHAT_RATE_LIMIT_COUNT + 2; i++) guest.receive({ t: 'chat', text: `m${i}` });
    expect(guest.errors()).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(host.ofType('chat').filter((m) => m.message.kind === 'chat')).toHaveLength(CHAT_RATE_LIMIT_COUNT);
    vi.advanceTimersByTime(CHAT_RATE_LIMIT_WINDOW_MS);
    guest.receive({ t: 'chat', text: 'again' });
    expect(guest.errors()).toHaveLength(2);

    host.receive({ t: 'start' });
    host.receive({ t: 'chooseWord', index: 0 });
    // Every game message shares the budget; start a fresh second for the flood.
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < GAME_MESSAGE_RATE_LIMIT_PER_SECOND + 20; i++) {
      host.receive({ t: 'draw', ops: [{ k: 'fill', x: i, y: i, color: '#000000' }] });
    }
    expect(guest.ofType('draw')).toHaveLength(GAME_MESSAGE_RATE_LIMIT_PER_SECOND);
    expect(host.errors()).toEqual([]);
    vi.advanceTimersByTime(1000);
    host.receive({ t: 'draw', ops: [{ k: 'fill', x: 0, y: 0, color: '#000000' }] });
    expect(guest.ofType('draw')).toHaveLength(GAME_MESSAGE_RATE_LIMIT_PER_SECOND + 1);
  });

  it('rate-limits room creation and joining per socket and refuses creates at the room cap', () => {
    const w = world();
    const flooder = w.connect();
    for (let i = 0; i < ROOM_RATE_LIMIT_COUNT * 4; i++) flooder.receive({ t: 'create', gameId: 'skribble', name: 'Mallory', avatar: AVATAR });
    expect(flooder.ofType('welcome')).toHaveLength(ROOM_RATE_LIMIT_COUNT);
    expect(flooder.errors()).toEqual(new Array<string>(ROOM_RATE_LIMIT_COUNT * 3).fill('RATE_LIMITED'));
    // Only the latest room is occupied; the abandoned ones wait for their TTL but count against the cap.
    expect(w.rooms.stats()).toEqual({ rooms: ROOM_RATE_LIMIT_COUNT, players: 1 });
    const code = flooder.last('welcome').room.code;

    // Joins share the budget with creates.
    const joiner = w.connect();
    for (let i = 0; i < ROOM_RATE_LIMIT_COUNT + 1; i++) joiner.receive({ t: 'join', code, name: `J${i}`, avatar: AVATAR });
    expect(joiner.errors()).toEqual(['RATE_LIMITED']);
    vi.advanceTimersByTime(ROOM_RATE_LIMIT_WINDOW_MS);
    joiner.receive({ t: 'join', code, name: 'Late', avatar: AVATAR });
    expect(joiner.errors()).toEqual(['RATE_LIMITED']);
    expect(joiner.last('welcome').room.players.map((p) => p.name)).toEqual(['Mallory', 'Late']);

    // The global room cap refuses further creates with a message, without seating anyone.
    const cappedDriver = new MemoryDriver({ clock: { now: () => Date.now() }, maxRooms: 1 });
    const capped = cappedDriver.rooms;
    const a = new FakeSocket();
    const b = new FakeSocket();
    handleConnection(a, { driver: cappedDriver, clock: { now: () => Date.now() } });
    handleConnection(b, { driver: cappedDriver, clock: { now: () => Date.now() } });
    a.receive({ t: 'create', gameId: 'skribble', name: 'Alice', avatar: AVATAR });
    b.receive({ t: 'create', gameId: 'skribble', name: 'Bob', avatar: AVATAR });
    expect(a.ofType('welcome')).toHaveLength(1);
    expect(b.ofType('welcome')).toHaveLength(0);
    expect(b.last('error')).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/too many rooms/) });
    expect(capped.stats()).toEqual({ rooms: 1, players: 1 });
    b.receive({ t: 'chat', text: 'hi' });
    expect(b.errors()).toEqual(['RATE_LIMITED', 'NOT_ALLOWED']);
  });

  it('terminates sockets that miss a heartbeat pong', () => {
    const w = world();
    const ws = w.connect();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.pings).toBe(1);
    ws.emit('pong');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.pings).toBe(2);
    expect(ws.terminated).toBe(false);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.terminated).toBe(true);
    expect(w.hub.size).toBe(0);
  });

  it('marks a player disconnected when the socket closes and lets a new socket rejoin', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    const code = pair(w, host, guest);
    const { token, playerId } = guest.last('welcome');
    guest.close();
    expect(host.last('room').room.players.find((p) => p.id === playerId)?.connected).toBe(false);

    const again = w.connect();
    again.receive({ t: 'rejoin', code, token: 'wrongtoken' });
    expect(again.errors()).toEqual(['REJOIN_FAILED']);
    again.receive({ t: 'rejoin', code: 'ZZZZ', token });
    expect(again.errors()).toEqual(['REJOIN_FAILED', 'REJOIN_FAILED']);
    again.receive({ t: 'rejoin', code, token });
    expect(again.last('welcome').playerId).toBe(playerId);
    expect(host.last('room').room.players.find((p) => p.id === playerId)?.connected).toBe(true);
    again.receive({ t: 'chat', text: 'back' });
    expect(host.last('chat').message.text).toBe('back');
  });

  it('replaces a stale socket on rejoin and ignores the stale socket closing', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    const code = pair(w, host, guest);
    const { token, playerId } = guest.last('welcome');

    const fresh = w.connect();
    fresh.receive({ t: 'rejoin', code, token });
    expect(fresh.last('welcome').playerId).toBe(playerId);
    expect(guest.closes).toEqual([{ code: CLOSE_REPLACED, reason: 'Replaced by a newer connection' }]);
    // The stale socket's close must not disconnect the seat.
    expect(host.last('room').room.players.find((p) => p.id === playerId)?.connected).toBe(true);
    const roomsBefore = host.ofType('room').length;
    guest.receive({ t: 'chat', text: 'stale' });
    expect(host.ofType('chat').some((m) => m.message.text === 'stale')).toBe(false);
    expect(host.ofType('room')).toHaveLength(roomsBefore);
    fresh.receive({ t: 'chat', text: 'fresh' });
    expect(host.last('chat').message.text).toBe('fresh');
  });

  it('closes the socket of a kicked player and lets a leaver join another room on the same socket', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    pair(w, host, guest);
    const guestId = guest.last('welcome').playerId;
    host.receive({ t: 'kick', playerId: guestId });
    expect(guest.last('kicked').reason).toMatch(/host/);
    expect(guest.closes).toEqual([{ code: CLOSE_REMOVED, reason: 'Removed from room' }]);
    expect(host.last('room').room.players).toHaveLength(1);

    host.receive({ t: 'leave' });
    expect(w.rooms.stats().players).toBe(0);
    host.receive({ t: 'create', gameId: 'skribble', name: 'Alice', avatar: AVATAR });
    expect(host.ofType('welcome')).toHaveLength(2);
    expect(w.rooms.stats()).toEqual({ rooms: 2, players: 1 });
    host.receive({ t: 'chat', text: 'new room' });
    expect(host.errors()).toEqual([]);
  });

  it('runs a Click Race room next to Skribble rooms, codes shared across games', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    host.receive({ t: 'create', gameId: 'template', name: 'Alice', avatar: AVATAR });
    const welcome = host.last('welcome');
    expect(welcome.room).toMatchObject({ gameId: 'template', phase: 'lobby', game: null });
    expect(welcome.room.settings).toMatchObject({ targetClicks: 30, timeLimit: 30 });
    expect(welcome.extra).toBeUndefined();
    guest.receive({ t: 'join', code: welcome.room.code, name: 'Bob', avatar: AVATAR });
    expect(guest.last('welcome').room.gameId).toBe('template');
    // Another game's fields are ignored, the race's own apply.
    host.receive({ t: 'updateSettings', settings: { targetClicks: 10, rounds: 5 } });
    expect(host.errors()).toEqual([]);
    expect(host.last('room').room.settings).toMatchObject({ targetClicks: 10 });
    expect(host.last('room').room.settings).not.toHaveProperty('rounds');
    host.receive({ t: 'start' });
    expect(guest.last('room').room.phase).toBe('playing');
    for (let i = 0; i < 10; i++) guest.receive({ t: 'click' });
    expect(host.last('room').room.phase).toBe('ended');
    expect(host.last('room').room.podium?.[0]).toMatchObject({ playerId: guest.last('welcome').playerId, score: 100, rank: 1 });
    // A Skribble room created meanwhile lives in the same code space.
    const other = w.connect();
    other.receive({ t: 'create', gameId: 'skribble', name: 'Zed', avatar: AVATAR });
    expect(other.last('welcome').room.code).not.toBe(welcome.room.code);
    expect(w.rooms.stats()).toEqual({ rooms: 2, players: 3 });
  });

  it('leaves the previous room when creating or joining another', () => {
    const w = world();
    const host = w.connect();
    const guest = w.connect();
    pair(w, host, guest);
    guest.receive({ t: 'create', gameId: 'skribble', name: 'Bob', avatar: AVATAR });
    expect(host.last('chat').message.text).toBe('Bob left');
    expect(w.rooms.stats()).toEqual({ rooms: 2, players: 2 });
  });
});

/**
 * A driver that answers like the Redis one: every seat operation is a promise the test settles by
 * hand, so the ordering the connection layer must keep (join before chat, close after an in-flight
 * join) can be exercised without Redis.
 */
class SlowDriver implements GameDriver {
  readonly name = 'slow';
  readonly calls: string[] = [];
  readonly seats = new Map<string, string>();
  pendingJoin: ((result: Seat) => void) | null = null;
  // A factory, not a stored promise: an eagerly created rejected promise would be
  // reported as unhandled before connection.ts gets a chance to catch it.
  disconnectedResult: () => Promise<void> = () => Promise.resolve();

  register(connectionId: string): void {
    this.calls.push(`register ${connectionId}`);
  }
  unregister(connectionId: string): void {
    this.calls.push(`unregister ${connectionId}`);
  }
  lookup(code: string): Promise<{ ok: true; code: string }> {
    return Promise.resolve({ ok: true, code });
  }
  create(): never {
    throw new Error('not used');
  }
  join(code: string, name: string, _avatar: unknown, connectionId: string): Promise<{ ok: true; seat: Seat }> {
    this.calls.push(`join ${name}`);
    return new Promise((resolve) => {
      this.pendingJoin = (seat) => {
        this.seats.set(seat.playerId, connectionId);
        resolve({ ok: true, seat });
      };
    });
  }
  rejoin(): never {
    throw new Error('not used');
  }
  leave(): Promise<void> {
    return Promise.resolve();
  }
  disconnected(seat: Seat, connectionId: string): Promise<void> {
    this.calls.push(`disconnected ${seat.playerId} ${connectionId}`);
    return this.disconnectedResult();
  }
  handle(seat: Seat, inbound: RoomInbound): Promise<void> {
    this.calls.push(`handle ${seat.playerId} ${inbound.msg.t}`);
    return Promise.resolve();
  }
  holds(seat: Seat, connectionId: string): boolean {
    return this.seats.get(seat.playerId) === connectionId;
  }
  heartbeat(): void {}
  preview(): never {
    throw new Error('not used');
  }
  health(): never {
    throw new Error('not used');
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe('handleConnection with an asynchronous driver', () => {
  // Promise settlement is what is under test here, not timers.
  beforeEach(() => vi.useRealTimers());
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('delivers a chat queued behind a slow join only once the join has answered', async () => {
    const driver = new SlowDriver();
    const ws = new FakeSocket();
    const connectionId = handleConnection(ws, { driver });
    ws.receive({ t: 'join', code: 'ABCD', name: 'Bob', avatar: AVATAR });
    ws.receive({ t: 'chat', text: 'hi' });
    await flush();
    expect(driver.calls).toEqual([`register ${connectionId}`, 'join Bob']);
    expect(ws.errors()).toEqual([]);
    driver.pendingJoin?.({ code: 'ABCD', playerId: 'p1' });
    await flush();
    expect(driver.calls).toEqual([`register ${connectionId}`, 'join Bob', 'handle p1 chat']);
  });

  it('releases a seat taken by a join that was still in flight when the socket closed', async () => {
    const driver = new SlowDriver();
    const ws = new FakeSocket();
    const connectionId = handleConnection(ws, { driver });
    ws.receive({ t: 'join', code: 'ABCD', name: 'Bob', avatar: AVATAR });
    ws.close();
    await flush();
    driver.pendingJoin?.({ code: 'ABCD', playerId: 'p1' });
    await flush();
    expect(driver.calls).toEqual([`register ${connectionId}`, 'join Bob', `disconnected p1 ${connectionId}`, `unregister ${connectionId}`]);
  });

  it('unregisters the socket even when reporting the disconnect fails', async () => {
    const driver = new SlowDriver();
    driver.disconnectedResult = () => Promise.reject(new Error('redis down'));
    const logs: string[] = [];
    const ws = new FakeSocket();
    const connectionId = handleConnection(ws, { driver, log: (m) => logs.push(m) });
    ws.receive({ t: 'join', code: 'ABCD', name: 'Bob', avatar: AVATAR });
    await flush();
    driver.pendingJoin?.({ code: 'ABCD', playerId: 'p1' });
    await flush();
    ws.close();
    await flush();
    expect(driver.calls.slice(-2)).toEqual([`disconnected p1 ${connectionId}`, `unregister ${connectionId}`]);
    expect(logs.some((l) => l.includes('redis down'))).toBe(true);
  });
});

describe('SocketHub', () => {
  it('only delivers to open sockets bound to the player', () => {
    const hub = new SocketHub();
    const a = new FakeSocket();
    hub.register('c1', a);
    hub.send('p1', { t: 'pong', serverTime: 1 });
    expect(a.sent).toEqual([]);
    hub.attach('p1', 'c1');
    hub.send('p1', { t: 'pong', serverTime: 1 });
    expect(a.sent).toHaveLength(1);
    a.readyState = 2;
    hub.send('p1', { t: 'pong', serverTime: 2 });
    expect(a.sent).toHaveLength(1);
    hub.unregister('c1');
    expect(hub.size).toBe(0);
    hub.close('p1', CLOSE_REMOVED, 'Removed from room');
    hub.attach('p1', 'missing');
  });
});
