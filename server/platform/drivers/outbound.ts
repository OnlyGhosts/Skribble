import { SOCKET_OPEN, sendTo, type OutboundMessage, type SocketLike } from './types.js';

/** Production pace of room snapshots to one socket: at most one per this many ms. */
export const SNAPSHOT_INTERVAL_MS = 50;
/** A socket with more than this still to send gets no snapshot until it drains (only the newest waits). */
export const SNAPSHOT_BACKLOG_BYTES = 256 * 1024;

interface Lane {
  /** When the last snapshot went out. */
  sentAt: number;
  /** The newest snapshot not sent yet. */
  pending: OutboundMessage | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Paces what goes out on each socket. A room snapshot replaces the whole room on the client, so
 * snapshots to one socket are coalesced: the newest waits out the rest of the interval (and any
 * backlog on a slow socket) and the ones it replaced are never serialised. Every other message
 * goes out at once, after the snapshot it followed, so the order a player sees never changes;
 * a welcome carries the room itself and replaces a waiting snapshot. With an interval of 0 every
 * message goes straight out (the unit tests' synchronous world).
 */
export class Outbound {
  private readonly lanes = new WeakMap<SocketLike, Lane>();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  send(ws: SocketLike, msg: OutboundMessage): void {
    if (this.intervalMs <= 0) return sendTo(ws, msg);
    if (msg.t === 'room') return this.snapshot(ws, msg);
    const lane = this.lanes.get(ws);
    if (lane?.pending) {
      if (msg.t === 'welcome') this.drop(lane);
      else this.flush(ws, lane);
    }
    sendTo(ws, msg);
  }

  private snapshot(ws: SocketLike, msg: OutboundMessage): void {
    let lane = this.lanes.get(ws);
    if (!lane) {
      lane = { sentAt: -Infinity, pending: null, timer: null };
      this.lanes.set(ws, lane);
    }
    lane.pending = msg;
    // Snapshots from one action (or a burst of actions) collapse to the last: it goes out once the
    // current work is done, or when the interval since the last one is up.
    if (lane.timer === null) this.arm(ws, lane, Math.max(0, lane.sentAt + this.intervalMs - this.now()));
  }

  private arm(ws: SocketLike, lane: Lane, delay: number): void {
    lane.timer = setTimeout(() => {
      lane.timer = null;
      if (!lane.pending || ws.readyState !== SOCKET_OPEN) return this.drop(lane);
      // A socket still busy with what it was sent gets nothing more yet; sendTo cuts off one that never drains.
      if (ws.bufferedAmount > SNAPSHOT_BACKLOG_BYTES) return this.arm(ws, lane, this.intervalMs);
      this.flush(ws, lane);
    }, delay);
  }

  private flush(ws: SocketLike, lane: Lane): void {
    const msg = lane.pending;
    this.drop(lane);
    if (!msg) return;
    lane.sentAt = this.now();
    sendTo(ws, msg);
  }

  private drop(lane: Lane): void {
    lane.pending = null;
    if (lane.timer !== null) clearTimeout(lane.timer);
    lane.timer = null;
  }
}
