import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import type { RoomPreview } from '../../../shared/platform/protocol.js';
import { isValidRoomCode, normalizeRoomCode, roomCodeHint } from '../../../shared/platform/roomCode.js';
import { Restorer } from '../checkpoint/restorer.js';
import { previewOf } from '../engine/view.js';
import { systemClock } from '../transport.js';
import { Outbound } from './outbound.js';
import { RoomManager, type RoomManagerDeps } from './roomManager.js';
import { SocketHub } from './socketHub.js';
import { after, type DriverHealth, type GameDriver, type LookupResult, type MaybePromise, type RoomInbound, type Seat, type SeatResult, type SocketLike } from './types.js';

export type MemoryDriverOptions = Omit<RoomManagerDeps, 'transport' | 'onRoomDeleted'> & {
  /** Room snapshots to one socket at most this often (SNAPSHOT_INTERVAL_MS in production); 0, the default, sends each at once. */
  snapshotIntervalMs?: number;
  /** Override RESTORE_WINDOW_MS and RESTORE_WINDOW_MAX_MS (tests). */
  restoreWindowMs?: number;
  restoreWindowMaxMs?: number;
};

/**
 * Everything in one process: rooms live in a RoomManager, sockets in a SocketHub. This is the
 * standalone server (`npm start`, the Dockerfile, local development) and the fallback when no
 * Redis is configured. Every method answers synchronously, except a restore, which waits for the
 * other phones' checkpoints for a moment.
 */
export class MemoryDriver implements GameDriver {
  readonly name = 'memory';
  readonly hub: SocketHub;
  readonly rooms: RoomManager;
  private readonly restorer: Restorer;

  constructor({ snapshotIntervalMs = 0, restoreWindowMs, restoreWindowMaxMs, ...options }: MemoryDriverOptions = {}) {
    const clock = options.clock ?? systemClock;
    this.hub = new SocketHub(new Outbound(snapshotIntervalMs, () => clock.now()));
    this.rooms = new RoomManager({ transport: this.hub, ...options, onRoomDeleted: (code, at) => this.restorer.remember(code, at) });
    this.restorer = new Restorer({
      key: options.checkpointKey ?? null,
      clock,
      log: options.log,
      windowMs: restoreWindowMs,
      maxWindowMs: restoreWindowMaxMs,
      rebuild: (data, issuedAt) => this.rooms.restoreRoom(data, issuedAt) !== null,
      isLive: (code) => this.rooms.get(code) !== undefined,
    });
  }

  register(connectionId: string, ws: SocketLike): void {
    this.hub.register(connectionId, ws);
  }

  unregister(connectionId: string): void {
    this.hub.unregister(connectionId);
  }

  lookup(code: string): LookupResult {
    const found = this.rooms.lookup(code);
    if (found.ok) return { ok: true, code: found.room.code };
    return found.code === 'ROOM_NOT_FOUND' && this.restorer.mayRestore(normalizeRoomCode(code)) ? { ...found, restorable: true } : found;
  }

  create(gameId: GameId, name: string, avatar: Avatar, connectionId: string): SeatResult {
    const created = this.rooms.createRoom(gameId, name, avatar, connectionId);
    if (!created.ok) return created;
    return { ok: true, seat: { code: created.room.code, playerId: created.playerId } };
  }

  join(code: string, name: string, avatar: Avatar, connectionId: string): SeatResult {
    const found = this.rooms.lookup(code);
    if (!found.ok) return found;
    const joined = found.room.join(name, avatar, connectionId);
    if (!joined.ok) return joined;
    return { ok: true, seat: { code: found.room.code, playerId: joined.playerId } };
  }

  rejoin(code: string, token: string, connectionId: string): SeatResult {
    const found = this.rooms.lookup(code);
    if (!found.ok) return { ok: false, code: 'REJOIN_FAILED', message: found.message };
    const joined = found.room.rejoin(token, connectionId);
    if (!joined.ok) return joined;
    return { ok: true, seat: { code: found.room.code, playerId: joined.playerId } };
  }

  restore(input: string, token: string, checkpoint: string, connectionId: string): MaybePromise<SeatResult> {
    const code = normalizeRoomCode(input);
    if (!isValidRoomCode(code)) return { ok: false, code: 'REJOIN_FAILED', message: roomCodeHint() };
    if (this.rooms.get(code)) return this.rejoin(code, token, connectionId);
    return after(this.restorer.offer(code, token, checkpoint), (offered): SeatResult => {
      if (!offered.ok) return { ok: false, code: 'REJOIN_FAILED', message: offered.message, ...(offered.retry ? { roomGone: true as const } : {}) };
      return this.rejoin(code, token, connectionId);
    });
  }

  checkpointAll(): void {
    this.rooms.flushCheckpoints();
  }

  leave(seat: Seat): void {
    const room = this.rooms.get(seat.code);
    if (room?.getPlayer(seat.playerId)) room.leave(seat.playerId);
  }

  disconnected(seat: Seat, connectionId: string): void {
    const room = this.rooms.get(seat.code);
    if (room?.getPlayer(seat.playerId)) room.handleDisconnect(seat.playerId, connectionId);
  }

  handle(seat: Seat, msg: RoomInbound): void {
    const room = this.rooms.get(seat.code);
    if (room?.getPlayer(seat.playerId)) room.handleMessage(seat.playerId, msg);
  }

  holds(seat: Seat, connectionId: string): boolean {
    return this.rooms.get(seat.code)?.getPlayer(seat.playerId)?.connectionId === connectionId;
  }

  heartbeat(): void {
    // Liveness is the socket itself in a single process.
  }

  idle(seat: Seat, connectionId: string, idle: boolean): void {
    this.rooms.get(seat.code)?.handleActivity(seat.playerId, connectionId, idle);
  }

  preview(code: string): RoomPreview {
    const found = this.rooms.lookup(code);
    if (!found.ok) return { exists: false, code: normalizeRoomCode(code), reason: found.code };
    return previewOf(found.room.state);
  }

  health(): DriverHealth {
    return { driver: this.name, ...this.rooms.stats() };
  }

  async shutdown(): Promise<void> {
    this.restorer.stop();
    this.rooms.destroy();
  }
}
