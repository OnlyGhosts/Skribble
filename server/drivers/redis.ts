import { randomBytes, randomUUID } from 'node:crypto';
import { Redis, type RedisOptions } from 'ioredis';
import type { Avatar } from '../../shared/avatar';
import { CLOSE_REPLACED, type CanvasAction, type DrawOp, type RoomPreview, type ServerMessage } from '../../shared/protocol';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, roomCodeHint } from '../../shared/roomCode';
import type { Action, Ctx } from '../engine/actions';
import { resolveRecipients } from '../engine/effects';
import { canDraw, connectedIds, findPlayer, inProgress, isDrawer, isJoinable } from '../engine/players';
import { applyAction } from '../engine/reduce';
import type { RoomData } from '../engine/state';
import { nextDeadline } from '../engine/time';
import { viewFor } from '../engine/view';
import type { RoomMessage } from '../room';
import { systemClock, type Clock, type Rng } from '../transport';
import { RedisCanvas } from './redisCanvas';
import { PRESENCE_TTL_MS, parseChannelMessage, roomChannel, type RoomChannelMessage } from './redisKeys';
import { RedisRooms } from './redisRooms';
import { AsyncLock } from './serial';
import { SOCKET_OPEN, sendTo, type DriverHealth, type GameDriver, type LookupResult, type Seat, type SeatResult, type SocketLike } from './types';

export interface RedisDriverOptions {
  url: string;
  log?: (msg: string) => void;
  clock?: Clock;
  rng?: Rng;
  /** Defaults to PRESENCE_TTL_MS; tests shorten it. */
  presenceTtlMs?: number;
  /** How often an instance checks the presence keys of the rooms it holds sockets for. */
  reaperIntervalMs?: number;
}

export const REAPER_INTERVAL_MS = 30_000;
const CANVAS_RESYNC_DEBOUNCE_MS = 1000;
const MAX_CODE_ATTEMPTS = 50;
const MAX_TIMER_MS = 2 ** 31 - 1;

type Timer = ReturnType<typeof setTimeout>;

interface SocketEntry {
  ws: SocketLike;
  seat: Seat | null;
}

/** What this instance knows about a room it holds sockets for. */
interface LocalRoom {
  code: string;
  /** The newest state seen, from our own writes or the channel. */
  data: RoomData | null;
  /** playerId -> connectionId of the seats whose sockets live in this process. */
  seats: Map<string, string>;
  /** Seat operations in flight; the room is not released while one runs. */
  pending: number;
  /** Resolves once the channel subscription is live (and an idle room caught up). */
  ready: Promise<void>;
  /** Channel messages are applied one at a time, in order. */
  inbox: AsyncLock;
  deadline: Timer | null;
  reaper: Timer | null;
  resync: Timer | null;
}

/**
 * Rooms in Redis, sockets in whichever instance accepted them. Every instance is equal: actions
 * are applied with optimistic concurrency and their effects published on the room's channel, and
 * each instance delivers the effects to its own sockets, the dispatcher included. Timers run on
 * every instance that holds a socket for the room (ticks are idempotent), and a presence key per
 * connected player lets the survivors notice an instance that vanished without closing anything.
 */
export class RedisDriver implements GameDriver {
  readonly name = 'redis';
  private readonly redis: Redis;
  private readonly tx: Redis;
  private readonly sub: Redis;
  private readonly rooms: RedisRooms;
  private readonly canvas: RedisCanvas;
  private readonly sockets = new Map<string, SocketEntry>();
  private readonly locals = new Map<string, LocalRoom>();
  private readonly log: (msg: string) => void;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly reaperIntervalMs: number;
  private closed = false;

  constructor(options: RedisDriverOptions) {
    this.log = options.log ?? (() => undefined);
    this.clock = options.clock ?? systemClock;
    this.rng = options.rng ?? Math.random;
    this.reaperIntervalMs = options.reaperIntervalMs ?? REAPER_INTERVAL_MS;
    this.redis = this.connection(options.url);
    this.tx = this.connection(options.url);
    this.sub = this.connection(options.url);
    this.sub.on('message', (channel: string, raw: string) => this.onChannelMessage(channel, raw));
    this.rooms = new RedisRooms(this.redis, this.tx, new AsyncLock(), () => this.ctx(), options.presenceTtlMs ?? PRESENCE_TTL_MS);
    this.canvas = new RedisCanvas(this.redis, new AsyncLock());
  }

  // ---------------------------------------------------------------------------
  // Sockets
  // ---------------------------------------------------------------------------

  register(connectionId: string, ws: SocketLike): void {
    this.sockets.set(connectionId, { ws, seat: null });
  }

  unregister(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    this.sockets.delete(connectionId);
    if (entry?.seat) this.unbind(entry.seat, connectionId);
  }

  holds(seat: Seat, connectionId: string): boolean {
    return this.locals.get(seat.code)?.seats.get(seat.playerId) === connectionId;
  }

  heartbeat(seat: Seat, connectionId: string): void {
    if (!this.holds(seat, connectionId)) return;
    this.rooms.touch(seat.code, seat.playerId, connectionId).catch((err: unknown) => this.warn('presence', err));
  }

  // ---------------------------------------------------------------------------
  // Seats
  // ---------------------------------------------------------------------------

  async lookup(input: string): Promise<LookupResult> {
    const code = normalizeRoomCode(input);
    if (!isValidRoomCode(code)) return { ok: false, code: 'INVALID_CODE', message: roomCodeHint() };
    if (!(await this.rooms.exists(code))) return { ok: false, code: 'ROOM_NOT_FOUND', message: `No room with code ${code} exists.` };
    return { ok: true, code };
  }

  async create(name: string, avatar: Avatar, connectionId: string): Promise<SeatResult> {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const code = generateRoomCode(this.rng);
      const result = await this.seat(code, { type: 'create', name, avatar, connectionId }, connectionId);
      // The engine refuses to create into a room that already has players: that code is taken.
      if (result.ok || result.code !== 'INTERNAL') return result;
    }
    throw new Error('unable to allocate a unique room code');
  }

  join(code: string, name: string, avatar: Avatar, connectionId: string): Promise<SeatResult> {
    return this.seat(code, { type: 'join', name, avatar, connectionId }, connectionId);
  }

  async rejoin(code: string, token: string, connectionId: string): Promise<SeatResult> {
    const result = await this.seat(code, { type: 'rejoin', token, connectionId }, connectionId);
    if (!result.ok && result.code === 'ROOM_NOT_FOUND') return { ok: false, code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' };
    return result;
  }

  async leave(seat: Seat): Promise<void> {
    const connectionId = this.locals.get(seat.code)?.seats.get(seat.playerId);
    if (connectionId !== undefined) this.unbind(seat, connectionId);
    await this.rooms.dispatch(seat.code, { type: 'leave', playerId: seat.playerId });
  }

  async disconnected(seat: Seat, connectionId: string): Promise<void> {
    if (!this.holds(seat, connectionId)) return;
    try {
      await this.rooms.dispatch(seat.code, { type: 'connectionClosed', playerId: seat.playerId, connectionId });
    } finally {
      this.unbind(seat, connectionId);
    }
  }

  async handle(seat: Seat, msg: RoomMessage): Promise<void> {
    switch (msg.t) {
      case 'draw':
        return this.draw(seat, msg.ops);
      case 'undo':
        return this.undo(seat);
      case 'clear':
        return this.clear(seat);
      default:
        await this.rooms.dispatch(seat.code, { type: 'clientMessage', playerId: seat.playerId, msg });
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  async preview(input: string): Promise<RoomPreview> {
    const code = normalizeRoomCode(input);
    if (!isValidRoomCode(code)) return { exists: false, code, reason: 'INVALID_CODE' };
    const stored = await this.rooms.read(code);
    if (!stored) return { exists: false, code, reason: 'ROOM_NOT_FOUND' };
    // Nobody ticks a room without sockets, so apply the overdue deadlines to what is shown (without storing).
    const { data } = applyAction(stored, { type: 'tick' }, this.ctx());
    return {
      exists: true,
      code,
      players: data.players.length,
      maxPlayers: data.settings.maxPlayers,
      inProgress: inProgress(data),
      joinable: isJoinable(data),
    };
  }

  async health(): Promise<DriverHealth> {
    const { rooms, approximate } = await this.rooms.countRooms();
    return { driver: this.name, rooms, approximate };
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const local of this.locals.values()) this.stopTimers(local);
    this.locals.clear();
    this.sub.disconnect();
    this.tx.disconnect();
    this.redis.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Dispatch + local bindings
  // ---------------------------------------------------------------------------

  private async seat(code: string, action: Extract<Action, { type: 'create' | 'join' | 'rejoin' }>, connectionId: string): Promise<SeatResult> {
    const creating = action.type === 'create';
    const local = await this.acquire(code, !creating);
    local.pending++;
    try {
      const dispatched = await this.rooms.dispatch(code, action, {
        createIfMissing: creating,
        onApplied: (data, result) => {
          this.remember(local, data);
          if (result.ok && result.playerId !== null) this.bind(local, result.playerId, connectionId);
        },
      });
      if (!dispatched.ok) return dispatched;
      if (!dispatched.result.ok) return dispatched.result;
      if (dispatched.result.playerId === null) return { ok: false, code: 'INTERNAL', message: 'Could not seat the player.' };
      return { ok: true, seat: { code, playerId: dispatched.result.playerId } };
    } finally {
      local.pending--;
      this.release(local);
    }
  }

  /** The local room for `code`, subscribing to its channel first; an idle room is ticked up to date. */
  private acquire(code: string, catchUp: boolean): Promise<LocalRoom> {
    let local = this.locals.get(code);
    if (!local) {
      const created: LocalRoom = {
        code,
        data: null,
        seats: new Map(),
        pending: 0,
        ready: Promise.resolve(),
        inbox: new AsyncLock(),
        deadline: null,
        reaper: null,
        resync: null,
      };
      created.ready = (async () => {
        try {
          await this.sub.subscribe(roomChannel(code));
          if (!catchUp) return;
          const ticked = await this.rooms.dispatch(code, { type: 'tick' });
          if (ticked.ok) this.remember(created, ticked.data);
        } catch (err) {
          if (this.locals.get(code) === created) this.locals.delete(code);
          throw err;
        }
      })();
      this.locals.set(code, created);
      local = created;
    }
    return local.ready.then(() => local);
  }

  /** Forgets a room nobody here is connected to any more. */
  private release(local: LocalRoom): void {
    if (local.seats.size > 0 || local.pending > 0 || this.locals.get(local.code) !== local) return;
    this.locals.delete(local.code);
    this.stopTimers(local);
    if (!this.closed) this.sub.unsubscribe(roomChannel(local.code)).catch((err: unknown) => this.warn('unsubscribe', err));
  }

  private remember(local: LocalRoom, data: RoomData): void {
    if (!local.data || data.version >= local.data.version) local.data = data;
  }

  private bind(local: LocalRoom, playerId: string, connectionId: string): void {
    const previous = local.seats.get(playerId);
    if (previous !== undefined && previous !== connectionId) {
      const stale = this.sockets.get(previous);
      if (stale) {
        stale.seat = null;
        stale.ws.close(CLOSE_REPLACED, 'Replaced by a newer connection');
      }
    }
    const entry = this.sockets.get(connectionId);
    if (entry?.seat && (entry.seat.code !== local.code || entry.seat.playerId !== playerId)) this.unbind(entry.seat, connectionId);
    local.seats.set(playerId, connectionId);
    if (entry) entry.seat = { code: local.code, playerId };
    this.startTimers(local);
  }

  private unbind(seat: Seat, connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (entry?.seat && entry.seat.code === seat.code && entry.seat.playerId === seat.playerId) entry.seat = null;
    const local = this.locals.get(seat.code);
    if (local && local.seats.get(seat.playerId) === connectionId) {
      local.seats.delete(seat.playerId);
      this.release(local);
    }
  }

  private ctx(): Ctx {
    return {
      now: this.clock.now(),
      rng: this.rng,
      newId: () => randomUUID(),
      newToken: () => randomBytes(16).toString('hex'),
    };
  }

  // ---------------------------------------------------------------------------
  // Canvas (ops never touch the engine; it only authorises the drawer)
  // ---------------------------------------------------------------------------

  private async authoriseDrawer(seat: Seat): Promise<boolean> {
    const local = this.locals.get(seat.code);
    const data = local?.data ?? (await this.rooms.read(seat.code));
    if (!data) return false;
    if (canDraw(data, seat.playerId, this.clock.now())) return true;
    // Ops the drawer had in flight when their turn ended are expected; only strangers get an error.
    if (!isDrawer(data, seat.playerId) && local) {
      this.sendLocal(local, seat.playerId, { t: 'error', code: 'NOT_ALLOWED', message: 'Only the drawer can draw right now.' });
    }
    return false;
  }

  private async draw(seat: Seat, ops: DrawOp[]): Promise<void> {
    if (!(await this.authoriseDrawer(seat))) return;
    const { accepted, truncated } = await this.canvas.append(seat.code, ops);
    if (accepted.length > 0) await this.rooms.publish(seat.code, { kind: 'draw', drawerId: seat.playerId, ops: accepted });
    // The drawer applied the full ops locally; bring their canvas back to what everyone else has.
    const local = this.locals.get(seat.code);
    if (truncated && local) this.scheduleResync(local, seat.playerId);
  }

  private async undo(seat: Seat): Promise<void> {
    if (!(await this.authoriseDrawer(seat))) return;
    if (await this.canvas.undo(seat.code)) await this.rooms.publish(seat.code, { kind: 'undo' });
  }

  private async clear(seat: Seat): Promise<void> {
    if (!(await this.authoriseDrawer(seat))) return;
    await this.canvas.clear(seat.code);
    await this.rooms.publish(seat.code, { kind: 'clear' });
  }

  private scheduleResync(local: LocalRoom, drawerId: string): void {
    if (local.resync) return;
    local.resync = setTimeout(() => {
      local.resync = null;
      if (!local.data || !canDraw(local.data, drawerId, this.clock.now())) return;
      this.canvas
        .load(local.code)
        .then((actions: CanvasAction[]) => this.sendLocal(local, drawerId, { t: 'canvas', actions }))
        .catch((err: unknown) => this.warn('canvas resync', err));
    }, CANVAS_RESYNC_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Channel: every instance applies the published effects to its own sockets
  // ---------------------------------------------------------------------------

  private onChannelMessage(channel: string, raw: string): void {
    const local = this.locals.get(channel.slice('room:'.length));
    if (!local) return;
    const msg = parseChannelMessage(raw);
    if (!msg) return;
    local.inbox.run(() => this.apply(local, msg)).catch((err: unknown) => this.warn(`room ${local.code}`, err));
  }

  private async apply(local: LocalRoom, msg: RoomChannelMessage): Promise<void> {
    if (this.locals.get(local.code) !== local) return;
    switch (msg.kind) {
      case 'draw':
        for (const id of this.localConnected(local)) if (id !== msg.drawerId) this.sendLocal(local, id, { t: 'draw', ops: msg.ops });
        return;
      case 'undo':
      case 'clear':
        for (const id of this.localConnected(local)) this.sendLocal(local, id, { t: msg.kind });
        return;
      case 'effects':
        return this.applyEffects(local, msg);
    }
  }

  private async applyEffects(local: LocalRoom, msg: Extract<RoomChannelMessage, { kind: 'effects' }>): Promise<void> {
    // Publishes from different instances can cross; snapshots from an older version must not win.
    const stale = local.data !== null && msg.version < local.data.version;
    if (!stale) local.data = msg.data;
    let destroyed = false;
    for (const effect of msg.effects) {
      switch (effect.type) {
        case 'send':
          if (stale && effect.msg.t === 'room') break;
          for (const id of resolveRecipients(msg.data, effect.to)) this.sendLocal(local, id, effect.msg);
          break;
        case 'welcome': {
          if (!local.seats.has(effect.playerId)) break;
          const canvas = await this.canvas.load(local.code);
          const room = stale && local.data ? viewFor(local.data, effect.playerId, this.clock.now()) : effect.msg.room;
          this.sendLocal(local, effect.playerId, { ...effect.msg, room, canvas });
          break;
        }
        case 'close':
          this.closeLocal(local, effect.playerId, effect.code, effect.reason);
          break;
        case 'canvas':
          for (const id of connectedIds(msg.data)) this.sendLocal(local, id, { t: 'clear' });
          break;
        case 'destroy':
          destroyed = true;
          break;
      }
    }
    if (stale && local.data) {
      const now = this.clock.now();
      for (const id of local.seats.keys()) this.sendLocal(local, id, { t: 'room', room: viewFor(local.data, id, now) });
    }
    if (destroyed) {
      local.pending = 0;
      local.seats.clear();
      this.release(local);
      return;
    }
    this.reconcile(local);
    this.arm(local);
  }

  /** Seats that moved to another connection (a rejoin elsewhere) or vanished lose their local socket. */
  private reconcile(local: LocalRoom): void {
    const data = local.data;
    if (!data) return;
    for (const [playerId, connectionId] of [...local.seats]) {
      const player = findPlayer(data, playerId);
      if (!player) this.unbind({ code: local.code, playerId }, connectionId);
      else if (player.connectionId !== connectionId) this.closeLocal(local, playerId, CLOSE_REPLACED, 'Replaced by a newer connection');
    }
    this.release(local);
  }

  private localConnected(local: LocalRoom): string[] {
    return local.data ? connectedIds(local.data).filter((id) => local.seats.has(id)) : [];
  }

  private sendLocal(local: LocalRoom, playerId: string, msg: ServerMessage): void {
    const connectionId = local.seats.get(playerId);
    const entry = connectionId !== undefined ? this.sockets.get(connectionId) : undefined;
    if (entry) sendTo(entry.ws, msg);
  }

  private closeLocal(local: LocalRoom, playerId: string, code: number, reason: string): void {
    const connectionId = local.seats.get(playerId);
    if (connectionId === undefined) return;
    local.seats.delete(playerId);
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    entry.seat = null;
    entry.ws.close(code, reason);
  }

  // ---------------------------------------------------------------------------
  // Timers: one deadline timer and one presence reaper per room with local sockets
  // ---------------------------------------------------------------------------

  private startTimers(local: LocalRoom): void {
    if (this.closed || local.reaper) return;
    local.reaper = setInterval(() => {
      this.reap(local).catch((err: unknown) => this.warn(`room ${local.code} reaper`, err));
    }, this.reaperIntervalMs);
    this.arm(local);
  }

  private stopTimers(local: LocalRoom): void {
    if (local.deadline) clearTimeout(local.deadline);
    if (local.reaper) clearInterval(local.reaper);
    if (local.resync) clearTimeout(local.resync);
    local.deadline = null;
    local.reaper = null;
    local.resync = null;
  }

  private arm(local: LocalRoom): void {
    if (local.deadline) clearTimeout(local.deadline);
    local.deadline = null;
    if (this.closed || !local.data || local.seats.size === 0) return;
    const at = nextDeadline(local.data);
    if (at === null) return;
    local.deadline = setTimeout(() => {
      local.deadline = null;
      this.tick(local).catch((err: unknown) => this.warn(`room ${local.code} tick`, err));
    }, Math.min(MAX_TIMER_MS, Math.max(0, at - this.clock.now())));
  }

  private async tick(local: LocalRoom): Promise<void> {
    if (this.locals.get(local.code) !== local) return;
    const ticked = await this.rooms.dispatch(local.code, { type: 'tick' });
    if (!ticked.ok) return;
    this.remember(local, ticked.data);
    // A tick that changed nothing publishes nothing, so re-arm here.
    this.arm(local);
  }

  /** Players whose presence key expired lost their instance without a close: disconnect them. */
  private async reap(local: LocalRoom): Promise<void> {
    const data = local.data;
    if (!data || this.locals.get(local.code) !== local) return;
    const connected = data.players.filter((p) => p.connected && p.connectionId !== null);
    const alive = await this.rooms.presence(local.code, connected.map((p) => p.id));
    for (const [i, player] of connected.entries()) {
      if (alive[i] !== null) continue;
      const here = local.seats.get(player.id);
      if (here !== undefined && this.sockets.get(here)?.ws.readyState === SOCKET_OPEN) {
        // Our own live socket: the heartbeats must have been lost, not the player.
        await this.rooms.touch(local.code, player.id, here);
        continue;
      }
      await this.rooms.dispatch(local.code, { type: 'connectionClosed', playerId: player.id, connectionId: player.connectionId ?? undefined });
    }
  }

  private connection(url: string): Redis {
    const options: RedisOptions = { lazyConnect: true, maxRetriesPerRequest: 3 };
    // ioredis switches TLS on for rediss:// itself; being explicit guards against a provider URL it does not parse.
    if (url.startsWith('rediss://')) options.tls = {};
    const redis = new Redis(url, options);
    redis.on('error', (err: Error) => this.log(`redis: ${err.message}`));
    return redis;
  }

  private warn(what: string, err: unknown): void {
    this.log(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
