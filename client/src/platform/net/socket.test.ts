import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformClientMessage, PlatformServerMessage, WireMessage } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

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

const { GameSocket, PING_INTERVAL_MS, PONG_TIMEOUT_MS, CLOSE_REPLACED } = await import('./socket');
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
  registerGames(registryOf({}));
});

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
    const { socket, ws } = startSocket();
    ws.receive(welcome('bob', room(), 'tok-1'));
    ws.drop();
    usePlatformStore.getState().resetRoom();
    socket.leave();
    const next = reconnect();
    next.receive({ t: 'error', code: 'REJOIN_FAILED', message: 'expired' });
    expect(usePlatformStore.getState().toasts.map((t) => t.text)).toEqual(['Reconnected']);
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
