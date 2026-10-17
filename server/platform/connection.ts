import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
  GAME_MESSAGE_RATE_LIMIT_PER_SECOND,
  IDLE_AFTER_MS,
  PLATFORM_RATE_LIMIT_COUNT,
  PLATFORM_RATE_LIMIT_WINDOW_MS,
} from '../../shared/platform/constants.js';
import {
  CLOSE_REMOVED,
  CLOSE_REPLACED,
  clientSeqOf,
  isPlatformMessageType,
  isWireMessage,
  platformClientMessageSchema,
  type PlatformClientMessage,
  type PlatformServerMessage,
} from '../../shared/platform/protocol.js';
import { SerialQueue } from './drivers/serial.js';
import { after, sendTo, type GameDriver, type MaybePromise, type RoomInbound, type Seat, type SeatResult, type SocketLike } from './drivers/types.js';
import { RateLimiter } from './rateLimiter.js';
import { systemClock, type Clock } from './transport.js';

export const HEARTBEAT_INTERVAL_MS = 30_000;
/**
 * Room create/join attempts per socket: each one can allocate a room (kept alive for a minute
 * after it is abandoned) or a seat, so a flood from one connection must be refused early.
 */
export const ROOM_RATE_LIMIT_COUNT = 5;
export const ROOM_RATE_LIMIT_WINDOW_MS = 10_000;
/** Restores per socket: each opens a sealed checkpoint, and a phone needs one per restart. */
export const RESTORE_RATE_LIMIT_COUNT = 3;
export const RESTORE_RATE_LIMIT_WINDOW_MS = 30_000;
/** How often a connection checks whether it has gone silent (see IDLE_AFTER_MS). */
export const IDLE_CHECK_MS = 10_000;

export { CLOSE_REMOVED, CLOSE_REPLACED };
/** The per-socket limits live in shared/ so the client can pace a resend to them. */
export { GAME_MESSAGE_RATE_LIMIT_PER_SECOND, PLATFORM_RATE_LIMIT_COUNT, PLATFORM_RATE_LIMIT_WINDOW_MS };
export { SocketHub } from './drivers/socketHub.js';
export type { SocketLike };

export interface ConnectionDeps {
  driver: GameDriver;
  clock?: Clock;
  /** Overridable for tests; defaults to HEARTBEAT_INTERVAL_MS. */
  heartbeatMs?: number;
  /** Overridable for tests; defaults to IDLE_AFTER_MS. */
  idleAfterMs?: number;
  log?: (msg: string) => void;
}

type SessionMessage = Extract<PlatformClientMessage, { t: 'create' | 'join' | 'rejoin' | 'restore' | 'leave' | 'ping' }>;

function isSessionMessage(msg: PlatformClientMessage): msg is SessionMessage {
  return msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin' || msg.t === 'restore' || msg.t === 'leave' || msg.t === 'ping';
}

/**
 * Wires one WebSocket to the game driver: validates every platform frame, applies the per-socket
 * rate limits, tracks the seat the socket holds and heartbeats the connection. Game messages are
 * passed through for the room's game module to validate. Messages are handled in order even when
 * the driver answers asynchronously. Returns the connection id (useful in tests).
 */
export function handleConnection(ws: SocketLike, deps: ConnectionDeps): string {
  const { driver } = deps;
  const clock = deps.clock ?? systemClock;
  const connectionId = randomUUID();
  const chatLimiter = new RateLimiter(CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS);
  const gameLimiter = new RateLimiter(GAME_MESSAGE_RATE_LIMIT_PER_SECOND, 1000);
  const roomLimiter = new RateLimiter(ROOM_RATE_LIMIT_COUNT, ROOM_RATE_LIMIT_WINDOW_MS);
  const platformLimiter = new RateLimiter(PLATFORM_RATE_LIMIT_COUNT, PLATFORM_RATE_LIMIT_WINDOW_MS);
  const restoreLimiter = new RateLimiter(RESTORE_RATE_LIMIT_COUNT, RESTORE_RATE_LIMIT_WINDOW_MS);
  const idleAfterMs = deps.idleAfterMs ?? IDLE_AFTER_MS;
  let seat: Seat | null = null;
  let alive = true;
  /** When the client last sent anything at all (its keep-alive ping included): a frozen phone sends nothing. */
  let lastHeardAt = clock.now();
  /** The room has been told this connection went silent. */
  let idle = false;

  const reply = (msg: PlatformServerMessage): void => sendTo(ws, msg);
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

  // A frozen or backgrounded tab still answers the socket's own pings (the browser does), but its
  // page sends nothing: after a long silence the room shows the player idle.
  const idleCheck = setInterval(() => {
    const s = currentSeat();
    if (!s || idle || clock.now() - lastHeardAt < idleAfterMs) return;
    idle = true;
    queue.push(() => driver.idle(s, connectionId, true));
  }, Math.min(IDLE_CHECK_MS, idleAfterMs));

  const heard = (): void => {
    lastHeardAt = clock.now();
    if (!idle) return;
    idle = false;
    const s = currentSeat();
    if (s) queue.push(() => driver.idle(s, connectionId, false));
  };

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
    if (!result.ok) return reply({ t: 'error', code: result.code, message: result.message, ...(result.roomGone ? { roomGone: true as const } : {}) });
    seat = result.seat;
    idle = false;
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
        return after(leaveCurrentRoom(), () => after(driver.create(msg.gameId, msg.name, msg.avatar, connectionId), takeSeat));
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
          // No live room, but a restart may have lost it: a phone holding a checkpoint can bring it back.
          if (!found.ok) return reply({ t: 'error', code: 'REJOIN_FAILED', message: found.message, ...(found.restorable ? { roomGone: true as const } : {}) });
          return after(leaveCurrentRoom(), () => after(driver.rejoin(found.code, msg.token, connectionId), takeSeat));
        });
      case 'restore':
        if (!restoreLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'Too many tries. Wait a moment.');
        // A room that is live already (another phone brought it back) is simply rejoined.
        return after(leaveCurrentRoom(), () => after(driver.restore(msg.code, msg.token, msg.checkpoint, connectionId), takeSeat));
    }
  };

  const handleRoomMessage = (inbound: RoomInbound): MaybePromise<void> => {
    const s = currentSeat();
    if (!s) return fail('NOT_ALLOWED', 'Join a room first.');
    if (inbound.kind === 'platform' && inbound.msg.t === 'chat') {
      if (!chatLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'You are sending messages too quickly.');
    } else if (inbound.kind === 'platform' && !platformLimiter.tryAcquire(clock.now())) {
      return;
    }
    if (inbound.kind === 'game' && !gameLimiter.tryAcquire(clock.now())) return;
    return driver.handle(s, inbound);
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
    if (!isWireMessage(parsed)) return fail('INVALID_MESSAGE', 'Messages need a string `t`.');
    heard();
    const seq = clientSeqOf(parsed);
    if (!isPlatformMessageType(parsed.t)) {
      const game = parsed;
      queue.push(() => handleRoomMessage({ kind: 'game', msg: game, seq }));
      return;
    }
    const result = platformClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return fail('INVALID_MESSAGE', `${issue?.message ?? 'Invalid message'}${where}`);
    }
    const msg = result.data;
    queue.push(() => (isSessionMessage(msg) ? handleSessionMessage(msg) : handleRoomMessage({ kind: 'platform', msg, seq })));
  });

  ws.on('error', (err) => {
    deps.log?.(`connection ${connectionId} error: ${err.message}`);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(idleCheck);
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
