import type { Avatar } from '../shared/avatar';
import { EMPTY_ROOM_TTL_MS } from '../shared/constants';
import type { ErrorCode } from '../shared/protocol';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, roomCodeHint } from '../shared/roomCode';
import type { Player } from './player';
import { Room } from './room';
import { systemClock, type Clock, type Rng, type Transport } from './transport';

export interface RoomManagerDeps {
  transport: Transport;
  clock?: Clock;
  rng?: Rng;
  /** How long an empty room survives before deletion (defaults to EMPTY_ROOM_TTL_MS). */
  emptyRoomTtlMs?: number;
}

export type LookupResult =
  | { ok: true; room: Room }
  | { ok: false; code: Extract<ErrorCode, 'INVALID_CODE' | 'ROOM_NOT_FOUND'>; message: string };

export interface RoomStats {
  rooms: number;
  players: number;
}

const MAX_CODE_ATTEMPTS = 1000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly deleteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly ttlMs: number;

  constructor(deps: RoomManagerDeps) {
    this.transport = deps.transport;
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.ttlMs = deps.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS;
  }

  /** Creates a room with a fresh code and seats its host. */
  createRoom(name: string, avatar: Avatar, connectionId: string): { room: Room; player: Player } {
    const code = this.uniqueCode();
    const room = new Room(code, {
      transport: this.transport,
      clock: this.clock,
      rng: this.rng,
      onEmpty: (r) => this.scheduleDeletion(r),
      onOccupied: (r) => this.cancelDeletion(r),
    });
    this.rooms.set(code, room);
    const joined = room.join(name, avatar, connectionId);
    if (!joined.ok) {
      // Cannot happen for a brand-new room, but never leave an orphan behind.
      this.rooms.delete(code);
      room.destroy();
      throw new Error(`failed to seat host in new room: ${joined.code}`);
    }
    return { room, player: joined.player };
  }

  /** Resolves user input (any case, with noise) to a room. */
  lookup(input: string): LookupResult {
    const code = normalizeRoomCode(input);
    if (!isValidRoomCode(code)) return { ok: false, code: 'INVALID_CODE', message: roomCodeHint() };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: 'ROOM_NOT_FOUND', message: `No room with code ${code} exists.` };
    return { ok: true, room };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  stats(): RoomStats {
    let players = 0;
    for (const room of this.rooms.values()) players += room.playerCount;
    return { rooms: this.rooms.size, players };
  }

  listCodes(): string[] {
    return [...this.rooms.keys()];
  }

  /** Tears down every room and timer (server shutdown). */
  destroy(): void {
    for (const timer of this.deleteTimers.values()) clearTimeout(timer);
    this.deleteTimers.clear();
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }

  private uniqueCode(): string {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const code = generateRoomCode(this.rng);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('unable to allocate a unique room code');
  }

  private scheduleDeletion(room: Room): void {
    this.cancelDeletion(room);
    this.deleteTimers.set(
      room.code,
      setTimeout(() => {
        this.deleteTimers.delete(room.code);
        if (this.rooms.get(room.code) !== room || !room.isEmpty) return;
        this.rooms.delete(room.code);
        room.destroy();
      }, this.ttlMs),
    );
  }

  private cancelDeletion(room: Room): void {
    const timer = this.deleteTimers.get(room.code);
    if (timer) clearTimeout(timer);
    this.deleteTimers.delete(room.code);
  }
}
