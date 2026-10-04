import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS } from '../shared/constants.js';
import { CLOSE_REMOVED, CLOSE_REPLACED, clientMessageSchema, type ClientMessage, type ServerMessage } from '../shared/protocol.js';
import { SerialQueue } from './drivers/serial.js';
import { after, sendTo, type GameDriver, type MaybePromise, type Seat, type SeatResult, type SocketLike } from './drivers/types.js';
import { RateLimiter } from './rateLimiter.js';
import type { RoomMessage } from './room.js';
import { systemClock, type Clock } from './transport.js';

export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Draw batches above this rate (per socket, per second) are dropped silently. */
export const DRAW_RATE_LIMIT_PER_SECOND = 60;
/**
 * Room create/join attempts per socket: each one can allocate a room (kept alive for a minute
 * after it is abandoned) or a seat, so a flood from one connection must be refused early.
 */
export const ROOM_RATE_LIMIT_COUNT = 5;
export const ROOM_RATE_LIMIT_WINDOW_MS = 10_000;

export { CLOSE_REMOVED, CLOSE_REPLACED };
export { SocketHub } from './drivers/socketHub.js';
export type { SocketLike };

export interface ConnectionDeps {
  driver: GameDriver;
  clock?: Clock;
  /** Overridable for tests; defaults to HEARTBEAT_INTERVAL_MS. */
  heartbeatMs?: number;
  log?: (msg: string) => void;
}

type SessionMessage = Extract<ClientMessage, { t: 'create' | 'join' | 'rejoin' | 'leave' | 'ping' }>;

function isSessionMessage(msg: ClientMessage): msg is SessionMessage {
  return msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin' || msg.t === 'leave' || msg.t === 'ping';
}

/**
 * Wires one WebSocket to the game driver: validates every frame, applies the per-socket rate
 * limits, tracks the seat the socket holds and heartbeats the connection. Messages are handled
 * in order even when the driver answers asynchronously. Returns the connection id (useful in tests).
 */
export function handleConnection(ws: SocketLike, deps: ConnectionDeps): string {
  const { driver } = deps;
  const clock = deps.clock ?? systemClock;
  const connectionId = randomUUID();
  const chatLimiter = new RateLimiter(CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS);
  const drawLimiter = new RateLimiter(DRAW_RATE_LIMIT_PER_SECOND, 1000);
  const roomLimiter = new RateLimiter(ROOM_RATE_LIMIT_COUNT, ROOM_RATE_LIMIT_WINDOW_MS);
  let seat: Seat | null = null;
  let alive = true;

  const reply = (msg: ServerMessage): void => sendTo(ws, msg);
  const fail = (code: 'INVALID_MESSAGE' | 'NOT_ALLOWED' | 'RATE_LIMITED' | 'INTERNAL' | 'REJOIN_FAILED', message: string): void =>
    reply({ t: 'error', code, message });

  const queue = new SerialQueue((err) => {
    deps.log?.(`connection ${connectionId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    fail('INTERNAL', 'Something went wrong handling that message.');
  });

  driver.register(connectionId, ws);

  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }, deps.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);

  /** Drops the current seat if its socket was replaced by a rejoin elsewhere. */
  const currentSeat = (): Seat | null => {
    if (seat && !driver.holds(seat, connectionId)) seat = null;
    return seat;
  };

  const leaveCurrentRoom = (): MaybePromise<void> => {
    const s = currentSeat();
    seat = null;
    if (s) return driver.leave(s);
  };

  const takeSeat = (result: SeatResult): void => {
    if (!result.ok) return reply({ t: 'error', code: result.code, message: result.message });
    seat = result.seat;
  };

  const handleSessionMessage = (msg: SessionMessage): MaybePromise<void> => {
    switch (msg.t) {
      case 'ping': {
        reply({ t: 'pong', serverTime: clock.now() });
        const s = currentSeat();
        if (s) driver.heartbeat(s, connectionId);
        return;
      }
      case 'leave':
        return leaveCurrentRoom();
      case 'create': {
        if (!roomLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'You are creating or joining rooms too quickly.');
        return after(leaveCurrentRoom(), () => after(driver.create(msg.name, msg.avatar, connectionId), takeSeat));
      }
      case 'join': {
        if (!roomLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'You are creating or joining rooms too quickly.');
        // The current seat is only given up once the target room is known to exist.
        return after(driver.lookup(msg.code), (found) => {
          if (!found.ok) return reply({ t: 'error', code: found.code, message: found.message });
          return after(leaveCurrentRoom(), () => after(driver.join(found.code, msg.name, msg.avatar, connectionId), takeSeat));
        });
      }
      case 'rejoin':
        return after(driver.lookup(msg.code), (found) => {
          if (!found.ok) return fail('REJOIN_FAILED', found.message);
          return after(leaveCurrentRoom(), () => after(driver.rejoin(found.code, msg.token, connectionId), takeSeat));
        });
    }
  };

  const handleRoomMessage = (msg: RoomMessage): MaybePromise<void> => {
    const s = currentSeat();
    if (!s) return fail('NOT_ALLOWED', 'Join a room first.');
    if (msg.t === 'chat' && !chatLimiter.tryAcquire(clock.now())) {
      return fail('RATE_LIMITED', 'You are sending messages too quickly.');
    }
    if (msg.t === 'draw' && !drawLimiter.tryAcquire(clock.now())) return;
    return driver.handle(s, msg);
  };

  ws.on('pong', () => {
    alive = true;
    const s = currentSeat();
    if (s) driver.heartbeat(s, connectionId);
  });

  ws.on('message', (data, isBinary) => {
    alive = true;
    if (isBinary) return fail('INVALID_MESSAGE', 'Binary frames are not supported.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawToString(data));
    } catch {
      return fail('INVALID_MESSAGE', 'Messages must be JSON.');
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return fail('INVALID_MESSAGE', `${issue?.message ?? 'Invalid message'}${where}`);
    }
    const msg = result.data;
    queue.push(() => (isSessionMessage(msg) ? handleSessionMessage(msg) : handleRoomMessage(msg)));
  });

  ws.on('error', (err) => {
    deps.log?.(`connection ${connectionId} error: ${err.message}`);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    // Queued, and the seat read only then: a join the driver was still answering has seated the socket by the time this runs.
    queue.push(() => {
      const s = seat;
      seat = null;
      const unregister = (): void => driver.unregister(connectionId);
      let out: MaybePromise<void>;
      try {
        out = s ? driver.disconnected(s, connectionId) : undefined;
      } catch (err) {
        unregister();
        throw err;
      }
      if (out instanceof Promise) return out.finally(unregister);
      unregister();
    });
  });

  return connectionId;
}

function rawToString(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Adapter so the real `ws` socket satisfies `SocketLike` without widening the drivers' surface. */
export function asSocketLike(ws: WebSocket): SocketLike {
  return ws;
}
