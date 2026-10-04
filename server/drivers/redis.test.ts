import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHOOSE_TIME_SECONDS, EMPTY_ROOM_TTL_MS, MAX_ACTIONS_PER_TURN, MAX_POINTS_PER_STROKE } from '../../shared/constants.js';
import { CLOSE_REPLACED, type DrawOp, type ServerMessageOf } from '../../shared/protocol.js';
import { MemoryCanvasStore } from '../canvasStore.js';
import { handleConnection } from '../connection.js';
import type { RoomData } from '../engine/state.js';
import { AVATAR, TEST_WORDS } from '../testUtils.js';
import { productionCtx, systemClock } from '../transport.js';
import { RedisDriver, TICK_RETRY_MS, type RedisDriverOptions } from './redis.js';
import { canvasKey, canvasMetaKey, canvasSeqKey, roomChannel, roomKey, type RoomChannelMessage } from './redisKeys.js';
import { RedisRooms } from './redisRooms.js';
import { AsyncLock } from './serial.js';
import { FakeSocket } from './testSocket.js';
import type { Seat } from './types.js';

/**
 * Two RedisDriver instances in one process sharing a throw-away redis-server: the host joins
 * through instance A, the guest through B, and everything must flow across. Skipped (not failed)
 * when no redis-server binary is installed.
 */
const hasRedisServer = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
const hasRedisCli = spawnSync('redis-cli', ['--version'], { stdio: 'ignore' }).status === 0;

const WAIT = { timeout: 5000, interval: 20 };

let redisProcess: ChildProcess;
let port = 0;
let url = '';
let admin: Redis;

beforeAll(async () => {
  if (!hasRedisServer) return;
  port = await freePort();
  redisProcess = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--loglevel', 'warning'], {
    stdio: 'ignore',
  });
  await waitForPort(port);
  url = `redis://127.0.0.1:${port}`;
  admin = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await admin.ping();
}, 20_000);

afterAll(async () => {
  if (!hasRedisServer) return;
  admin.disconnect();
  const exited = new Promise<void>((resolve) => redisProcess.once('exit', () => resolve()));
  redisProcess.kill('SIGKILL');
  await exited;
});

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasRedisServer)('RedisDriver across two instances', () => {
  const drivers: RedisDriver[] = [];
  const logs: string[] = [];
  let connections = 0;

  afterEach(async () => {
    for (const d of drivers) await d.shutdown();
    drivers.length = 0;
    logs.length = 0;
    await admin.flushall();
  });

  function instance(options: Partial<RedisDriverOptions> = {}): RedisDriver {
    const driver = new RedisDriver({ url, log: (m) => logs.push(m), ...options });
    drivers.push(driver);
    return driver;
  }

  interface Client {
    ws: FakeSocket;
    seat: Seat;
    connectionId: string;
    token: string;
    driver: RedisDriver;
  }

  async function seated(driver: RedisDriver, ws: FakeSocket, connectionId: string, result: Awaited<ReturnType<RedisDriver['join']>>): Promise<Client> {
    if (!result.ok) throw new Error(`seat failed: ${result.code} ${result.message}`);
    await vi.waitFor(() => expect(ws.ofType('welcome')).toHaveLength(1), WAIT);
    return { ws, seat: result.seat, connectionId, token: ws.last('welcome').token, driver };
  }

  async function create(driver: RedisDriver, name: string): Promise<Client> {
    const ws = new FakeSocket();
    const connectionId = `conn-${name}-${++connections}`;
    driver.register(connectionId, ws);
    return seated(driver, ws, connectionId, await driver.create(name, AVATAR, connectionId));
  }

  async function join(driver: RedisDriver, code: string, name: string): Promise<Client> {
    const ws = new FakeSocket();
    const connectionId = `conn-${name}-${++connections}`;
    driver.register(connectionId, ws);
    return seated(driver, ws, connectionId, await driver.join(code, name, AVATAR, connectionId));
  }

  async function rejoin(driver: RedisDriver, code: string, token: string, name: string): Promise<Client> {
    const ws = new FakeSocket();
    const connectionId = `conn-${name}-${++connections}`;
    driver.register(connectionId, ws);
    return seated(driver, ws, connectionId, await driver.rejoin(code, token, connectionId));
  }

  /** A room with the host on A and the guest on B, deterministic words, one round. */
  async function pair(a: RedisDriver, b: RedisDriver, drawTime = 60): Promise<{ host: Client; guest: Client; code: string }> {
    const host = await create(a, 'Alice');
    const code = host.seat.code;
    const guest = await join(b, code, 'Bob');
    await a.handle(host.seat, {
      t: 'updateSettings',
      settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1, drawTime, hints: 2, wordChoices: 3 },
    });
    await vi.waitFor(() => expect(guest.ws.last('room').room.settings.rounds).toBe(1), WAIT);
    return { host, guest, code };
  }

  async function startAndChoose(host: Client, guest: Client): Promise<string> {
    await host.driver.handle(host.seat, { t: 'start' });
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('choosing'), WAIT);
    expect(host.ws.last('room').room.phase.kind).toBe('choosing');
    await host.driver.handle(host.seat, { t: 'chooseWord', index: 0 });
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('drawing'), WAIT);
    const phase = host.ws.last('room').room.phase;
    if (phase.kind !== 'drawing' || !phase.word) throw new Error('host is not the drawer');
    return phase.word;
  }

  async function stored(code: string): Promise<RoomData> {
    const raw = await admin.get(`room:${code}`);
    if (raw === null) throw new Error('room missing');
    return JSON.parse(raw) as RoomData;
  }

  const stroke = (id: number, x = 1): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#000000', size: 6, x, y: 2 });

  it('seats players through different instances and fans out snapshots and chat', async () => {
    const a = instance();
    const b = instance();
    const host = await create(a, 'Alice');
    const code = host.seat.code;
    expect(host.ws.last('welcome').room.players.map((p) => p.name)).toEqual(['Alice']);

    expect(await b.lookup(code.toLowerCase())).toEqual({ ok: true, code });
    expect(await b.lookup('ZZZZ')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await b.lookup('AB')).toMatchObject({ ok: false, code: 'INVALID_CODE' });

    const guest = await join(b, code, 'Bob');
    expect(guest.ws.last('welcome').chat.map((c) => c.text)).toEqual(['Alice joined', 'Bob joined']);
    await vi.waitFor(() => expect(host.ws.last('room').room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']), WAIT);
    expect(host.ws.chats()).toEqual([{ kind: 'system', text: 'Bob joined' }]);

    await b.handle(guest.seat, { t: 'chat', text: 'hello from B' });
    await vi.waitFor(() => expect(host.ws.chats()).toContainEqual({ kind: 'chat', text: 'hello from B' }), WAIT);
    expect(guest.ws.chats()).toContainEqual({ kind: 'chat', text: 'hello from B' });

    expect(await a.preview(code)).toMatchObject({ exists: true, code, players: 2, inProgress: false, joinable: true });
    expect(await b.health()).toEqual({ driver: 'redis', rooms: 1, approximate: false });
    expect(a.holds(host.seat, host.connectionId)).toBe(true);
    expect(b.holds(host.seat, host.connectionId)).toBe(false);
    expect(await admin.pttl(`presence:${code}:${host.seat.playerId}`)).toBeGreaterThan(0);
  });

  it('runs a turn across instances: draw ops reach the other side only, undo/clear reach both, a guess ends the turn', async () => {
    const a = instance();
    const b = instance();
    const { host, guest } = await pair(a, b);
    const word = await startAndChoose(host, guest);

    await b.handle(guest.seat, { t: 'draw', ops: [stroke(1)] });
    await vi.waitFor(() => expect(guest.ws.errors()).toEqual(['NOT_ALLOWED']), WAIT);

    await a.handle(host.seat, { t: 'draw', ops: [stroke(1), { k: 'move', id: 1, pts: [3, 4, 5, 6] }, { k: 'end', id: 1 }] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(1), WAIT);
    expect(guest.ws.last('draw').ops).toHaveLength(3);
    expect(host.ws.ofType('draw')).toHaveLength(0);

    await a.handle(host.seat, { t: 'undo' });
    await vi.waitFor(() => expect(guest.ws.ofType('undo')).toHaveLength(1), WAIT);
    await vi.waitFor(() => expect(host.ws.ofType('undo')).toHaveLength(1), WAIT);
    // Undo on an empty canvas is a no-op nobody hears about.
    await a.handle(host.seat, { t: 'undo' });
    await a.handle(host.seat, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#ff0000' }] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(2), WAIT);
    expect(host.ws.ofType('undo')).toHaveLength(1);

    // A late joiner gets the canvas as it stands.
    const late = await join(b, host.seat.code, 'Carol');
    expect(late.ws.last('welcome').canvas).toEqual([{ kind: 'fill', x: 1, y: 1, color: '#ff0000' }]);

    // Everyone already received one 'clear' when the turn started (the engine resets the canvas).
    expect(host.ws.ofType('clear')).toHaveLength(1);
    expect(guest.ws.ofType('clear')).toHaveLength(1);
    await a.handle(host.seat, { t: 'clear' });
    await vi.waitFor(() => expect(guest.ws.ofType('clear')).toHaveLength(2), WAIT);
    await vi.waitFor(() => expect(late.ws.ofType('clear')).toHaveLength(1), WAIT);
    await vi.waitFor(() => expect(host.ws.ofType('clear')).toHaveLength(2), WAIT);

    await b.handle(guest.seat, { t: 'chat', text: word });
    await vi.waitFor(() => expect(host.ws.chats()).toContainEqual({ kind: 'correct', text: 'Bob guessed the word!' }), WAIT);
    expect(guest.ws.chats()).toContainEqual({ kind: 'correct', text: 'Bob guessed the word!' });
    await vi.waitFor(() => expect(late.ws.last('room').room.players.find((p) => p.name === 'Bob')?.score).toBeGreaterThan(0), WAIT);
    // Carol has not guessed, so the turn goes on; her guess ends it for everyone.
    expect(host.ws.last('room').room.phase.kind).toBe('drawing');
    await b.handle(late.seat, { t: 'chat', text: word });
    await vi.waitFor(() => expect(host.ws.last('room').room.phase.kind).toBe('turnEnd'), WAIT);
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('turnEnd'), WAIT);
    expect(late.ws.last('room').room.phase.kind).toBe('turnEnd');
  });

  it('a rejoin from another instance replaces the old socket without a disconnect blip', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    const roomsBefore = host.ws.ofType('room').length;

    const fresh = await rejoin(a, code, guest.token, 'Bob');
    expect(fresh.ws.last('welcome').playerId).toBe(guest.seat.playerId);
    await vi.waitFor(() => expect(guest.ws.closes).toEqual([{ code: CLOSE_REPLACED, reason: 'Replaced by a newer connection' }]), WAIT);
    // The new connection's welcome went to the new socket only; the old one was closed first.
    expect(guest.ws.ofType('welcome')).toHaveLength(1);
    expect(b.holds(guest.seat, guest.connectionId)).toBe(false);
    expect(a.holds(fresh.seat, fresh.connectionId)).toBe(true);
    // The stale socket closing must not disconnect the seat.
    await b.disconnected(guest.seat, guest.connectionId);
    expect(host.ws.ofType('room')).toHaveLength(roomsBefore);
    expect((await stored(code)).players.find((p) => p.id === guest.seat.playerId)?.connected).toBe(true);

    await a.handle(fresh.seat, { t: 'chat', text: 'moved' });
    await vi.waitFor(() => expect(host.ws.chats()).toContainEqual({ kind: 'chat', text: 'moved' }), WAIT);
    expect(guest.ws.chats().some((c) => c.text === 'moved')).toBe(false);

    expect(await b.rejoin(code, 'nope', 'conn-x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
    expect(await b.rejoin('ZZZZ', guest.token, 'conn-y')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
  });

  it('marks a player disconnected when their presence expires (instance gone without closing)', async () => {
    const fast = { presenceTtlMs: 300, reaperIntervalMs: 100 };
    const a = instance(fast);
    const b = instance(fast);
    const { host, guest, code } = await pair(a, b);
    expect(guest.ws.last('welcome').room.players.every((p) => p.connected)).toBe(true);

    // B dies the way a function instance does at its max duration: no close handlers run.
    await b.shutdown();
    await vi.waitFor(() => expect(host.ws.last('room').room.players.find((p) => p.name === 'Bob')?.connected).toBe(false), WAIT);
    const data = await stored(code);
    expect(data.players.find((p) => p.name === 'Bob')?.disconnectedAt).not.toBeNull();
    // The host's own key keeps being refreshed by the reaper even without client pings in this test.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(host.ws.last('room').room.players.find((p) => p.name === 'Alice')?.connected).toBe(true);
  }, 10_000);

  it('catches an idle room up when the first socket arrives after every instance was gone', async () => {
    let skew = 0;
    const clock = { now: () => Date.now() + skew };
    const a = instance({ clock });
    const b = instance({ clock });
    const { host, guest, code } = await pair(a, b, 20);
    await a.handle(host.seat, { t: 'start' });
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('choosing'), WAIT);
    const before = await stored(code);

    await a.shutdown();
    await b.shutdown();
    skew += CHOOSE_TIME_SECONDS * 1000 + 1000;
    expect((await stored(code)).version).toBe(before.version);

    const c = instance({ clock });
    const back = await rejoin(c, code, host.token, 'Alice');
    const welcome = back.ws.last('welcome');
    expect(welcome.room.phase.kind).toBe('drawing');
    expect(TEST_WORDS).toContain(welcome.room.phase.kind === 'drawing' ? welcome.room.phase.word : '');
    expect((await stored(code)).version).toBeGreaterThan(before.version);
    expect(welcome.chat.map((m) => m.text)).toContain('Alice joined');
  });

  it('keeps every chat under concurrent dispatches from both instances', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    const before = (await stored(code)).version;

    const sends: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      sends.push(a.handle(host.seat, { t: 'chat', text: `A${i}` }));
      sends.push(b.handle(guest.seat, { t: 'chat', text: `B${i}` }));
    }
    await Promise.all(sends);

    const expected = [...Array(10).keys()].flatMap((i) => [`A${i}`, `B${i}`]).sort();
    const data = await stored(code);
    expect(data.version).toBe(before + 20);
    expect(data.chat.filter((c) => c.kind === 'chat').map((c) => c.text).sort()).toEqual(expected);
    for (const ws of [host.ws, guest.ws]) {
      await vi.waitFor(() => expect(ws.chats().filter((c) => c.kind === 'chat')).toHaveLength(20), WAIT);
      expect(ws.chats().filter((c) => c.kind === 'chat').map((c) => c.text).sort()).toEqual(expected);
    }
    expect(logs.filter((l) => /gave up/.test(l))).toEqual([]);
  });

  it('deletes every key when the room is destroyed after its empty TTL', async () => {
    let skew = 0;
    const clock = { now: () => Date.now() + skew };
    const a = instance({ clock });
    const b = instance({ clock });
    const { host, guest, code } = await pair(a, b);
    await startAndChoose(host, guest);
    await a.handle(host.seat, { t: 'draw', ops: [stroke(1)] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(1), WAIT);
    expect((await admin.keys('*')).sort()).toEqual(
      [`presence:${code}:${guest.seat.playerId}`, `presence:${code}:${host.seat.playerId}`, `room:${code}`, `room:${code}:canvas`, `room:${code}:canvas:meta`, `room:${code}:canvas:seq`].sort(),
    );

    await b.leave(guest.seat);
    await a.leave(host.seat);
    expect(a.holds(host.seat, host.connectionId)).toBe(false);
    const empty = await stored(code);
    expect(empty.players).toEqual([]);
    expect(empty.grace.emptyRoomAt).not.toBeNull();
    // Leaving reset the canvas (its turn stamp and sequence number stay) and dropped the presence keys; the room record waits for its TTL.
    expect((await admin.keys('*')).sort()).toEqual([`room:${code}`, `room:${code}:canvas:meta`, `room:${code}:canvas:seq`].sort());

    skew += EMPTY_ROOM_TTL_MS + 1000;
    const late = new FakeSocket();
    b.register('conn-late', late);
    expect(await b.join(code, 'Carol', AVATAR, 'conn-late')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await admin.keys('*')).toEqual([]);
    expect(await a.lookup(code)).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await a.health()).toEqual({ driver: 'redis', rooms: 0, approximate: false });
  });

  it('applies the canvas caps exactly like the memory store and replays the same history', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    await startAndChoose(host, guest);
    const memory = new MemoryCanvasStore();

    // One stroke well over the per-stroke cap, then more fills than the action cap allows, then
    // ops that must all be dropped: a duplicate start, a move for an unknown stroke, a late stroke.
    const chunks: DrawOp[][] = [[stroke(1)]];
    for (let i = 0; i < 3; i++) chunks.push([{ k: 'move', id: 1, pts: Array.from({ length: 2000 }, (_, k) => k) }]);
    chunks.push([{ k: 'end', id: 1 }]);
    for (let i = 0; i < 6; i++) chunks.push(Array.from({ length: 100 }, (_, k): DrawOp => ({ k: 'fill', x: i * 100 + k, y: 1, color: '#00ff00' })));
    chunks.push([stroke(1, 9), { k: 'move', id: 7, pts: [1, 2] }, stroke(2), { k: 'end', id: 1 }]);

    const expectedOps: DrawOp[] = [];
    for (const chunk of chunks) {
      expectedOps.push(...memory.append(chunk).accepted);
      await a.handle(host.seat, { t: 'draw', ops: chunk });
    }
    expect(memory.all()).toHaveLength(MAX_ACTIONS_PER_TURN);
    expect(memory.all().reduce((n, a) => n + (a.kind === 'stroke' ? a.points.length : 0), 0)).toBe(MAX_POINTS_PER_STROKE);
    const received = (): DrawOp[] => guest.ws.ofType('draw').flatMap((m) => m.ops);
    await vi.waitFor(() => expect(received()).toHaveLength(expectedOps.length), WAIT);
    expect(received()).toEqual(expectedOps);
    expect(await admin.hget(`room:${code}:canvas:meta`, 'actions')).toBe(String(MAX_ACTIONS_PER_TURN));
    expect(await admin.hget(`room:${code}:canvas:meta`, 'points')).toBe(String(MAX_POINTS_PER_STROKE));

    const late = await join(b, code, 'Carol');
    expect(late.ws.last('welcome').canvas).toEqual(memory.all());
    // The drawer's canvas was truncated: they get a resync after the debounce.
    await vi.waitFor(() => expect(host.ws.ofType('canvas')).toHaveLength(1), { timeout: 3000, interval: 50 });
    expect(host.ws.last('canvas').actions).toEqual(memory.all());

    // Undo pops exactly one action (the last fill) on both sides.
    await a.handle(host.seat, { t: 'undo' });
    memory.undo();
    await vi.waitFor(() => expect(late.ws.ofType('undo')).toHaveLength(1), WAIT);
    const later = await join(b, code, 'Dave');
    expect(later.ws.last('welcome').canvas).toEqual(memory.all());
    expect(later.ws.last('welcome').canvas).toHaveLength(MAX_ACTIONS_PER_TURN - 1);
    // Undoing the stroke frees its points too.
    for (let i = 0; i < MAX_ACTIONS_PER_TURN - 1; i++) {
      await a.handle(host.seat, { t: 'undo' });
      memory.undo();
    }
    expect(await admin.hgetall(`room:${code}:canvas:meta`)).toEqual({ turn: String((await stored(code)).turnId), actions: '0', points: '0' });
    expect(await admin.llen(`room:${code}:canvas`)).toBe(0);
  }, 20_000);

  it('a new turn clears the canvas list and the drawer may not draw after the turn ended', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    const word = await startAndChoose(host, guest);
    await a.handle(host.seat, { t: 'draw', ops: [stroke(1)] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(1), WAIT);
    expect(await admin.llen(`room:${code}:canvas`)).toBe(1);

    await b.handle(guest.seat, { t: 'chat', text: word });
    await vi.waitFor(() => expect(host.ws.last('room').room.phase.kind).toBe('turnEnd'), WAIT);
    // In-flight ops from the previous drawer are dropped silently.
    await a.handle(host.seat, { t: 'draw', ops: [stroke(2)] });
    expect(host.ws.errors()).toEqual([]);
    expect(await admin.llen(`room:${code}:canvas`)).toBe(1);

    // The turn-end timer fires on whichever instance holds a socket; the next turn resets the canvas.
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('choosing'), { timeout: 10_000, interval: 50 });
    expect(await admin.llen(`room:${code}:canvas`)).toBe(0);
    await vi.waitFor(() => expect(guest.ws.ofType('clear').length).toBeGreaterThan(0), WAIT);
    const next = guest.ws.last('room').room.phase;
    expect(next.kind === 'choosing' ? next.drawerId : null).toBe(guest.seat.playerId);
    const welcome: ServerMessageOf<'welcome'> = (await join(a, code, 'Eve')).ws.last('welcome');
    expect(welcome.canvas).toEqual([]);
  }, 15_000);

  it('releases a seat that was taken while its socket was already closing', async () => {
    const a = instance();
    const ws = new FakeSocket();
    handleConnection(ws, { driver: a });
    ws.receive({ t: 'create', name: 'Alice', avatar: AVATAR });
    // The tab closes before Redis has answered the create: the seat must still end up disconnected.
    ws.close();
    await vi.waitFor(async () => expect(await admin.keys('room:????')).toHaveLength(1), WAIT);
    const code = (await admin.keys('room:????'))[0].slice('room:'.length);
    await vi.waitFor(async () => {
      const player = (await stored(code)).players[0];
      expect(player).toMatchObject({ name: 'Alice', connected: false, connectionId: null });
      expect(player.disconnectedAt).not.toBeNull();
    }, WAIT);
    expect(await a.health()).toEqual({ driver: 'redis', rooms: 1, approximate: false });
  });

  it('retries a deadline tick whose dispatch failed instead of stalling the game', async () => {
    let skew = 0;
    const clock = { now: () => Date.now() + skew };
    const a = instance({ clock });
    const { host, guest, code } = await pair(a, a);
    await a.handle(host.seat, { t: 'start' });
    await vi.waitFor(() => expect(guest.ws.last('room').room.phase.kind).toBe('choosing'), WAIT);
    const data = await stored(code);

    // The choose deadline is due, but the only instance's tick fails (the room reads as garbage for a moment).
    skew += CHOOSE_TIME_SECONDS * 1000 + 1000;
    await admin.set(roomKey(code), 'not json');
    const nudge: RoomChannelMessage = { kind: 'effects', version: data.version, data, effects: [] };
    await admin.publish(roomChannel(code), JSON.stringify(nudge));
    await vi.waitFor(() => expect(logs.some((l) => l.includes('tick'))).toBe(true), WAIT);
    await admin.set(roomKey(code), JSON.stringify(data), 'PX', 60_000);
    expect(host.ws.last('room').room.phase.kind).toBe('choosing');

    await vi.waitFor(() => expect(host.ws.last('room').room.phase.kind).toBe('drawing'), { timeout: TICK_RETRY_MS * 4, interval: 20 });
    expect(guest.ws.last('room').room.phase.kind).toBe('drawing');
  });

  it("skips canvas changes a joiner's welcome snapshot already included, and ops of another turn", async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    await startAndChoose(host, guest);
    await a.handle(host.seat, { t: 'draw', ops: [stroke(1)] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(1), WAIT);
    const late = await join(b, code, 'Carol');
    expect(late.ws.last('welcome').canvas).toHaveLength(1);
    const { turnId } = await stored(code);
    const seq = Number(await admin.get(canvasSeqKey(code)));
    const draw = (ops: DrawOp[], overrides: Partial<Extract<RoomChannelMessage, { kind: 'draw' }>>): Promise<number> =>
      admin.publish(roomChannel(code), JSON.stringify({ kind: 'draw', drawerId: host.seat.playerId, ops, turnId, seq, ...overrides }));

    // A batch the drawer's instance published after Carol's snapshot was taken, but which the snapshot already contains.
    await draw([stroke(1)], { seq });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(2), WAIT);
    await settle();
    expect(late.ws.ofType('draw')).toHaveLength(0);
    // A change after the snapshot reaches her; one for a turn that is over reaches nobody.
    await draw([stroke(2)], { seq: seq + 1 });
    await vi.waitFor(() => expect(late.ws.ofType('draw')).toHaveLength(1), WAIT);
    await draw([stroke(3)], { seq: seq + 2, turnId: turnId + 1 });
    await settle();
    expect(late.ws.ofType('draw')).toHaveLength(1);
    expect(guest.ws.ofType('draw')).toHaveLength(3);
  });

  it('refuses ops for a canvas the engine has since reset, without bothering the drawer', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    await startAndChoose(host, guest);
    const { turnId } = await stored(code);
    // Another instance committed a turn change this instance has not seen yet: the canvas now belongs to a later turn.
    await admin.hset(canvasMetaKey(code), 'turn', String(turnId + 1));
    await a.handle(host.seat, { t: 'draw', ops: [stroke(1)] });
    await a.handle(host.seat, { t: 'undo' });
    await a.handle(host.seat, { t: 'clear' });
    await settle();
    expect(await admin.llen(canvasKey(code))).toBe(0);
    expect(host.ws.errors()).toEqual([]);
    expect(guest.ws.ofType('draw')).toHaveLength(0);
    expect(guest.ws.ofType('undo')).toHaveLength(0);
    expect(guest.ws.ofType('clear')).toHaveLength(1);

    await admin.hset(canvasMetaKey(code), 'turn', String(turnId));
    await a.handle(host.seat, { t: 'draw', ops: [stroke(1)] });
    await vi.waitFor(() => expect(guest.ws.ofType('draw')).toHaveLength(1), WAIT);
    expect(await admin.llen(canvasKey(code))).toBe(1);
  });

  it('tells seated sockets when their room vanished, and keeps a live room from expiring', async () => {
    const a = instance();
    const b = instance();
    const { host, guest, code } = await pair(a, b);
    await admin.pexpire(roomKey(code), 5000);
    a.heartbeat(host.seat, host.connectionId);
    await vi.waitFor(async () => expect(await admin.pttl(roomKey(code))).toBeGreaterThan(5000), WAIT);

    await admin.del(roomKey(code));
    await a.handle(host.seat, { t: 'chat', text: 'anyone?' });
    expect(host.ws.errors()).toEqual(['REJOIN_FAILED']);
    expect(a.holds(host.seat, host.connectionId)).toBe(false);
    expect(host.ws.closes).toEqual([]);
    expect(await a.health()).toEqual({ driver: 'redis', rooms: 0, approximate: false });
    // The guest learns the same way, through the first dispatch after the loss.
    await b.handle(guest.seat, { t: 'chat', text: 'hello?' });
    expect(guest.ws.errors()).toEqual(['REJOIN_FAILED']);
    expect(b.holds(guest.seat, guest.connectionId)).toBe(false);
  });
});

describe.skipIf(!hasRedisServer || !hasRedisCli)('RedisRooms compare-and-set', () => {
  afterEach(() => admin.flushall());

  it('does not overwrite a concurrent write when its connection drops between the read and the write', async () => {
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    redis.on('error', () => undefined);
    let hook: (() => void) | null = null;
    const rooms = new RedisRooms(
      redis,
      new AsyncLock(),
      () => {
        hook?.();
        return productionCtx(systemClock, Math.random);
      },
      60_000,
    );
    try {
      const created = await rooms.dispatch('CAS1', { type: 'create', name: 'Alice', avatar: AVATAR, connectionId: 'c1' }, { createIfMissing: true });
      if (!created.ok || !created.result.ok || created.result.playerId === null) throw new Error('create failed');
      const hostId = created.result.playerId;
      const clientId = await redis.client('ID');
      const competing: RoomData = { ...created.data, version: created.data.version + 5, chat: [...created.data.chat, { id: 99, kind: 'system', text: 'Zed joined', ts: 0 }] };
      // Synchronously, between the dispatch's read and its write: the connection dies and another instance commits.
      const cli = (...args: string[]): void => {
        spawnSync('redis-cli', ['-p', String(port), ...args], { stdio: 'ignore' });
      };
      hook = () => {
        hook = null;
        cli('CLIENT', 'KILL', 'ID', String(clientId));
        cli('SET', roomKey('CAS1'), JSON.stringify(competing));
      };
      await rooms.dispatch('CAS1', { type: 'clientMessage', playerId: hostId, msg: { t: 'chat', text: 'hello' } });

      const raw = await redis.get(roomKey('CAS1'));
      const after = JSON.parse(raw ?? 'null') as RoomData;
      expect(after.version).toBe(competing.version + 1);
      expect(after.chat.map((c) => c.text)).toEqual(['Alice joined', 'Zed joined', 'hello']);
    } finally {
      redis.disconnect();
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`redis-server did not open port ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
