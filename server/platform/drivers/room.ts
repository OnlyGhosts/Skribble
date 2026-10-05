import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import { isWireMessage, type ErrorCode, type RoomState } from '../../../shared/platform/protocol.js';
import type { Action, ActionResult } from '../engine/actions.js';
import { resolveRecipients, type Effect } from '../engine/effects.js';
import { moduleFor } from '../engine/module.js';
import { connectedIds, findPlayer, inProgress, isFull, isJoinable, platformPlayers } from '../engine/players.js';
import { applyAction } from '../engine/reduce.js';
import { createRoomData, type PlatformPlayerData, type PlatformRoomData } from '../engine/state.js';
import { nextDeadline } from '../engine/time.js';
import { viewFor } from '../engine/view.js';
import { SIDE_RESYNC_DEBOUNCE_MS, type AnyGameSideStore, type Recipients, type SideRoom } from '../game.js';
import type { GameStorage } from '../storage.js';
import { productionCtx, systemClock, type Clock, type Rng, type Transport } from '../transport.js';
import { after, type OutboundMessage, type RoomInbound } from './types.js';

export type JoinResult = { ok: true; playerId: string } | { ok: false; code: ErrorCode; message: string };

export interface RoomDeps {
  transport: Transport;
  storage: GameStorage;
  clock?: Clock;
  rng?: Rng;
  /** Fired when the last seat (connected or in grace) is released. */
  onEmpty?: (room: Room) => void;
  /** Fired when the room has been empty for its TTL and deleted itself. */
  onDestroy?: (room: Room) => void;
  log?: (msg: string) => void;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * One room in a single process: a thin driver over the pure engine. It owns the room data, runs
 * every action through `applyAction`, executes the effects through `Transport`, routes side
 * messages to the game's side store and keeps one timer armed at `nextDeadline(data)`.
 */
export class Room {
  readonly code: string;
  readonly gameId: GameId;
  readonly createdAt: number;

  private data: PlatformRoomData;
  private readonly sideStore: AnyGameSideStore | null;
  private readonly storage: GameStorage;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly onEmpty: ((room: Room) => void) | undefined;
  private readonly onDestroy: ((room: Room) => void) | undefined;
  private readonly log: (msg: string) => void;
  private timer: Timer | null = null;
  /** Pending side-store resync for a player whose input the caps truncated. */
  private resyncTimer: Timer | null = null;
  private destroyed = false;

  constructor(code: string, gameId: GameId, deps: RoomDeps) {
    this.code = code;
    this.gameId = gameId;
    this.transport = deps.transport;
    this.storage = deps.storage;
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.onEmpty = deps.onEmpty;
    this.onDestroy = deps.onDestroy;
    this.log = deps.log ?? (() => undefined);
    this.createdAt = this.clock.now();
    this.data = createRoomData(code, gameId, this.createdAt);
    this.sideStore = moduleFor(gameId).createSideStore?.(deps.storage) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** The engine state; treat as read-only. */
  get state(): PlatformRoomData {
    return this.data;
  }

  get settings(): PlatformRoomData['settings'] {
    return this.data.settings;
  }

  get hostPlayerId(): string {
    return this.data.hostId;
  }

  get phase(): PlatformRoomData['phase'] {
    return this.data.phase;
  }

  /** Seats taken, counting disconnected players still within their grace period. */
  get playerCount(): number {
    return this.data.players.length;
  }

  get connectedCount(): number {
    return connectedIds(this.data).length;
  }

  get isEmpty(): boolean {
    return this.data.players.length === 0;
  }

  get isFull(): boolean {
    return isFull(this.data);
  }

  get inProgress(): boolean {
    return inProgress(this.data);
  }

  get isJoinable(): boolean {
    return isJoinable(this.data);
  }

  getPlayer(id: string): PlatformPlayerData | undefined {
    return findPlayer(this.data, id);
  }

  /** Per-recipient snapshot. `recipient` may be null for a role-less view (used by HTTP previews/tests). */
  getState(recipient: string | null): RoomState {
    return viewFor(this.data, recipient, this.clock.now());
  }

  // ---------------------------------------------------------------------------
  // Seats: create / join / rejoin / leave / disconnect
  // ---------------------------------------------------------------------------

  /** Seats the first player of a brand-new room. */
  create(name: string, avatar: Avatar, connectionId: string): JoinResult {
    return this.seat({ type: 'create', gameId: this.gameId, name, avatar, connectionId }, connectionId);
  }

  join(name: string, avatar: Avatar, connectionId: string): JoinResult {
    return this.seat({ type: 'join', name, avatar, connectionId }, connectionId);
  }

  rejoin(token: string, connectionId: string): JoinResult {
    if (this.destroyed) return { ok: false, code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' };
    return this.seat({ type: 'rejoin', token, connectionId }, connectionId);
  }

  /** Explicit "leave room": the seat is released immediately. */
  leave(playerId: string): void {
    if (this.destroyed) return;
    this.dispatch({ type: 'leave', playerId });
  }

  /**
   * The player's socket went away. The seat is kept for RECONNECT_GRACE_MS.
   * `connectionId` lets stale sockets (already replaced by a rejoin) be ignored.
   */
  handleDisconnect(playerId: string, connectionId?: string): void {
    if (this.destroyed) return;
    this.dispatch({ type: 'connectionClosed', playerId, connectionId });
  }

  handleMessage(playerId: string, inbound: RoomInbound): void {
    if (this.destroyed || !findPlayer(this.data, playerId)) return;
    if (inbound.kind === 'platform') return void this.dispatch({ type: 'platformMessage', playerId, msg: inbound.msg });
    if (this.sideStore && moduleFor(this.gameId).sideMessages?.has(inbound.msg.t)) return this.sideMessage(playerId, inbound.msg);
    this.dispatch({ type: 'gameMessage', playerId, msg: inbound.msg });
  }

  /** Stops every timer; the room must not be used afterwards. */
  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.storage.drop(this.code);
  }

  // ---------------------------------------------------------------------------
  // Engine driver
  // ---------------------------------------------------------------------------

  private seat(action: Extract<Action, { type: 'create' | 'join' | 'rejoin' }>, connectionId: string): JoinResult {
    if (this.destroyed) return { ok: false, code: 'ROOM_NOT_FOUND', message: 'This room no longer exists.' };
    const result = this.dispatch(action, (playerId) => this.transport.attach(playerId, connectionId));
    if (!result.ok) return result;
    if (result.playerId === null) return { ok: false, code: 'INTERNAL', message: 'Could not seat the player.' };
    return { ok: true, playerId: result.playerId };
  }

  /** Applies one action, then runs its effects, re-arms the timer and reports emptiness. */
  private dispatch(action: Action, beforeEffects?: (playerId: string) => void): ActionResult {
    const before = this.data;
    const { data, effects, result } = applyAction(before, action, productionCtx(this.clock, this.rng));
    this.data = data;
    if (result.ok && result.playerId !== null) beforeEffects?.(result.playerId);
    const destroy = this.execute(effects);
    if (before.players.length > 0 && data.players.length === 0) this.onEmpty?.(this);
    if (destroy) {
      this.destroy();
      this.onDestroy?.(this);
    } else {
      this.arm();
    }
    return result;
  }

  /** Runs the effects in order; returns true when the room asked to be deleted. */
  private execute(effects: Effect[]): boolean {
    let destroy = false;
    for (const effect of effects) {
      switch (effect.type) {
        case 'send':
          for (const id of resolveRecipients(this.data, effect.to)) this.transport.send(id, effect.msg);
          break;
        case 'welcome': {
          const playerId = effect.playerId;
          // Side stores answer synchronously over the memory storage, so welcomes stay in order.
          after(this.sideStore ? this.sideStore.welcomeExtra(this.sideRoom(), playerId) : null, (side) => {
            this.transport.send(playerId, side ? { ...effect.msg, extra: side.extra } : effect.msg);
          });
          break;
        }
        case 'close':
          this.transport.close(effect.playerId, effect.code, effect.reason);
          break;
        case 'side':
          if (this.sideStore) after(this.storage.reset(this.code, null, effect.stamp), () => undefined);
          break;
        case 'destroy':
          destroy = true;
          break;
      }
    }
    return destroy;
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.destroyed) return;
    const at = nextDeadline(this.data);
    if (at === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.dispatch({ type: 'tick' });
      } catch (err) {
        this.log(`room ${this.code} tick: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, Math.max(0, at - this.clock.now()));
  }

  // ---------------------------------------------------------------------------
  // Side store (Skribble's canvas): never touches the engine
  // ---------------------------------------------------------------------------

  private sideRoom(): SideRoom<unknown> {
    return { code: this.code, phase: this.data.phase, game: this.data.game, players: platformPlayers(this.data) };
  }

  private sideMessage(playerId: string, raw: { t: string }): void {
    const store = this.sideStore;
    if (!store) return;
    const parsed = moduleFor(this.gameId).clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.transport.send(playerId, { t: 'error', code: 'INVALID_MESSAGE', message: parsed.error.issues[0]?.message ?? 'Invalid message' });
      return;
    }
    after(store.handleMessage(this.sideRoom(), playerId, parsed.data, this.clock.now()), (outcome) => {
      if (!outcome.ok) {
        if (outcome.message !== null) this.transport.send(playerId, { t: 'error', code: 'NOT_ALLOWED', message: outcome.message });
        return;
      }
      for (const send of outcome.sends) this.broadcast(send.to, asWire(send.msg));
      if (outcome.resync !== undefined) this.scheduleResync(outcome.resync);
    });
  }

  private scheduleResync(playerId: string): void {
    if (this.resyncTimer) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      const store = this.sideStore;
      if (!store || this.destroyed) return;
      after(store.resync(this.sideRoom(), playerId, this.clock.now()), (out) => {
        if (out) this.transport.send(playerId, asWire(out.msg));
      });
    }, SIDE_RESYNC_DEBOUNCE_MS);
  }

  private broadcast(to: Recipients, msg: OutboundMessage): void {
    for (const id of resolveRecipients(this.data, to)) this.transport.send(id, msg);
  }
}

function asWire(msg: unknown): OutboundMessage {
  if (isWireMessage(msg)) return msg;
  throw new Error('side store message must be an object with a string `t`');
}
