import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import type { ErrorCode } from '../../../shared/platform/protocol.js';
import type { PlatformRoomMessage } from '../drivers/types.js';

export type Action =
  /** Seats the first player of a brand-new room. Fails if the room already has players. */
  | { type: 'create'; gameId: GameId; name: string; avatar: Avatar; connectionId: string }
  | { type: 'join'; name: string; avatar: Avatar; connectionId: string }
  | { type: 'rejoin'; token: string; connectionId: string }
  /**
   * The player's socket went away. `connectionId` lets stale sockets (already replaced by a
   * rejoin) be ignored; omit it to disconnect whatever connection the seat holds.
   */
  | { type: 'connectionClosed'; playerId: string; connectionId?: string }
  /** Explicit "leave room": the seat is released immediately. */
  | { type: 'leave'; playerId: string }
  | { type: 'platformMessage'; playerId: string; msg: PlatformRoomMessage }
  /** A raw game message; the reducer validates it with the room's game module. */
  | { type: 'gameMessage'; playerId: string; msg: unknown }
  /** Processes every deadline that is <= ctx.now, in chronological order. Idempotent. */
  | { type: 'tick' };

/** Identity and randomness are injected so the reducer is deterministic. */
export interface Ctx {
  /** Epoch ms. */
  now: number;
  /** Uniform in [0, 1). */
  rng: () => number;
  /** Fresh id (must not look like an integer). */
  newId: () => string;
  /** Fresh seat token. */
  newToken: () => string;
}

export type ActionResult =
  /** `playerId` is set for create/join/rejoin: the seat the connection now holds. */
  | { ok: true; playerId: string | null }
  | { ok: false; code: ErrorCode; message: string };
