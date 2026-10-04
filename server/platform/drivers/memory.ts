import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import type { RoomPreview } from '../../../shared/platform/protocol.js';
import { normalizeRoomCode } from '../../../shared/platform/roomCode.js';
import { previewOf } from '../engine/view.js';
import { RoomManager, type RoomManagerDeps } from './roomManager.js';
import { SocketHub } from './socketHub.js';
import type { DriverHealth, GameDriver, LookupResult, RoomInbound, Seat, SeatResult, SocketLike } from './types.js';

export type MemoryDriverOptions = Omit<RoomManagerDeps, 'transport'>;

/**
 * Everything in one process: rooms live in a RoomManager, sockets in a SocketHub. This is the
 * standalone server (`npm start`, the Dockerfile, local development) and the fallback when no
 * Redis is configured. Every method answers synchronously.
 */
export class MemoryDriver implements GameDriver {
  readonly name = 'memory';
  readonly hub = new SocketHub();
  readonly rooms: RoomManager;

  constructor(options: MemoryDriverOptions = {}) {
    this.rooms = new RoomManager({ transport: this.hub, ...options });
  }

  register(connectionId: string, ws: SocketLike): void {
    this.hub.register(connectionId, ws);
  }

  unregister(connectionId: string): void {
    this.hub.unregister(connectionId);
  }

  lookup(code: string): LookupResult {
    const found = this.rooms.lookup(code);
    return found.ok ? { ok: true, code: found.room.code } : found;
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

  preview(code: string): RoomPreview {
    const found = this.rooms.lookup(code);
    if (!found.ok) return { exists: false, code: normalizeRoomCode(code), reason: found.code };
    return previewOf(found.room.state);
  }

  health(): DriverHealth {
    return { driver: this.name, ...this.rooms.stats() };
  }

  async shutdown(): Promise<void> {
    this.rooms.destroy();
  }
}
