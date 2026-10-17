/**
 * Loading a room that was stored outside this process (a Redis key, a phone's checkpoint): the
 * game id and room upgrades every stored room goes through, then a check of the platform's own
 * record. The game's state is the module's business; whatever fails here reads as no room at all.
 */
import { z } from 'zod';
import { avatarSchema } from '../../shared/platform/avatar.js';
import { upgradeGameId } from '../../shared/platform/games.js';
import { CHAT_KINDS, type ChatKind } from '../../shared/platform/protocol.js';
import { CONTENT_MODES } from '../../shared/platform/settings.js';
import { upgradeRoomData, type PlatformRoomData } from './engine/state.js';

const time = z.number();
const nullableTime = time.nullable();

const playerSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  name: z.string(),
  avatar: avatarSchema,
  score: z.number(),
  joinOrder: z.number().int().nonnegative(),
  connected: z.boolean(),
  connectionId: z.string().nullable(),
  connectedAt: time,
  disconnectedAt: nullableTime,
  ready: z.boolean(),
  sittingOut: z.boolean(),
  participating: z.boolean(),
  awayNoticeAt: nullableTime.optional(),
  idle: z.boolean().optional(),
  lastSeq: z.number().int().nonnegative().optional(),
});

const resultsSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  reason: z.enum(['finished', 'host', 'players']),
  entries: z.array(z.object({ playerId: z.string(), name: z.string(), avatar: avatarSchema, score: z.number(), rank: z.number().int() })),
});

const chatSchema = z.object({
  id: z.number().int(),
  kind: z.string().refine((k): k is ChatKind => (CHAT_KINDS as readonly string[]).includes(k)),
  playerId: z.string().optional(),
  name: z.string().optional(),
  text: z.string(),
  ts: time,
});

/** The platform's part of a stored room, as `upgradeRoomData` leaves it. Unknown fields are kept (retired ones are harmless). */
export const storedRoomSchema = z.looseObject({
  code: z.string().min(1),
  gameId: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: time,
  updatedAt: time,
  settings: z.looseObject({ contentMode: z.enum(CONTENT_MODES) }),
  hostId: z.string(),
  returningHostId: z.string().nullable(),
  players: z.array(playerSchema),
  kickedTokens: z.array(z.string()),
  phase: z.enum(['lobby', 'playing']),
  results: resultsSchema.nullable(),
  endRequested: z.boolean().optional(),
  game: z.unknown(),
  waiting: z.array(z.string()).nullable(),
  waitingUntil: nullableTime.optional(),
  chat: z.array(chatSchema),
  nextChatId: z.number().int(),
  votes: z.array(z.object({ targetId: z.string(), voterIds: z.array(z.string()) })),
  grace: z.object({ emptyRoomAt: nullableTime }),
  nextJoinOrder: z.number().int().nonnegative(),
});

/**
 * A stored room as this deploy runs it, or null: a game the site no longer offers, a record that
 * does not upgrade, or one whose platform fields do not check out. A room stored under a game's
 * former id (from before a rename) loads under the current one.
 */
export function loadStoredRoom(value: unknown): PlatformRoomData | null {
  if (typeof value !== 'object' || value === null) return null;
  const gameId = (value as { gameId?: unknown }).gameId;
  if (typeof gameId !== 'string' || upgradeGameId(gameId) === null) return null;
  let upgraded: PlatformRoomData;
  try {
    upgraded = upgradeRoomData(value as PlatformRoomData);
  } catch {
    return null;
  }
  return storedRoomSchema.safeParse(upgraded).success ? upgraded : null;
}
