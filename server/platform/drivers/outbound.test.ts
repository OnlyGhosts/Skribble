import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Outbound, SNAPSHOT_BACKLOG_BYTES } from './outbound.js';
import { FakeSocket } from './testSocket.js';
import { MAX_BUFFERED_BYTES, sendTo, type OutboundMessage } from './types.js';

const INTERVAL = 50;

function room(n: number): OutboundMessage {
  return { t: 'room', room: { n } } as unknown as OutboundMessage;
}

/** The order and content a socket received, snapshots as `room:n`. */
function seen(ws: FakeSocket): string[] {
  return ws.sent.map((m) => (m.t === 'room' ? `room:${(m.room as unknown as { n: number }).n}` : m.t));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Outbound', () => {
  it('sends every message straight out with no interval', () => {
    const out = new Outbound(0);
    const ws = new FakeSocket();
    out.send(ws, room(1));
    out.send(ws, room(2));
    expect(seen(ws)).toEqual(['room:1', 'room:2']);
  });

  it('collapses the snapshots of one burst to the newest, sent once the current work is done', () => {
    const out = new Outbound(INTERVAL);
    const ws = new FakeSocket();
    for (let n = 1; n <= 5; n++) out.send(ws, room(n));
    expect(seen(ws)).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(seen(ws)).toEqual(['room:5']);
  });

  it('sends at most one snapshot per interval to a socket, always the newest', () => {
    const out = new Outbound(INTERVAL);
    const ws = new FakeSocket();
    out.send(ws, room(1));
    vi.advanceTimersByTime(0);
    // A flood: a snapshot every millisecond for a second.
    for (let n = 2; n <= 1001; n++) {
      out.send(ws, room(n));
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(INTERVAL);
    const rooms = seen(ws);
    expect(rooms.length).toBeLessThanOrEqual(1 + 1000 / INTERVAL + 1);
    expect(rooms.at(-1)).toBe('room:1001');
  });

  it('keeps the order: a message after a waiting snapshot goes out after it, and a welcome replaces it', () => {
    const out = new Outbound(INTERVAL);
    const ws = new FakeSocket();
    out.send(ws, room(1));
    out.send(ws, { t: 'chat', message: { id: 1, kind: 'system', text: 'hi', ts: 0 } });
    expect(seen(ws)).toEqual(['room:1', 'chat']);
    out.send(ws, room(2));
    out.send(ws, { t: 'welcome', playerId: 'p', token: 't', room: { n: 3 }, chat: [] } as unknown as OutboundMessage);
    vi.advanceTimersByTime(INTERVAL);
    expect(seen(ws)).toEqual(['room:1', 'chat', 'welcome']);
  });

  it('holds snapshots for a socket that is not reading, and sends the newest once it drains', () => {
    const out = new Outbound(INTERVAL);
    const ws = new FakeSocket();
    ws.bufferedAmount = SNAPSHOT_BACKLOG_BYTES + 1;
    out.send(ws, room(1));
    out.send(ws, room(2));
    vi.advanceTimersByTime(INTERVAL * 10);
    expect(seen(ws)).toEqual([]);
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(INTERVAL);
    expect(seen(ws)).toEqual(['room:2']);
  });

  it('drops what waits for a socket that closed', () => {
    const out = new Outbound(INTERVAL);
    const ws = new FakeSocket();
    out.send(ws, room(1));
    ws.close();
    vi.advanceTimersByTime(INTERVAL);
    expect(ws.sent).toEqual([]);
  });
});

describe('sendTo', () => {
  it('cuts off a socket that let more than MAX_BUFFERED_BYTES pile up', () => {
    const ws = new FakeSocket();
    ws.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    sendTo(ws, room(1));
    expect(ws.sent).toEqual([]);
    expect(ws.terminated).toBe(true);
  });
});
