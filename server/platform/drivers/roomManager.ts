import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import type { ErrorCode } from '../../../shared/platform/protocol.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, roomCodeHint } from '../../../shared/platform/roomCode.js';
import { MemoryStorage, type GameStorage } from '../storage.js';
import { systemClock, type Clock, type Rng, type Transport } from '../transport.js';
import { Room } from './room.js';

export interface RoomManagerDeps {
  transport: Transport;
  /** Side-store storage shared by every room; defaults to an in-memory one. */
  storage?: GameStorage;
  clock?: Clock;
  rng?: Rng;
  /** Rooms alive at once, empty ones awaiting deletion included (defaults to MAX_ROOMS). */
  maxRooms?: number;
  log?: (msg: string) => void;
}

export type CreateResult =
  | { ok: true; room: Room; playerId: string }
  | { ok: false; code: Extract<ErrorCode, 'RATE_LIMITED'>; message: string };

export type LookupResult =
  | { ok: true; room: Room }
  | { ok: false; code: Extract<ErrorCode, 'INVALID_CODE' | 'ROOM_NOT_FOUND'>; message: string };

export interface RoomStats {
  rooms: number;
  players: number;
}

const MAX_CODE_ATTEMPTS = 1000;
/**
 * Global cap on rooms. Each room holds state, a chat log and a timer and an abandoned one lives
 * EMPTY_ROOM_TTL_MS, so without a ceiling one client could exhaust memory (or the code space).
 */
export const MAX_ROOMS = 5000;

/** All rooms of one process, across every game: codes are a single namespace. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly transport: Transport;
  private readonly storage: GameStorage;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly maxRooms: number;
  private readonly log: ((msg: string) => void) | undefined;

  constructor(deps: RoomManagerDeps) {
    this.transport = deps.transport;
    this.storage = deps.storage ?? new MemoryStorage();
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.maxRooms = deps.maxRooms ?? MAX_ROOMS;
    this.log = deps.log;
  }

  get isAtCapacity(): boolean {
    return this.rooms.size >= this.maxRooms;
  }

  /** Creates a room for `gameId` with a fresh code and seats its host, unless the server is at its room cap. */
  createRoom(gameId: GameId, name: string, avatar: Avatar, connectionId: string): CreateResult {
    if (this.isAtCapacity) {
      return { ok: false, code: 'RATE_LIMITED', message: 'The server is hosting too many rooms right now. Please try again in a minute.' };
    }
    const code = this.uniqueCode();
    const room = new Room(code, gameId, {
      transport: this.transport,
      storage: this.storage,
      clock: this.clock,
      rng: this.rng,
      log: this.log,
      // Rooms delete themselves once they have been empty for EMPTY_ROOM_TTL_MS.
      onDestroy: (r) => {
        if (this.rooms.get(r.code) === r) this.rooms.delete(r.code);
      },
    });
    this.rooms.set(code, room);
    const joined = room.create(name, avatar, connectionId);
    if (!joined.ok) {
      // Cannot happen for a brand-new room, but never leave an orphan behind.
      this.rooms.delete(code);
      room.destroy();
      throw new Error(`failed to seat host in new room: ${joined.code}`);
    }
    return { ok: true, room, playerId: joined.playerId };
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
}
