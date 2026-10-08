import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformClientMessage, PlatformServerMessage, WireMessage } from '@shared/platform/protocol';
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

const { GameSocket, PING_INTERVAL_MS, PONG_TIMEOUT_MS, PROBE_TIMEOUT_MS, LONG_LIVED_MS, SLOW_RECONNECT_MS, CLOSE_REPLACED } = await import('./socket');
const { SEAT_KEY_PREFIX, loadSeat, saveSeat } = await import('../lib/storage');
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
    expect(toasts).toEqual(['Connection lost — reconnecting…']);
    // Further failed attempts add nothing.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10_000);
      for (const sock of FakeWebSocket.instances) if (sock.readyState === FakeWebSocket.CONNECTING) sock.drop(1006);
    }
    vi.advanceTimersByTime(10_000);
    expect(toasts).toEqual(['Connection lost — reconnecting…']);
    const next = FakeWebSocket.latest();
    next.open();
    expect(toasts).toEqual(['Connection lost — reconnecting…', 'Reconnected']);
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

  it('rejoins from the localStorage seat when the tab was discarded (no session seat)', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() - 120_000 });
    setLocation('/skribble/ABCD');
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
    setLocation('/skribble/ABCD');
    const socket = new GameSocket();
    socket.start();
    expect(usePlatformStore.getState().rejoining).toBe(false);
    const ws = FakeWebSocket.latest();
    ws.open();
    expect(types(ws)).toEqual(['ping']);
  });

  it('drops the entry when the server refuses the rejoin, on an explicit leave and on a kick', () => {
    saveSeat({ code: 'ABCD', token: 'tok-old', playerId: 'bob', savedAt: Date.now() });
    setLocation('/skribble/ABCD');
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
