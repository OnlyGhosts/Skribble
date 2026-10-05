import { Redis, type RedisOptions } from 'ioredis';
import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import { CLOSE_REPLACED, isWireMessage, type RoomPreview, type WireMessage } from '../../../shared/platform/protocol.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, roomCodeHint } from '../../../shared/platform/roomCode.js';
import type { Action } from '../engine/actions.js';
import { resolveRecipients } from '../engine/effects.js';
import { moduleFor } from '../engine/module.js';
import { connectedIds, findPlayer, platformPlayers } from '../engine/players.js';
import { applyAction } from '../engine/reduce.js';
import type { PlatformRoomData } from '../engine/state.js';
import { nextDeadline } from '../engine/time.js';
import { previewOf, viewFor } from '../engine/view.js';
import { SIDE_RESYNC_DEBOUNCE_MS, type AnyGameSideStore, type SideRoom } from '../game.js';
import { productionCtx, systemClock, type Clock, type Rng } from '../transport.js';
import { PRESENCE_TTL_MS, parseChannelMessage, roomChannel, type RoomChannelMessage } from './redisKeys.js';
import { RedisRooms, type Dispatched } from './redisRooms.js';
import { RedisStorage } from './redisStorage.js';
import { AsyncLock } from './serial.js';
import { SOCKET_OPEN, sendTo, type DriverHealth, type GameDriver, type LookupResult, type OutboundMessage, type RoomInbound, type Seat, type SeatResult, type SocketLike } from './types.js';

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
/** A deadline tick whose dispatch failed (Redis blip, too many concurrent writers) is retried after this long. */
export const TICK_RETRY_MS = 500;
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
  data: PlatformRoomData | null;
  /** playerId -> connectionId of the seats whose sockets live in this process. */
  seats: Map<string, string>;
  /**
   * playerId -> side-store sequence number the player's welcome snapshot included; side messages
   * up to it are already applied on their side. Infinity until the welcome has been sent.
   */
  seen: Map<string, number>;
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
  private readonly sub: Redis;
  private readonly rooms: RedisRooms;
  private readonly storage: RedisStorage;
  private readonly sideStores = new Map<GameId, AnyGameSideStore | null>();
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
    this.sub = this.connection(options.url);
    this.sub.on('message', (channel: string, raw: string) => this.onChannelMessage(channel, raw));
    this.rooms = new RedisRooms(this.redis, new AsyncLock(), () => productionCtx(this.clock, this.rng), options.presenceTtlMs ?? PRESENCE_TTL_MS);
    this.storage = new RedisStorage(this.redis);
  }

  // ---------------------------------------------------------------------------
  // Sockets
  // ---------------------------------------------------------------------------

  register(connectionId: string, ws: SocketLike): void {
    this.sockets.set(connectionId, { ws, seat: null });
  }

  unregister(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    this.sockets.delete(connectionId);
    // The connection layer reports the disconnect first; a seat still bound here was taken while the socket was closing.
    if (entry.seat) this.disconnected(entry.seat, connectionId).catch((err: unknown) => this.warn(`connection ${connectionId} unregister`, err));
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

  async create(gameId: GameId, name: string, avatar: Avatar, connectionId: string): Promise<SeatResult> {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const code = generateRoomCode(this.rng);
      const result = await this.seat(code, { type: 'create', gameId, name, avatar, connectionId }, connectionId);
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

  async handle(seat: Seat, inbound: RoomInbound): Promise<void> {
    if (inbound.kind === 'game') {
      const local = this.locals.get(seat.code);
      const data = local?.data ?? (await this.rooms.read(seat.code));
      if (!data) return this.roomGone(seat.code);
      const store = this.sideStore(data.gameId);
      if (store && moduleFor(data.gameId).sideMessages?.has(inbound.msg.t)) return this.sideMessage(seat, data, store, inbound.msg);
    }
    const action: Action = inbound.kind === 'platform' ? { type: 'platformMessage', playerId: seat.playerId, msg: inbound.msg } : { type: 'gameMessage', playerId: seat.playerId, msg: inbound.msg };
    const dispatched = await this.rooms.dispatch(seat.code, action);
    if (!dispatched.ok) this.roomGone(seat.code);
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
    return previewOf(applyAction(stored, { type: 'tick' }, productionCtx(this.clock, this.rng)).data);
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
        createIfMissing: creating ? action.gameId : undefined,
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
        seen: new Map(),
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

  private remember(local: LocalRoom, data: PlatformRoomData): void {
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
    local.seen.set(playerId, Infinity);
    if (entry) entry.seat = { code: local.code, playerId };
    this.startTimers(local);
  }

  private unbind(seat: Seat, connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (entry?.seat && entry.seat.code === seat.code && entry.seat.playerId === seat.playerId) entry.seat = null;
    const local = this.locals.get(seat.code);
    if (local && local.seats.get(seat.playerId) === connectionId) {
      local.seats.delete(seat.playerId);
      local.seen.delete(seat.playerId);
      this.release(local);
    }
  }

  /** The room's key vanished (expired, flushed) under live seats: the clients leave it as after a failed rejoin. */
  private roomGone(code: string): void {
    const local = this.locals.get(code);
    if (!local) return;
    for (const [playerId, connectionId] of [...local.seats]) {
      this.sendLocal(local, playerId, { t: 'error', code: 'REJOIN_FAILED', message: 'This room no longer exists.' });
      this.unbind({ code, playerId }, connectionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Side stores (Skribble's canvas): changes never touch the engine
  // ---------------------------------------------------------------------------

  private sideStore(gameId: GameId): AnyGameSideStore | null {
    let store = this.sideStores.get(gameId);
    if (store === undefined) {
      store = moduleFor(gameId).createSideStore?.(this.storage) ?? null;
      this.sideStores.set(gameId, store);
    }
    return store;
  }

  private sideRoom(data: PlatformRoomData): SideRoom<unknown> {
    return { code: data.code, phase: data.phase, game: data.game, players: platformPlayers(data) };
  }

  private async sideMessage(seat: Seat, data: PlatformRoomData, store: AnyGameSideStore, raw: { t: string }): Promise<void> {
    const local = this.locals.get(seat.code);
    const parsed = moduleFor(data.gameId).clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      if (local) this.sendLocal(local, seat.playerId, { t: 'error', code: 'INVALID_MESSAGE', message: parsed.error.issues[0]?.message ?? 'Invalid message' });
      return;
    }
    const room = this.sideRoom(data);
    const outcome = await store.handleMessage(room, seat.playerId, parsed.data, this.clock.now());
    if (!outcome.ok) {
      if (outcome.message !== null && local) this.sendLocal(local, seat.playerId, { t: 'error', code: 'NOT_ALLOWED', message: outcome.message });
      return;
    }
    if (outcome.seq > 0 && outcome.sends.length > 0) {
      await this.rooms.publish(seat.code, { kind: 'side', seq: outcome.seq, stamp: store.stamp(room), sends: outcome.sends.map((s) => ({ to: s.to, msg: asWire(s.msg) })) });
    }
    if (outcome.resync !== undefined && local) this.scheduleResync(local, store, outcome.resync);
  }

  private scheduleResync(local: LocalRoom, store: AnyGameSideStore, playerId: string): void {
    if (local.resync) return;
    local.resync = setTimeout(() => {
      local.resync = null;
      if (!local.data) return;
      Promise.resolve(store.resync(this.sideRoom(local.data), playerId, this.clock.now()))
        .then((out) => {
          if (!out) return;
          local.seen.set(playerId, out.seq);
          this.sendLocal(local, playerId, asWire(out.msg));
        })
        .catch((err: unknown) => this.warn('side resync', err));
    }, SIDE_RESYNC_DEBOUNCE_MS);
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
    if (msg.kind === 'effects') return this.applyEffects(local, msg);
    if (!local.data) return;
    const connected = new Set(this.localConnected(local));
    for (const send of msg.sends) {
      for (const id of resolveRecipients(local.data, send.to)) {
        if (connected.has(id) && this.wantsSide(local, id, msg)) this.sendLocal(local, id, send.msg);
      }
    }
  }

  /** A side change is for the player unless their welcome snapshot already had it, or it belongs to a store the game has since reset. */
  private wantsSide(local: LocalRoom, playerId: string, msg: Extract<RoomChannelMessage, { kind: 'side' }>): boolean {
    if (local.data) {
      const store = this.sideStore(local.data.gameId);
      if (store && msg.stamp !== store.stamp(this.sideRoom(local.data))) return false;
    }
    return msg.seq > (local.seen.get(playerId) ?? Infinity);
  }

  private async applyEffects(local: LocalRoom, msg: Extract<RoomChannelMessage, { kind: 'effects' }>): Promise<void> {
    // Publishes from different instances can cross; snapshots from an older version must not win.
    const stale = local.data !== null && msg.version < local.data.version;
    if (!stale) {
      local.data = msg.data;
      // A seat that moved to another connection (a rejoin elsewhere) must not get that connection's messages.
      this.closeReplaced(local, msg.data);
    }
    let destroyed = false;
    for (const effect of msg.effects) {
      switch (effect.type) {
        case 'send':
          if (stale && effect.msg.t === 'room') break;
          for (const id of resolveRecipients(msg.data, effect.to)) this.sendLocal(local, id, effect.msg);
          break;
        case 'welcome': {
          if (!local.seats.has(effect.playerId)) break;
          const store = this.sideStore(msg.data.gameId);
          const side = store ? await store.welcomeExtra(this.sideRoom(msg.data), effect.playerId) : null;
          const room = stale && local.data ? viewFor(local.data, effect.playerId, this.clock.now()) : effect.msg.room;
          if (side) local.seen.set(effect.playerId, side.seq);
          this.sendLocal(local, effect.playerId, side ? { ...effect.msg, room, extra: side.extra } : { ...effect.msg, room });
          break;
        }
        case 'close':
          this.closeLocal(local, effect.playerId, effect.code, effect.reason);
          break;
        case 'side':
          // Applied atomically with the room write (RedisRooms); the game's own 'clear' message travels as a send.
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
      local.seen.clear();
      this.release(local);
      return;
    }
    this.reconcile(local);
    this.arm(local);
  }

  private closeReplaced(local: LocalRoom, data: PlatformRoomData): void {
    for (const [playerId, connectionId] of [...local.seats]) {
      const player = findPlayer(data, playerId);
      if (player && player.connectionId !== connectionId) this.closeLocal(local, playerId, CLOSE_REPLACED, 'Replaced by a newer connection');
    }
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

  private sendLocal(local: LocalRoom, playerId: string, msg: OutboundMessage): void {
    const connectionId = local.seats.get(playerId);
    const entry = connectionId !== undefined ? this.sockets.get(connectionId) : undefined;
    if (entry) sendTo(entry.ws, msg);
  }

  private closeLocal(local: LocalRoom, playerId: string, code: number, reason: string): void {
    const connectionId = local.seats.get(playerId);
    if (connectionId === undefined) return;
    local.seats.delete(playerId);
    local.seen.delete(playerId);
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

  /** Schedules the next tick at the room's next deadline, or after `retryInMs` when the last tick failed. */
  private arm(local: LocalRoom, retryInMs?: number): void {
    if (local.deadline) clearTimeout(local.deadline);
    local.deadline = null;
    if (this.closed || !local.data || local.seats.size === 0) return;
    const at = nextDeadline(local.data);
    if (at === null) return;
    local.deadline = setTimeout(() => {
      local.deadline = null;
      this.tick(local).catch((err: unknown) => this.warn(`room ${local.code} tick`, err));
    }, Math.min(MAX_TIMER_MS, retryInMs ?? Math.max(0, at - this.clock.now())));
  }

  private async tick(local: LocalRoom): Promise<void> {
    if (this.locals.get(local.code) !== local) return;
    let ticked: Dispatched;
    try {
      ticked = await this.rooms.dispatch(local.code, { type: 'tick' });
    } catch (err) {
      // Nobody else may hold a socket for this room, so the deadline must not be abandoned.
      this.warn(`room ${local.code} tick`, err);
      this.arm(local, TICK_RETRY_MS);
      return;
    }
    if (!ticked.ok) return this.roomGone(local.code);
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


function asWire(msg: unknown): WireMessage {
  if (isWireMessage(msg)) return msg;
  throw new Error('side store message must be an object with a string `t`');
}
