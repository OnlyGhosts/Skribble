import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS } from '../shared/constants';
import { clientMessageSchema, type ClientMessage, type ServerMessage } from '../shared/protocol';
import type { Player } from './player';
import { RateLimiter } from './rateLimiter';
import type { Room, RoomMessage } from './room';
import type { RoomManager } from './roomManager';
import { systemClock, type Clock, type Transport } from './transport';

export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Draw batches above this rate (per socket, per second) are dropped silently. */
export const DRAW_RATE_LIMIT_PER_SECOND = 60;
/**
 * Room create/join attempts per socket: each one can allocate a room (kept alive for a minute
 * after it is abandoned) or a seat, so a flood from one connection must be refused early.
 */
export const ROOM_RATE_LIMIT_COUNT = 5;
export const ROOM_RATE_LIMIT_WINDOW_MS = 10_000;

/** Close codes the server uses; 4xxx is the application range. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REMOVED = 4002;

/** The subset of the ws API the hub needs; keeps tests free of real sockets. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'message', listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'pong', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

const OPEN = 1;

/** Maps player seats to live sockets. The production `Transport`. */
export class SocketHub implements Transport {
  private readonly sockets = new Map<string, { ws: SocketLike; playerId: string | null }>();
  private readonly byPlayer = new Map<string, string>();

  register(connectionId: string, ws: SocketLike): void {
    this.sockets.set(connectionId, { ws, playerId: null });
  }

  unregister(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    this.sockets.delete(connectionId);
    if (entry.playerId !== null && this.byPlayer.get(entry.playerId) === connectionId) {
      this.byPlayer.delete(entry.playerId);
    }
  }

  attach(playerId: string, connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    const previous = this.byPlayer.get(playerId);
    if (previous !== undefined && previous !== connectionId) {
      const stale = this.sockets.get(previous);
      if (stale) {
        stale.playerId = null;
        stale.ws.close(CLOSE_REPLACED, 'Replaced by a newer connection');
      }
    }
    if (entry.playerId !== null && entry.playerId !== playerId && this.byPlayer.get(entry.playerId) === connectionId) {
      this.byPlayer.delete(entry.playerId);
    }
    entry.playerId = playerId;
    this.byPlayer.set(playerId, connectionId);
  }

  send(playerId: string, msg: ServerMessage): void {
    const connectionId = this.byPlayer.get(playerId);
    const entry = connectionId !== undefined ? this.sockets.get(connectionId) : undefined;
    if (!entry || entry.ws.readyState !== OPEN) return;
    try {
      entry.ws.send(JSON.stringify(msg));
    } catch {
      // A failing socket will surface via its 'close'/'error' events.
    }
  }

  close(playerId: string): void {
    const connectionId = this.byPlayer.get(playerId);
    if (connectionId === undefined) return;
    this.byPlayer.delete(playerId);
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    entry.playerId = null;
    entry.ws.close(CLOSE_REMOVED, 'Removed from room');
  }

  get size(): number {
    return this.sockets.size;
  }
}

export interface ConnectionDeps {
  hub: SocketHub;
  rooms: RoomManager;
  clock?: Clock;
  /** Overridable for tests; defaults to HEARTBEAT_INTERVAL_MS. */
  heartbeatMs?: number;
  log?: (msg: string) => void;
}

interface Session {
  room: Room;
  player: Player;
}

type SessionMessage = Extract<ClientMessage, { t: 'create' | 'join' | 'rejoin' | 'leave' | 'ping' }>;

function isSessionMessage(msg: ClientMessage): msg is SessionMessage {
  return msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin' || msg.t === 'leave' || msg.t === 'ping';
}

/** Wires one WebSocket to the room manager. Returns the connection id (useful in tests). */
export function handleConnection(ws: SocketLike, deps: ConnectionDeps): string {
  const clock = deps.clock ?? systemClock;
  const connectionId = randomUUID();
  const chatLimiter = new RateLimiter(CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS);
  const drawLimiter = new RateLimiter(DRAW_RATE_LIMIT_PER_SECOND, 1000);
  const roomLimiter = new RateLimiter(ROOM_RATE_LIMIT_COUNT, ROOM_RATE_LIMIT_WINDOW_MS);
  let session: Session | null = null;
  let alive = true;

  deps.hub.register(connectionId, ws);

  const reply = (msg: ServerMessage): void => {
    if (ws.readyState !== OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket is going away */
    }
  };
  const fail = (code: 'INVALID_MESSAGE' | 'NOT_ALLOWED' | 'RATE_LIMITED' | 'INTERNAL', message: string): void =>
    reply({ t: 'error', code, message });

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
  const currentSession = (): Session | null => {
    if (session && session.player.connectionId !== connectionId) session = null;
    return session;
  };

  const leaveCurrentRoom = (): void => {
    const s = currentSession();
    if (s) s.room.leave(s.player);
    session = null;
  };

  const handleSessionMessage = (msg: SessionMessage): void => {
    switch (msg.t) {
      case 'ping':
        return reply({ t: 'pong', serverTime: clock.now() });
      case 'leave':
        return leaveCurrentRoom();
      case 'create': {
        if (!roomLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'You are creating or joining rooms too quickly.');
        leaveCurrentRoom();
        const created = deps.rooms.createRoom(msg.name, msg.avatar, connectionId);
        if (!created.ok) return reply({ t: 'error', code: created.code, message: created.message });
        session = { room: created.room, player: created.player };
        return;
      }
      case 'join': {
        if (!roomLimiter.tryAcquire(clock.now())) return fail('RATE_LIMITED', 'You are creating or joining rooms too quickly.');
        const found = deps.rooms.lookup(msg.code);
        if (!found.ok) return reply({ t: 'error', code: found.code, message: found.message });
        leaveCurrentRoom();
        const joined = found.room.join(msg.name, msg.avatar, connectionId);
        if (!joined.ok) return reply({ t: 'error', code: joined.code, message: joined.message });
        session = { room: found.room, player: joined.player };
        return;
      }
      case 'rejoin': {
        const found = deps.rooms.lookup(msg.code);
        if (!found.ok) return reply({ t: 'error', code: 'REJOIN_FAILED', message: found.message });
        leaveCurrentRoom();
        const joined = found.room.rejoin(msg.token, connectionId);
        if (!joined.ok) return reply({ t: 'error', code: joined.code, message: joined.message });
        session = { room: found.room, player: joined.player };
        return;
      }
    }
  };

  const handleRoomMessage = (msg: RoomMessage): void => {
    const s = currentSession();
    if (!s) return fail('NOT_ALLOWED', 'Join a room first.');
    if (msg.t === 'chat' && !chatLimiter.tryAcquire(clock.now())) {
      return fail('RATE_LIMITED', 'You are sending messages too quickly.');
    }
    if (msg.t === 'draw' && !drawLimiter.tryAcquire(clock.now())) return;
    s.room.handleMessage(s.player, msg);
  };

  ws.on('pong', () => {
    alive = true;
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
    try {
      const msg = result.data;
      if (isSessionMessage(msg)) handleSessionMessage(msg);
      else handleRoomMessage(msg);
    } catch (err) {
      deps.log?.(`connection ${connectionId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      fail('INTERNAL', 'Something went wrong handling that message.');
    }
  });

  ws.on('error', (err) => {
    deps.log?.(`connection ${connectionId} error: ${err.message}`);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    deps.hub.unregister(connectionId);
    const s = session;
    session = null;
    if (s) s.room.handleDisconnect(s.player, connectionId);
  });

  return connectionId;
}

function rawToString(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Adapter so the real `ws` socket satisfies `SocketLike` without widening the hub's surface. */
export function asSocketLike(ws: WebSocket): SocketLike {
  return ws;
}
