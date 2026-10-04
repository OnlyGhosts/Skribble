import type { Avatar } from '../../shared/avatar';
import type { RoomPreview } from '../../shared/protocol';
import { normalizeRoomCode } from '../../shared/roomCode';
import type { Room, RoomMessage } from '../room';
import { RoomManager, type RoomManagerDeps } from '../roomManager';
import { SocketHub } from './socketHub';
import type { DriverHealth, GameDriver, LookupResult, Seat, SeatResult, SocketLike } from './types';

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

  create(name: string, avatar: Avatar, connectionId: string): SeatResult {
    const created = this.rooms.createRoom(name, avatar, connectionId);
    if (!created.ok) return created;
    return { ok: true, seat: { code: created.room.code, playerId: created.player.id } };
  }

  join(code: string, name: string, avatar: Avatar, connectionId: string): SeatResult {
    const found = this.rooms.lookup(code);
    if (!found.ok) return found;
    const joined = found.room.join(name, avatar, connectionId);
    if (!joined.ok) return joined;
    return { ok: true, seat: { code: found.room.code, playerId: joined.player.id } };
  }

  rejoin(code: string, token: string, connectionId: string): SeatResult {
    const found = this.rooms.lookup(code);
    if (!found.ok) return { ok: false, code: 'REJOIN_FAILED', message: found.message };
    const joined = found.room.rejoin(token, connectionId);
    if (!joined.ok) return joined;
    return { ok: true, seat: { code: found.room.code, playerId: joined.player.id } };
  }

  leave(seat: Seat): void {
    const room = this.rooms.get(seat.code);
    const player = room?.getPlayer(seat.playerId);
    if (room && player) room.leave(player);
  }

  disconnected(seat: Seat, connectionId: string): void {
    const room = this.rooms.get(seat.code);
    const player = room?.getPlayer(seat.playerId);
    if (room && player) room.handleDisconnect(player, connectionId);
  }

  handle(seat: Seat, msg: RoomMessage): void {
    const room = this.rooms.get(seat.code);
    const player = room?.getPlayer(seat.playerId);
    if (room && player) room.handleMessage(player, msg);
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
    return previewOf(found.room);
  }

  health(): DriverHealth {
    return { driver: this.name, ...this.rooms.stats() };
  }

  async shutdown(): Promise<void> {
    this.rooms.destroy();
  }
}

function previewOf(room: Room): RoomPreview {
  return {
    exists: true,
    code: room.code,
    players: room.playerCount,
    maxPlayers: room.settings.maxPlayers,
    inProgress: room.inProgress,
    joinable: room.isJoinable,
  };
}
