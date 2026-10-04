import type { Avatar } from '../shared/avatar.js';
import type { CanvasAction, ClientMessage, DrawOp, ErrorCode, RoomState, ServerMessage } from '../shared/protocol.js';
import { CANVAS_RESYNC_DEBOUNCE_MS, MemoryCanvasStore, type CanvasStore } from './canvasStore.js';
import type { Action, ActionResult } from './engine/actions.js';
import { resolveRecipients, type Effect } from './engine/effects.js';
import { NOT_DRAWER_MESSAGE, canDraw, connectedIds, drawerCheck, findPlayer, inProgress, isFull, isJoinable, sortedPlayers } from './engine/players.js';
import { applyAction } from './engine/reduce.js';
import { createRoomData, type PhaseData, type RoomData } from './engine/state.js';
import { nextDeadline } from './engine/time.js';
import { viewFor } from './engine/view.js';
import { Player } from './player.js';
import { productionCtx, systemClock, type Clock, type Rng, type Transport } from './transport.js';

/** Messages the connection layer hands to the room (session-level ones are handled before). */
export type RoomMessage = Exclude<ClientMessage, { t: 'create' | 'join' | 'rejoin' | 'leave' | 'ping' }>;

export type JoinResult = { ok: true; player: Player } | { ok: false; code: ErrorCode; message: string };

export interface RoomDeps {
  transport: Transport;
  clock?: Clock;
  rng?: Rng;
  /** Defaults to an in-memory store. */
  canvas?: CanvasStore;
  /** Fired when the last seat (connected or in grace) is released. */
  onEmpty?: (room: Room) => void;
  /** Fired when the room has been empty for its TTL and deleted itself. */
  onDestroy?: (room: Room) => void;
}

type Timer = ReturnType<typeof setTimeout>;


/**
 * One game room in a single process: a thin driver over the pure engine. It owns the RoomData
 * and the canvas store, runs every action through `applyAction`, executes the effects through
 * `Transport`, and keeps one timer armed at `nextDeadline(data)` so vitest fake timers drive it.
 */
export class Room {
  readonly code: string;
  readonly createdAt: number;

  private data: RoomData;
  private readonly canvas: CanvasStore;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly onEmpty: ((room: Room) => void) | undefined;
  private readonly onDestroy: ((room: Room) => void) | undefined;
  private readonly handles = new Map<string, Player>();
  private timer: Timer | null = null;
  /** Pending canvas resync for a drawer whose ops the caps truncated. */
  private resyncTimer: Timer | null = null;
  private destroyed = false;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.transport = deps.transport;
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.canvas = deps.canvas ?? new MemoryCanvasStore();
    this.onEmpty = deps.onEmpty;
    this.onDestroy = deps.onDestroy;
    this.createdAt = this.clock.now();
    this.data = createRoomData(code, this.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** The engine state; treat as read-only. */
  get state(): RoomData {
    return this.data;
  }

  get settings(): RoomData['settings'] {
    return this.data.settings;
  }

  get hostPlayerId(): string {
    return this.data.hostId;
  }

  get phaseKind(): PhaseData['kind'] {
    return this.data.phase.kind;
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

  get canvasHistory(): readonly CanvasAction[] {
    return this.canvas.all();
  }

  getPlayer(id: string): Player | undefined {
    return findPlayer(this.data, id) ? this.handle(id) : undefined;
  }

  listPlayers(): Player[] {
    return sortedPlayers(this.data).map((p) => this.handle(p.id));
  }

  /** Per-recipient snapshot. `recipient` may be null for a role-less view (used by HTTP previews/tests). */
  getState(recipient: Player | null): RoomState {
    return viewFor(this.data, recipient?.id ?? null, this.clock.now());
  }

  // ---------------------------------------------------------------------------
  // Seats: create / join / rejoin / leave / disconnect
  // ---------------------------------------------------------------------------

  /** Seats the first player of a brand-new room. */
  create(name: string, avatar: Avatar, connectionId: string): JoinResult {
    return this.seat({ type: 'create', name, avatar, connectionId }, connectionId);
  }

  join(name: string, avatar: Avatar, connectionId: string): JoinResult {
    return this.seat({ type: 'join', name, avatar, connectionId }, connectionId);
  }

  rejoin(token: string, connectionId: string): JoinResult {
    if (this.destroyed) return { ok: false, code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' };
    return this.seat({ type: 'rejoin', token, connectionId }, connectionId);
  }

  /** Explicit "leave room": the seat is released immediately. */
  leave(player: Player): void {
    if (this.destroyed) return;
    this.dispatch({ type: 'leave', playerId: player.id });
  }

  /**
   * The player's socket went away. The seat is kept for RECONNECT_GRACE_MS.
   * `connectionId` lets stale sockets (already replaced by a rejoin) be ignored.
   */
  handleDisconnect(player: Player, connectionId?: string): void {
    if (this.destroyed) return;
    this.dispatch({ type: 'connectionClosed', playerId: player.id, connectionId });
  }

  handleMessage(player: Player, msg: RoomMessage): void {
    if (this.destroyed || !findPlayer(this.data, player.id)) return;
    switch (msg.t) {
      case 'draw':
        return this.draw(player.id, msg.ops);
      case 'undo':
        return this.undo(player.id);
      case 'clear':
        return this.clear(player.id);
      default:
        this.dispatch({ type: 'clientMessage', playerId: player.id, msg });
    }
  }

  /** Stops every timer; the room must not be used afterwards. */
  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Engine driver
  // ---------------------------------------------------------------------------

  private seat(action: Extract<Action, { type: 'create' | 'join' | 'rejoin' }>, connectionId: string): JoinResult {
    if (this.destroyed) return { ok: false, code: 'ROOM_NOT_FOUND', message: 'This room no longer exists.' };
    const result = this.dispatch(action, (playerId) => this.transport.attach(playerId, connectionId));
    if (!result.ok) return result;
    if (result.playerId === null) return { ok: false, code: 'INTERNAL', message: 'Could not seat the player.' };
    return { ok: true, player: this.handle(result.playerId) };
  }

  /** Applies one action, then runs its effects, re-arms the timer and reports emptiness. */
  private dispatch(action: Action, beforeEffects?: (playerId: string) => void): ActionResult {
    const before = this.data;
    const { data, effects, result } = applyAction(before, action, productionCtx(this.clock, this.rng));
    this.data = data;
    if (result.ok && result.playerId !== null) beforeEffects?.(result.playerId);
    for (const id of [...this.handles.keys()]) if (!findPlayer(data, id)) this.handles.delete(id);
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
        case 'welcome':
          this.transport.send(effect.playerId, { ...effect.msg, canvas: this.canvas.all() });
          break;
        case 'close':
          this.transport.close(effect.playerId, effect.code, effect.reason);
          break;
        case 'canvas':
          this.canvas.clear();
          this.broadcast({ t: 'clear' });
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
      this.dispatch({ type: 'tick' });
    }, Math.max(0, at - this.clock.now()));
  }

  private handle(id: string): Player {
    let player = this.handles.get(id);
    if (!player) {
      const data = findPlayer(this.data, id);
      if (!data) throw new Error(`no player ${id} in room ${this.code}`);
      player = new Player((pid) => findPlayer(this.data, pid), data);
      this.handles.set(id, player);
    }
    return player;
  }

  // ---------------------------------------------------------------------------
  // Canvas (ops never touch the engine; it only authorises the drawer)
  // ---------------------------------------------------------------------------

  private requireDrawer(playerId: string): boolean {
    const check = drawerCheck(this.data, playerId, this.clock.now());
    if (check === 'forbidden') this.transport.send(playerId, { t: 'error', code: 'NOT_ALLOWED', message: NOT_DRAWER_MESSAGE });
    return check === 'ok';
  }

  private draw(playerId: string, ops: DrawOp[]): void {
    if (!this.requireDrawer(playerId)) return;
    const { accepted, truncated } = this.canvas.append(ops);
    if (accepted.length > 0) this.broadcast({ t: 'draw', ops: accepted }, playerId);
    // The drawer applied the full ops locally; bring their canvas back to what everyone else has.
    if (truncated) this.scheduleResync(playerId);
  }

  private undo(playerId: string): void {
    if (!this.requireDrawer(playerId)) return;
    if (this.canvas.undo()) this.broadcast({ t: 'undo' });
  }

  private clear(playerId: string): void {
    if (!this.requireDrawer(playerId)) return;
    this.canvas.clear();
    this.broadcast({ t: 'clear' });
  }

  private scheduleResync(drawerId: string): void {
    if (this.resyncTimer) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      if (!canDraw(this.data, drawerId, this.clock.now())) return;
      this.transport.send(drawerId, { t: 'canvas', actions: this.canvas.all() });
    }, CANVAS_RESYNC_DEBOUNCE_MS);
  }

  private broadcast(msg: ServerMessage, except?: string): void {
    for (const id of connectedIds(this.data)) if (id !== except) this.transport.send(id, msg);
  }
}
