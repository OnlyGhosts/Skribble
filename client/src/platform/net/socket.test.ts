import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformClientMessage, PlatformServerMessage, RoomState, WireMessage } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { fireEvent, installBrowserGlobals, installFakeStorage, setLocation, setVisibility } from '../../test/env';

installBrowserGlobals();
const storage = installFakeStorage();

type Listener = (ev: unknown) => void;

/** Stand-in for the browser WebSocket: the test opens, feeds and drops it by hand. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: PlatformClientMessage[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as PlatformClientMessage);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = FakeWebSocket.CLOSING;
  }

  // --- test controls ---
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  receive(msg: PlatformServerMessage | WireMessage): void {
    this.emit('message', { data: JSON.stringify(msg) });
  }

  drop(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code });
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  static latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!ws) throw new Error('no socket was opened');
    return ws;
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);

const { GameSocket, PING_INTERVAL_MS, PONG_TIMEOUT_MS, PROBE_TIMEOUT_MS, LONG_LIVED_MS, SLOW_RECONNECT_MS, CLOSE_REPLACED, CONNECT_TIMEOUT_MS, STALE_CONNECTING_MS, SEND_CHECK_MS, SLOW_PILL_MS, QUIET_PLAY_MS, SERVER_RESTARTED_TEXT } = await import('./socket');
const { PACE_MARGIN_MS } = await import('./pacer');
const { REJOIN_RETRY_MS } = await import('./recovery');
const { CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS, CHECKPOINT_MAX_AGE_MS, RECONNECT_GRACE_MS, RESTORE_RETRY_MS } = await import('@shared/platform/constants');
const { CLOSE_RESTARTING } = await import('@shared/platform/protocol');
const { SEAT_KEY_PREFIX, loadSeat, loadSession, saveSeat, saveSession } = await import('../lib/storage');
const { usePlatformStore } = await import('../store/usePlatformStore');
const { registerGames } = await import('../registry');
const { chatLine, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

function startSocket() {
  const socket = new GameSocket();
  socket.start();
  const ws = FakeWebSocket.latest();
  ws.open();
  return { socket, ws };
}

/** Lets the reconnect backoff elapse and opens the socket it created. */
function reconnect(): FakeWebSocket {
  const before = FakeWebSocket.instances.length;
  vi.advanceTimersByTime(10_000);
  expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
  const ws = FakeWebSocket.latest();
  ws.open();
  return ws;
}

const types = (ws: FakeWebSocket) => ws.sent.map((m) => m.t);

/** A game module that records every hook call. */
function spyModule() {
  const hooks = { onServerMessage: vi.fn(() => true), onWelcome: vi.fn(), onRoom: vi.fn(), onChat: vi.fn(), onLeave: vi.fn() };
  registerGames(registryOf(hooks as unknown as AnyGameClientModule));
  return hooks;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  resetStore();
  setLocation('/');
  setVisibility('visible');
  storage.local.clear();
  storage.session.clear();
  registerGames(registryOf({}));
});

/** Keeps an open socket healthy for `ms` of fake time by answering every ping. */
function keepAlive(ws: FakeWebSocket, ms: number): void {
  ws.receive({ t: 'pong', serverTime: Date.now() });
  let elapsed = 0;
  while (elapsed < ms) {
    const step = Math.min(PING_INTERVAL_MS, ms - elapsed);
    vi.advanceTimersByTime(step);
    elapsed += step;
    ws.receive({ t: 'pong', serverTime: Date.now() });
  }
}

/** Every toast added from now on, auto-dismissed ones included. */
function recordToasts(): string[] {
  const seen = new Set<number>();
  const texts: string[] = [];
  usePlatformStore.subscribe((s) => {
    for (const t of s.toasts) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      texts.push(t.text);
    }
  });
  return texts;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('half-open links', () => {
  it('pings right after opening and drops a socket whose pong never comes', () => {
    const { ws } = startSocket();
    expect(types(ws)).toEqual(['ping']);
    expect(usePlatformStore.getState().connection).toBe('connected');

    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(ws.closeCalls).toBe(1);
    expect(usePlatformStore.getState().connection).toBe('reconnecting');

    const next = reconnect();
    expect(next).not.toBe(ws);
    expect(usePlatformStore.getState().connection).toBe('connected');
  });

  it('keeps a socket whose pongs arrive and pings again every interval', () => {
    const { ws } = startSocket();
    ws.receive({ t: 'pong', serverTime: Date.now() });
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.closeCalls).toBe(0);
    expect(types(ws)).toEqual(['ping', 'ping']);
    ws.receive({ t: 'pong', serverTime: Date.now() });
    vi.advanceTimersByTime(PONG_TIMEOUT_MS + 1);
    expect(ws.closeCalls).toBe(0);
    expect(usePlatformStore.getState().connection).toBe('connected');
  });

  it('a pong sets a synced clock offset that room snapshots no longer override', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room({ serverTime: Date.now() + 5000 })));
    expect(usePlatformStore.getState().clockOffset).toBeCloseTo(5000, -2);
    ws.receive({ t: 'pong', serverTime: Date.now() + 1000 });
    expect(usePlatformStore.getState().clockOffset).toBeCloseTo(1000, -2);
    ws.receive({ t: 'room', room: room({ serverTime: Date.now() + 5000 }) });
    expect(usePlatformStore.getState().clockOffset).toBeCloseTo(1000, -2);
  });
});

describe('seat handling across connections', () => {
  it('rejoins from the in-memory seat when web storage is unavailable', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    ws.drop();
    const next = reconnect();
    expect(next.sent).toContainEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(usePlatformStore.getState().rejoining).toBe(true);
  });

  it('stops rejoining when another tab took the seat (CLOSE_REPLACED)', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(CLOSE_REPLACED);
    const state = usePlatformStore.getState();
    expect(state.room).toBeNull();
    expect(state.toasts.map((t) => t.text)).toContain('This room is open in another tab.');
    const next = reconnect();
    expect(types(next)).toEqual(['ping']);
    expect(usePlatformStore.getState().room).toBeNull();
  });

  it('delivers a leave sent while offline as rejoin + leave, without re-entering the room', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop();
    usePlatformStore.getState().resetRoom();
    socket.leave();

    const next = reconnect();
    expect(next.sent).toEqual([{ t: 'ping' }, { t: 'rejoin', code: 'ABCD', token: 'tok-1' }, { t: 'leave' }]);
    // The server answers the rejoin with a welcome before processing the leave: it must not stick.
    next.receive(welcome('bob', room(), 'tok-1'));
    expect(usePlatformStore.getState().room).toBeNull();
    // A later welcome for a seat we actually asked for still works.
    next.receive(welcome('carol', room({ code: 'WXYZ' }), 'tok-2'));
    expect(usePlatformStore.getState().room?.code).toBe('WXYZ');
  });

  it('swallows the REJOIN_FAILED of a seat it only wanted to release', () => {
    const toasts = recordToasts();
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop();
    usePlatformStore.getState().resetRoom();
    socket.leave();
    const next = reconnect();
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'expired' });
    expect(toasts).not.toContainEqual(expect.stringMatching(/rejoin/i));
  });
});

describe('reconnect timing', () => {
  it('reopens at once, backoff reset, when a long-lived connection is cut (the hosting time limit)', () => {
    const toasts = recordToasts();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    keepAlive(ws, LONG_LIVED_MS);
    const before = FakeWebSocket.instances.length;
    ws.drop(1006);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
    const next = FakeWebSocket.latest();
    next.open();
    expect(next.sent).toContainEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    expect(toasts).toEqual([]);
  });

  it('waits for the backoff after a short-lived connection drops', () => {
    const { ws } = startSocket();
    const before = FakeWebSocket.instances.length;
    ws.drop(1006);
    expect(FakeWebSocket.instances.length).toBe(before);
    vi.advanceTimersByTime(400);
    expect(FakeWebSocket.instances.length).toBe(before);
    vi.advanceTimersByTime(600);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('toasts once only when a reconnect drags on, and says so when it is through', () => {
    const toasts = recordToasts();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(1006);
    vi.advanceTimersByTime(SLOW_RECONNECT_MS - 100);
    expect(toasts).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(toasts).toEqual(['Connection lost. Reconnecting…']);
    // Further failed attempts add nothing.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10_000);
      for (const sock of FakeWebSocket.instances) if (sock.readyState === FakeWebSocket.CONNECTING) sock.drop(1006);
    }
    vi.advanceTimersByTime(10_000);
    expect(toasts).toEqual(['Connection lost. Reconnecting…']);
    const next = FakeWebSocket.latest();
    next.open();
    // Open is not back yet: only the seat's welcome is.
    expect(toasts).toEqual(['Connection lost. Reconnecting…']);
    next.receive(welcome('bob', room(), 'tok-1'));
    expect(toasts).toEqual(['Connection lost. Reconnecting…', 'Reconnected']);
  });

  it('shows the pill, not a toast, for a reconnect that goes through quickly', () => {
    const toasts = recordToasts();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(1006);
    expect(usePlatformStore.getState().connection).toBe('reconnecting');
    vi.advanceTimersByTime(1_000); // past the first backoff, well under the toast threshold
    const next = FakeWebSocket.latest();
    expect(next).not.toBe(ws);
    next.open();
    expect(usePlatformStore.getState().connection).toBe('connected');
    vi.advanceTimersByTime(SLOW_RECONNECT_MS);
    expect(toasts).toEqual([]);
  });
});

describe('wake-ups', () => {
  it('reconnects right away, backoff reset, when the page comes back while the socket is down', () => {
    const { ws } = startSocket();
    ws.drop(1006);
    ws.drop(1006);
    const before = FakeWebSocket.instances.length;
    setVisibility('visible');
    fireEvent('document', 'visibilitychange');
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it.each(['online', 'pageshow', 'focus'] as const)('probes an open socket on %s and drops it after a short silence', (type) => {
    const { ws } = startSocket();
    ws.receive({ t: 'pong', serverTime: Date.now() });
    fireEvent('window', type);
    expect(types(ws)).toEqual(['ping', 'ping']);
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS - 1);
    expect(ws.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ws.closeCalls).toBe(1);
    expect(usePlatformStore.getState().connection).toBe('reconnecting');
  });

  it('keeps an open socket that answers the probe', () => {
    const { ws } = startSocket();
    ws.receive({ t: 'pong', serverTime: Date.now() });
    fireEvent('document', 'visibilitychange');
    ws.receive({ t: 'pong', serverTime: Date.now() });
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS + 1);
    expect(ws.closeCalls).toBe(0);
  });

  it('ignores the round trip of a pong that answers a ping from before a suspension', () => {
    const { ws } = startSocket();
    ws.receive({ t: 'pong', serverTime: Date.now() + 1000 });
    expect(usePlatformStore.getState().clockOffset).toBeCloseTo(1000, -2);
    vi.advanceTimersByTime(PING_INTERVAL_MS); // a ping goes out...
    vi.advanceTimersByTime(8_000); // ...and the tab sleeps for a while before the answer lands
    ws.receive({ t: 'pong', serverTime: Date.now() + 1000 });
    expect(usePlatformStore.getState().clockOffset).toBeCloseTo(1000, -2);
  });
});

describe('seat recovery from localStorage', () => {
  it('remembers the seat per room code on welcome and refreshes it at most once a minute', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    const first = loadSeat('ABCD');
    expect(first).toMatchObject({ code: 'ABCD', token: 'tok-1', playerId: 'bob' });
    vi.advanceTimersByTime(30_000);
    ws.receive({ t: 'room', room: room() });
    expect(loadSeat('ABCD')?.savedAt).toBe(first?.savedAt);
    vi.advanceTimersByTime(30_000);
    ws.receive({ t: 'room', room: room() });
    expect(loadSeat('ABCD')?.savedAt).toBe((first?.savedAt ?? 0) + 60_000);
  });

  it('refreshes the seat from the pongs too, so a quiet stretch without snapshots does not let it go stale', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    const first = loadSeat('ABCD')?.savedAt ?? 0;
    // Nothing but pings and their pongs for a while: no snapshot comes during a long reveal or a quiet round.
    keepAlive(ws, PING_INTERVAL_MS * 3);
    expect(loadSeat('ABCD')?.savedAt).toBe(first + PING_INTERVAL_MS * 3);
    keepAlive(ws, PING_INTERVAL_MS);
    // Still at most once a minute.
    expect(loadSeat('ABCD')?.savedAt).toBe(first + PING_INTERVAL_MS * 3);
    keepAlive(ws, PING_INTERVAL_MS * 2);
    expect(loadSeat('ABCD')?.savedAt).toBe(first + PING_INTERVAL_MS * 6);
  });

  it('rejoins from the localStorage seat when the tab was discarded (no session seat)', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() - 120_000 });
    setLocation('/scribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    expect(usePlatformStore.getState().rejoining).toBe(true);
    const ws = FakeWebSocket.latest();
    ws.open();
    expect(ws.sent).toContainEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-old' });
    ws.receive(welcome('bob', room(), 'tok-new'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(usePlatformStore.getState().rejoining).toBe(false);
    expect(loadSeat('ABCD')?.token).toBe('tok-new');
  });

  it('shows the join form (no rejoin) for a seat older than the reconnect grace', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() - 11 * 60_000 });
    setLocation('/scribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    expect(usePlatformStore.getState().rejoining).toBe(false);
    const ws = FakeWebSocket.latest();
    ws.open();
    expect(types(ws)).toEqual(['ping']);
  });

  it('drops the entry when the server refuses the rejoin, on an explicit leave and on a kick', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() });
    setLocation('/scribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    const ws = FakeWebSocket.latest();
    ws.open();
    ws.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'expired' });
    expect(loadSeat('ABCD')).toBeNull();
    expect(usePlatformStore.getState().rejoining).toBe(false);

    ws.receive(welcome('bob', room(), 'tok-1'));
    expect(loadSeat('ABCD')).not.toBeNull();
    socket.leave();
    expect(loadSeat('ABCD')).toBeNull();
    expect(storage.session.length).toBe(0);

    ws.receive(welcome('bob', room(), 'tok-2'));
    expect(loadSeat('ABCD')).not.toBeNull();
    ws.receive({ t: 'kicked', reason: 'kicked' });
    expect(loadSeat('ABCD')).toBeNull();
  });

  it('keeps the entry for the other tab that took the seat over', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(CLOSE_REPLACED);
    expect(storage.local.keys()).toContain(`${SEAT_KEY_PREFIX}ABCD`);
    expect(storage.session.length).toBe(0);
  });
});

describe('game module hooks', () => {
  it('hands welcome extra, snapshots, chat lines and game messages to the room’s game module', () => {
    const hooks = spyModule();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1', { canvas: [] }));
    expect(hooks.onWelcome).toHaveBeenCalledWith({ canvas: [] });
    expect(hooks.onRoom).toHaveBeenCalledTimes(1);
    expect(hooks.onRoom.mock.calls[0][1]).toBeNull(); // a first welcome has no previous room

    const snapshot = room({ serverTime: Date.now() + 1 });
    ws.receive({ t: 'room', room: snapshot });
    expect(hooks.onRoom).toHaveBeenCalledTimes(2);
    expect(hooks.onRoom.mock.calls[1][0]).toEqual(snapshot);
    expect(hooks.onRoom.mock.calls[1][1]).not.toBeNull();

    ws.receive({ t: 'chat', message: chatLine(1, 'correct') });
    expect(hooks.onChat).toHaveBeenCalledWith(chatLine(1, 'correct'));

    ws.receive({ t: 'draw', ops: [] });
    expect(hooks.onServerMessage).toHaveBeenCalledWith({ t: 'draw', ops: [] });
  });

  it('reads a former game id in welcomes and snapshots from a server on the deploy before a rename', () => {
    const hooks = spyModule();
    const { ws } = startSocket();
    // 'skribble' is Scribble's pre-rename id: a server not yet redeployed still sends it.
    const legacy = (overrides: Partial<RoomState> = {}) => ({ ...room(overrides), gameId: 'skribble' }) as unknown as RoomState;
    ws.receive(welcome('bob', legacy(), 'tok-1', { canvas: [] }));
    expect(usePlatformStore.getState().room?.gameId).toBe('scribble');
    expect(loadSession()?.gameId).toBe('scribble');
    expect(hooks.onWelcome).toHaveBeenCalledWith({ canvas: [] });
    expect(hooks.onRoom.mock.calls[0][0].gameId).toBe('scribble');

    ws.receive({ t: 'room', room: legacy({ phase: 'playing', serverTime: Date.now() + 1 }) });
    expect(usePlatformStore.getState().room).toMatchObject({ gameId: 'scribble', phase: 'playing' });
    expect(hooks.onRoom).toHaveBeenCalledTimes(2);
    expect(hooks.onRoom.mock.calls[1][0].gameId).toBe('scribble');
  });

  it('drops game messages that arrive after leaving and calls onLeave once', () => {
    const hooks = spyModule();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    usePlatformStore.getState().resetRoom();
    expect(hooks.onLeave).toHaveBeenCalledTimes(1);
    ws.receive({ t: 'draw', ops: [] });
    ws.receive({ t: 'chat', message: chatLine(2) });
    expect(hooks.onServerMessage).not.toHaveBeenCalled();
    expect(hooks.onChat).not.toHaveBeenCalled();
  });
});

describe('messages a dead link swallowed', () => {
  const sentOf = (ws: FakeWebSocket) => ws.sent as unknown as Array<Record<string, unknown>>;

  it('numbers room messages (not session ones) and sends again, after the rejoin, only those the room never applied', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' });
    socket.send({ t: 'chat', text: 'gg' });
    socket.send({ t: 'draw', ops: [] }, { keep: false });
    const out = sentOf(ws);
    expect(out[0]).toEqual({ t: 'ping' });
    expect(out.slice(1)).toEqual([{ t: 'hit', cs: 1 }, { t: 'chat', text: 'gg', cs: 2 }, { t: 'draw', ops: [] }]);
    // The link was dead: the room only ever got the hit.
    ws.drop(1006);
    const next = reconnect();
    expect(sentOf(next)).toContainEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    next.receive({ ...welcome('bob', room(), 'tok-1'), seq: 1 });
    expect(sentOf(next).slice(-1)).toEqual([{ t: 'chat', text: 'gg', cs: 2 }]);
    // Numbering carries on above what the room has seen.
    socket.send({ t: 'stand' });
    expect(sentOf(next).at(-1)).toEqual({ t: 'stand', cs: 3 });
  });

  it('sends nothing again into another seat, and numbers on above what that seat has seen', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' });
    ws.receive({ ...welcome('carol', room({ code: 'WXYZ' }), 'tok-2'), seq: 40 });
    expect(sentOf(ws).filter((m) => m.t === 'hit')).toHaveLength(1);
    socket.send({ t: 'stand' });
    expect(sentOf(ws).at(-1)).toEqual({ t: 'stand', cs: 41 });
  });

  it('probes after a send the server does not answer, shows the slow pill, then drops the socket', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' });
    vi.advanceTimersByTime(SEND_CHECK_MS - 1);
    expect(types(ws).filter((t) => t === 'ping')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(types(ws).filter((t) => t === 'ping')).toHaveLength(2);
    expect(usePlatformStore.getState().slow).toBe(false);
    vi.advanceTimersByTime(SLOW_PILL_MS);
    expect(usePlatformStore.getState().slow).toBe(true);
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS - SLOW_PILL_MS);
    expect(ws.closeCalls).toBe(1);
    expect(usePlatformStore.getState()).toMatchObject({ connection: 'reconnecting', slow: false });
  });

  it('counts any frame as a sign of life: an answer clears the check, and frames keep a socket whose pong is late', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' });
    ws.receive({ t: 'room', room: room() });
    vi.advanceTimersByTime(SEND_CHECK_MS + SLOW_PILL_MS);
    expect(types(ws).filter((t) => t === 'ping')).toHaveLength(1);
    expect(usePlatformStore.getState().slow).toBe(false);
    // The first ping's pong never came, but snapshots did: the socket is alive.
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - SEND_CHECK_MS - SLOW_PILL_MS);
    expect(ws.closeCalls).toBe(0);
  });

  it('holds what is sent while the rejoin is in flight and sends it after what the room is missing, in order', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' }); // 1: applied
    socket.send({ t: 'ready', ready: true }); // 2 and 3: lost on the dead link
    socket.send({ t: 'chat', text: 'gg' });
    ws.drop(1006);
    const next = reconnect();
    // A tap while the rejoin is in flight: it must not reach the room before 2 and 3 do.
    expect(socket.send({ t: 'stand' })).toBe(true);
    expect(sentOf(next).map((m) => m.t)).toEqual(['ping', 'rejoin']);
    next.receive({ ...welcome('bob', room(), 'tok-1'), seq: 1 });
    expect(sentOf(next).slice(2)).toEqual([
      { t: 'ready', ready: true, cs: 2 },
      { t: 'chat', text: 'gg', cs: 3 },
      { t: 'stand', cs: 4 },
    ]);
  });

  it('sends what the game sends on the welcome (a queued bet) after what the outage held back', () => {
    const { socket, ws } = startSocket();
    const hooks = spyModule();
    ws.receive(welcome('bob', room(), 'tok-1'));
    socket.send({ t: 'hit' });
    ws.drop(1006);
    const next = reconnect();
    hooks.onRoom.mockImplementation(() => void socket.send({ t: 'bet', amount: 10 }));
    next.receive({ ...welcome('bob', room(), 'tok-1'), seq: 0 });
    expect(sentOf(next).slice(2)).toEqual([{ t: 'hit', cs: 1 }, { t: 'bet', amount: 10, cs: 2 }]);
  });

  it('paces a resend to the server’s limits, so none of it is refused, and keeps later sends behind it', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    const guesses = CHAT_RATE_LIMIT_COUNT + 2;
    for (let i = 0; i < guesses; i++) {
      socket.send({ t: 'chat', text: `guess ${i}` });
      vi.advanceTimersByTime(1000); // typed at a normal pace, into a dead link
      ws.receive({ t: 'pong', serverTime: Date.now() });
    }
    ws.drop(1006);
    const next = reconnect();
    next.receive({ ...welcome('bob', room(), 'tok-1'), seq: 0 });
    const chats = () => sentOf(next).filter((m) => m.t === 'chat');
    expect(chats()).toHaveLength(CHAT_RATE_LIMIT_COUNT);
    socket.send({ t: 'hit' });
    expect(sentOf(next).at(-1)?.t).toBe('chat');
    vi.advanceTimersByTime(CHAT_RATE_LIMIT_WINDOW_MS + PACE_MARGIN_MS);
    expect(chats().map((m) => m.cs)).toEqual(Array.from({ length: guesses }, (_, i) => i + 1));
    expect(sentOf(next).at(-1)).toEqual({ t: 'hit', cs: guesses + 1 });
    // Once the backlog is out, sends go straight to the wire again.
    socket.send({ t: 'stand' });
    expect(sentOf(next).at(-1)).toEqual({ t: 'stand', cs: guesses + 2 });
  });

  it('drops a dead socket within a probe of the first unanswered send, however often the player keeps tapping', () => {
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.receive({ t: 'pong', serverTime: Date.now() });
    // A stroke every 2 s into a link that answers nothing.
    for (let t = 0; t < SEND_CHECK_MS + PROBE_TIMEOUT_MS; t += 500) {
      if (t % 2000 === 0) socket.send({ t: 'draw', ops: [] }, { keep: false });
      vi.advanceTimersByTime(500);
    }
    expect(ws.closeCalls).toBe(1);
  });

  it('probes a link that goes quiet during a game, and leaves a quiet lobby to the keep-alive', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room({ phase: 'playing' }), 'tok-1'));
    ws.receive({ t: 'pong', serverTime: Date.now() });
    // The turn came, then the link went silent: nothing for this phone to send.
    vi.advanceTimersByTime(QUIET_PLAY_MS + PROBE_TIMEOUT_MS + 1000);
    expect(ws.closeCalls).toBe(1);

    const next = reconnect();
    next.receive(welcome('bob', room(), 'tok-1'));
    next.receive({ t: 'pong', serverTime: Date.now() });
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(types(next).filter((t) => t === 'ping')).toHaveLength(1);
    expect(next.closeCalls).toBe(0);
  });

  it('gives up an open socket at once when the network goes offline, and listens to it no more', () => {
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    fireEvent('window', 'offline');
    expect(usePlatformStore.getState().connection).toBe('reconnecting');
    ws.receive({ t: 'room', room: room({ phase: 'playing' }) });
    expect(usePlatformStore.getState().room?.phase).toBe('lobby');
  });
});

describe('a handshake that hangs', () => {
  it('gives up on a socket still connecting after CONNECT_TIMEOUT_MS and tries again', () => {
    const socket = new GameSocket();
    socket.start();
    const first = FakeWebSocket.latest();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(usePlatformStore.getState().connection).toBe('connecting');
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1);
    // Closed, not only forgotten: a browser opens one socket per host at a time, so every new
    // attempt would queue behind a handshake left hanging.
    expect(first.closeCalls).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
    // Should it open after all, it is not ours any more.
    first.open();
    expect(first.closeCalls).toBe(2);
    expect(FakeWebSocket.latest()).not.toBe(first);
  });

  it('replaces a socket stuck connecting when the page wakes up or the network comes back', () => {
    const { ws } = startSocket();
    ws.drop(1006);
    vi.advanceTimersByTime(1_000);
    const stuck = FakeWebSocket.latest();
    expect(stuck).not.toBe(ws);
    fireEvent('window', 'online');
    // Too fresh to give up on.
    expect(stuck.closeCalls).toBe(0);
    vi.advanceTimersByTime(STALE_CONNECTING_MS);
    const before = FakeWebSocket.instances.length;
    fireEvent('window', 'online');
    // A fresh attempt starts at once (sockets of earlier tests listen to the same window, hence at least one).
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
    // The stuck handshake is closed, so the new one is not queued behind it.
    expect(stuck.closeCalls).toBe(1);
  });
});

describe('a server restart', () => {
  it('says the server restarted when the rejoin after a dropped connection finds no room', () => {
    const toasts = recordToasts();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(1006);
    const next = reconnect();
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'No room with code ABCD exists.' });
    expect(toasts).toContain(SERVER_RESTARTED_TEXT);
    expect(toasts.some((t) => t.includes('No room'))).toBe(false);
    expect(usePlatformStore.getState().room).toBeNull();
    expect(loadSeat('ABCD')).toBeNull();
  });

  it('still says why when the seat was taken away (a kick), or when nothing dropped', () => {
    const toasts = recordToasts();
    const { ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop(1006);
    const next = reconnect();
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    expect(toasts).not.toContain(SERVER_RESTARTED_TEXT);
    expect(toasts.at(-1)).toMatch(/removed/);
  });
});

describe('typing the code of a room this phone holds a seat in', () => {
  const joinRequest = { t: 'join', code: 'abcd', name: 'Bob', avatar: { color: 0, emoji: 0 } } as const;

  it('goes back into the seat instead of taking a second one', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() });
    const { socket, ws } = startSocket();
    expect(socket.resumeOrJoin({ code: 'ABCD', token: 'tok-old' }, joinRequest)).toBe(true);
    expect(ws.sent.at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-old' });
    ws.receive(welcome('bob', room(), 'tok-new'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(ws.sent.filter((m) => m.t === 'join')).toEqual([]);
  });

  it('joins as a newcomer when the seat is gone, without a rejoin error on screen', () => {
    const toasts = recordToasts();
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() });
    const { socket, ws } = startSocket();
    usePlatformStore.getState().beginJoin(joinRequest);
    socket.resumeOrJoin({ code: 'ABCD', token: 'tok-old' }, joinRequest);
    ws.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' });
    expect(ws.sent.at(-1)).toEqual(joinRequest);
    expect(loadSeat('ABCD')).toBeNull();
    expect(usePlatformStore.getState().joinPending).toBe(true);
    expect(toasts).toEqual([]);
  });
});

describe('surviving a server restart', () => {
  const sentOf = (ws: FakeWebSocket) => ws.sent as unknown as Array<Record<string, unknown>>;
  const roomGone = { t: 'error', code: 'REJOIN_FAILED', message: 'No room with code ABCD exists.', roomGone: true } as const;
  const restore = (checkpoint: string) => ({ t: 'restore', code: 'ABCD', token: 'tok-1', checkpoint });
  const playing = () => room({ phase: 'playing' });

  /** In the room as bob, holding `checkpoint` when given. */
  function seated(checkpoint?: string) {
    const started = startSocket();
    started.ws.receive(welcome('bob', playing(), 'tok-1'));
    if (checkpoint !== undefined) started.ws.receive({ t: 'checkpoint', checkpoint });
    return started;
  }

  it('keeps the newest checkpoint with the seat, through a seat refresh, and only while in the room', () => {
    const { socket, ws } = seated('cp-1');
    expect(loadSeat('ABCD')?.checkpoint).toEqual({ text: 'cp-1', at: Date.now() });
    vi.advanceTimersByTime(1000);
    ws.receive({ t: 'checkpoint', checkpoint: 'cp-2' });
    expect(loadSeat('ABCD')?.checkpoint).toEqual({ text: 'cp-2', at: Date.now() });
    // The minute's refresh of the seat entry keeps it.
    keepAlive(ws, 2 * 60_000);
    expect(loadSeat('ABCD')?.checkpoint?.text).toBe('cp-2');
    // Not a game message: the module never sees it.
    expect(usePlatformStore.getState().toasts).toEqual([]);
    socket.leave();
    expect(loadSeat('ABCD')).toBeNull();
    ws.receive({ t: 'checkpoint', checkpoint: 'cp-late' });
    expect(loadSeat('ABCD')).toBeNull();
  });

  it('drops the checkpoint with the seat on a kick and on a refused rejoin', () => {
    const { ws } = seated('cp-1');
    ws.receive({ t: 'kicked', reason: '' });
    expect(loadSeat('ABCD')).toBeNull();

    ws.receive(welcome('bob', playing(), 'tok-1'));
    ws.receive({ t: 'checkpoint', checkpoint: 'cp-2' });
    ws.drop(1006);
    const next = reconnect();
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' });
    expect(loadSeat('ABCD')).toBeNull();
  });

  it('shows the restarting notice after a restarting close, sends its checkpoint back and carries on with no game-ended message', () => {
    const toasts = recordToasts();
    const hooks = spyModule();
    const { ws } = seated('cp-1');
    ws.receive({ t: 'checkpoint', checkpoint: 'cp-fresh' });
    ws.drop(CLOSE_RESTARTING);
    expect(usePlatformStore.getState().connection).toBe('restarting');
    // The server is still down: a failed attempt keeps the notice.
    vi.advanceTimersByTime(10_000);
    FakeWebSocket.latest().drop(1006);
    expect(usePlatformStore.getState().connection).toBe('restarting');
    vi.advanceTimersByTime(SLOW_RECONNECT_MS);

    const next = reconnect();
    expect(usePlatformStore.getState().connection).toBe('restarting');
    expect(sentOf(next).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    next.receive(roomGone);
    expect(sentOf(next).at(-1)).toEqual(restore('cp-fresh'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(usePlatformStore.getState().rejoining).toBe(true);

    next.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState()).toMatchObject({ connection: 'connected', rejoining: false });
    expect(usePlatformStore.getState().room?.phase).toBe('playing');
    expect(hooks.onLeave).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
    expect(loadSeat('ABCD')?.checkpoint?.text).toBe('cp-fresh');
  });

  it('restores after a hard kill too, the notice showing once the room turns out to be gone', () => {
    const { ws } = seated('cp-1');
    ws.drop(1006);
    expect(usePlatformStore.getState().connection).toBe('reconnecting');
    const next = reconnect();
    expect(usePlatformStore.getState().connection).toBe('connected');
    next.receive(roomGone);
    expect(usePlatformStore.getState().connection).toBe('restarting');
    expect(sentOf(next).at(-1)).toEqual(restore('cp-1'));
  });

  it('sends the taps an outage swallowed once after the restore, after the room’s own count, and holds new ones behind them', () => {
    const { socket, ws } = seated('cp-1');
    socket.send({ t: 'hit' }); // 1: in the checkpoint
    ws.receive({ t: 'checkpoint', checkpoint: 'cp-2' });
    socket.send({ t: 'stand' }); // 2: applied after the last checkpoint, lost with the hard kill
    ws.drop(1006);
    const next = reconnect();
    next.receive(roomGone);
    // A tap while the room is being brought back waits for it.
    socket.send({ t: 'bet', amount: 5 });
    expect(sentOf(next).map((m) => m.t)).toEqual(['ping', 'rejoin', 'restore']);
    next.receive({ ...welcome('bob', playing(), 'tok-1'), seq: 1 });
    expect(sentOf(next).slice(3)).toEqual([
      { t: 'stand', cs: 2 },
      { t: 'bet', amount: 5, cs: 3 },
    ]);
  });

  it('without a checkpoint asks again quietly while another phone brings the room back', () => {
    const toasts = recordToasts();
    const { ws } = seated();
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    next.receive(roomGone);
    expect(types(next).filter((t) => t === 'rejoin')).toHaveLength(1);
    expect(types(next)).not.toContain('restore');
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(types(next).filter((t) => t === 'rejoin')).toHaveLength(2);
    next.receive(roomGone);
    expect(usePlatformStore.getState()).toMatchObject({ connection: 'restarting', rejoining: true });
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    next.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState().connection).toBe('connected');
    expect(toasts).toEqual([]);
    // Nothing left over asks again.
    vi.advanceTimersByTime(REJOIN_RETRY_MS * 3);
    expect(types(next).filter((t) => t === 'rejoin')).toHaveLength(3);
  });

  it('gives up after RESTORE_RETRY_MS without a checkpoint and says the game ended', () => {
    const toasts = recordToasts();
    const { ws } = seated();
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    const start = Date.now();
    next.receive(roomGone);
    while (Date.now() - start < RESTORE_RETRY_MS) {
      vi.advanceTimersByTime(REJOIN_RETRY_MS);
      next.receive({ t: 'pong', serverTime: Date.now() });
      expect(sentOf(next).at(-1)?.t).toBe('rejoin');
      next.receive(roomGone);
    }
    expect(toasts).toEqual([SERVER_RESTARTED_TEXT]);
    expect(usePlatformStore.getState()).toMatchObject({ room: null, connection: 'connected' });
    expect(loadSeat('ABCD')).toBeNull();
  });

  it('says the game ended when the restore is refused, and a kicked seat still hears why', () => {
    const toasts = recordToasts();
    const { ws } = seated('cp-1');
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    next.receive(roomGone);
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'That game could not be brought back.' });
    expect(toasts).toEqual([SERVER_RESTARTED_TEXT]);
    expect(usePlatformStore.getState()).toMatchObject({ room: null, connection: 'connected' });
    expect(loadSeat('ABCD')).toBeNull();

    next.receive(welcome('bob', playing(), 'tok-1'));
    next.receive({ t: 'checkpoint', checkpoint: 'cp-old' });
    next.drop(CLOSE_RESTARTING);
    const again = reconnect();
    again.receive(roomGone);
    again.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    expect(toasts.at(-1)).toMatch(/removed/);
  });

  it('turns a refused restore (too many tries) into quiet rejoins, with no error on screen', () => {
    const toasts = recordToasts();
    const { ws } = seated('cp-1');
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    next.receive(roomGone);
    next.receive({ t: 'error', code: 'RATE_LIMITED', message: 'Too many tries. Wait a moment.' });
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(sentOf(next).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    next.receive(roomGone);
    expect(types(next).filter((t) => t === 'restore')).toHaveLength(1);
    next.receive(welcome('bob', playing(), 'tok-1'));
    expect(toasts).toEqual([]);
  });

  it('sends the restore again when the connection drops before its answer', () => {
    const { ws } = seated('cp-1');
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    next.receive(roomGone);
    next.drop(1006);
    const again = reconnect();
    again.receive(roomGone);
    expect(sentOf(again).at(-1)).toEqual(restore('cp-1'));
  });

  it('restores from the checkpoint kept in localStorage after a reload during the restart', () => {
    // What the page before the reload left: the session, and the seat with its checkpoint.
    saveSession({ code: 'ABCD', gameId: 'scribble', token: 'tok-1', playerId: 'bob' });
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now(), checkpoint: { text: 'cp-1', at: Date.now() } });
    setLocation('/scribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    // The server is still down.
    FakeWebSocket.latest().drop(1006);
    const next = reconnect();
    expect(sentOf(next).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    next.receive(roomGone);
    expect(sentOf(next).at(-1)).toEqual(restore('cp-1'));
    next.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
  });

  it('brings a closed tab’s seat back within the checkpoint’s age, past the reconnect grace', () => {
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now() - RECONNECT_GRACE_MS - 60_000, checkpoint: { text: 'cp-1', at: Date.now() - 60_000 } });
    setLocation('/scribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    const ws = FakeWebSocket.latest();
    ws.open();
    expect(sentOf(ws).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    ws.receive(roomGone);
    expect(sentOf(ws).at(-1)).toEqual(restore('cp-1'));
  });

  it('a typed code tries the checkpoint first and joins as a newcomer if the room cannot come back', () => {
    const joinRequest = { t: 'join', code: 'abcd', name: 'Bob', avatar: { color: 0, emoji: 0 } } as const;
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now(), checkpoint: { text: 'cp-1', at: Date.now() } });
    const { socket, ws } = startSocket();
    usePlatformStore.getState().beginJoin(joinRequest);
    socket.resumeOrJoin({ code: 'ABCD', token: 'tok-1' }, joinRequest);
    ws.receive(roomGone);
    expect(sentOf(ws).at(-1)).toEqual(restore('cp-1'));
    ws.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'That game could not be brought back.' });
    expect(sentOf(ws).at(-1)).toEqual(joinRequest);
    expect(usePlatformStore.getState().connection).toBe('connected');
  });

  it('a typed code without a checkpoint keeps the seat and asks again quietly before joining as a newcomer', () => {
    const toasts = recordToasts();
    const joinRequest = { t: 'join', code: 'abcd', name: 'Bob', avatar: { color: 0, emoji: 0 } } as const;
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now() });
    const { socket, ws } = startSocket();
    usePlatformStore.getState().beginJoin(joinRequest);
    socket.resumeOrJoin({ code: 'ABCD', token: 'tok-1' }, joinRequest);
    ws.receive(roomGone);
    // Another phone may be bringing the room back: the seat stays, and the notice says why we wait.
    expect(types(ws)).not.toContain('join');
    expect(loadSeat('ABCD')?.token).toBe('tok-1');
    expect(usePlatformStore.getState().connection).toBe('restarting');
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(sentOf(ws).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    ws.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(types(ws)).not.toContain('join');
    expect(toasts).toEqual([]);
  });

  it('a typed code joins as a newcomer once the room has not come back within RESTORE_RETRY_MS', () => {
    const joinRequest = { t: 'join', code: 'abcd', name: 'Bob', avatar: { color: 0, emoji: 0 } } as const;
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now() });
    const { socket, ws } = startSocket();
    socket.resumeOrJoin({ code: 'ABCD', token: 'tok-1' }, joinRequest);
    const start = Date.now();
    ws.receive(roomGone);
    while (Date.now() - start < RESTORE_RETRY_MS) {
      vi.advanceTimersByTime(REJOIN_RETRY_MS);
      ws.receive({ t: 'pong', serverTime: Date.now() });
      ws.receive(roomGone);
    }
    expect(sentOf(ws).at(-1)).toEqual(joinRequest);
    expect(loadSeat('ABCD')).toBeNull();
    expect(usePlatformStore.getState().connection).toBe('connected');
  });

  it('a page opened after the restart, holding no checkpoint, keeps its seat and gets back in once another phone restores', () => {
    // Reloaded (or the tab thrown away and opened again) as the server came back: nothing on
    // this page saw the server go away, but the server says a restart may have lost the room.
    saveSession({ code: 'ABCD', gameId: 'scribble', token: 'tok-1', playerId: 'bob' });
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'bob', savedAt: Date.now() });
    setLocation('/scribble/ABCD');
    const toasts = recordToasts();
    const socket = new GameSocket();
    socket.start();
    const ws = FakeWebSocket.latest();
    ws.open();
    ws.receive(roomGone);
    expect(usePlatformStore.getState()).toMatchObject({ connection: 'restarting', rejoining: true });
    expect(loadSeat('ABCD')?.token).toBe('tok-1');
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(sentOf(ws).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    ws.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(toasts).toEqual([]);
  });

  it('a page opened after the restart that waited in vain says the game ended', () => {
    saveSession({ code: 'ABCD', gameId: 'scribble', token: 'tok-1', playerId: 'bob' });
    setLocation('/scribble/ABCD');
    const toasts = recordToasts();
    const socket = new GameSocket();
    socket.start();
    const ws = FakeWebSocket.latest();
    ws.open();
    const start = Date.now();
    ws.receive(roomGone);
    while (Date.now() - start < RESTORE_RETRY_MS) {
      vi.advanceTimersByTime(REJOIN_RETRY_MS);
      ws.receive({ t: 'pong', serverTime: Date.now() });
      ws.receive(roomGone);
    }
    expect(toasts).toEqual([SERVER_RESTARTED_TEXT]);
  });

  it('a page whose room ended normally (no word of a restart) gives up at once', () => {
    saveSession({ code: 'ABCD', gameId: 'scribble', token: 'tok-1', playerId: 'bob' });
    setLocation('/scribble/ABCD');
    const toasts = recordToasts();
    const socket = new GameSocket();
    socket.start();
    const ws = FakeWebSocket.latest();
    ws.open();
    ws.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'No room with code ABCD exists.' });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toBe(SERVER_RESTARTED_TEXT);
    expect(usePlatformStore.getState().rejoining).toBe(false);
  });

  it('drops its copy when the server says it gets no more, and then waits for another phone instead', () => {
    const { ws } = seated('cp-1');
    ws.receive({ t: 'checkpoint', checkpoint: null });
    expect(loadSeat('ABCD')?.checkpoint).toBeUndefined();
    expect(loadSeat('ABCD')?.token).toBe('tok-1');
    ws.drop(CLOSE_RESTARTING);
    const next = reconnect();
    next.receive(roomGone);
    expect(types(next)).not.toContain('restore');
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(sentOf(next).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
  });

  it('never sends a copy too old to open: it waits for another phone instead', () => {
    const { ws } = seated('cp-1');
    keepAlive(ws, CHECKPOINT_MAX_AGE_MS);
    ws.drop(CLOSE_RESTARTING);
    // A connection that lived that long is reopened at once.
    const next = FakeWebSocket.latest();
    next.open();
    next.receive(roomGone);
    expect(types(next)).not.toContain('restore');
    expect(usePlatformStore.getState().connection).toBe('restarting');
  });

  it('does not count the time the server was down against the wait for another phone', () => {
    const toasts = recordToasts();
    const { ws } = seated();
    ws.drop(CLOSE_RESTARTING);
    // The dying server still answered once, then went away for longer than the whole wait.
    const dying = reconnect();
    dying.receive(roomGone);
    dying.drop(1006);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      FakeWebSocket.latest().drop(1006);
    }
    const next = reconnect();
    next.receive(roomGone);
    expect(toasts).toEqual([]);
    vi.advanceTimersByTime(REJOIN_RETRY_MS);
    expect(sentOf(next).at(-1)).toEqual({ t: 'rejoin', code: 'ABCD', token: 'tok-1' });
    next.receive(welcome('bob', playing(), 'tok-1'));
    expect(usePlatformStore.getState().room?.code).toBe('ABCD');
    expect(toasts).toEqual([]);
  });
});
