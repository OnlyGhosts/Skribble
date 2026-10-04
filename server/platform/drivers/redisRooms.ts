import type { Redis } from 'ioredis';
import type { GameId } from '../../../shared/platform/games.js';
import type { Action, ActionResult, Ctx } from '../engine/actions.js';
import type { Effect } from '../engine/effects.js';
import { findPlayer } from '../engine/players.js';
import { applyAction } from '../engine/reduce.js';
import { createRoomData, type PlatformRoomData } from '../engine/state.js';
import { STAMP_FIELD } from '../storage.js';
import { CasScript, retryCas } from './redisCas.js';
import { ROOM_KEY_PATTERN, ROOM_TTL_MS, presenceKey, roomChannel, roomKey, sideHashKey, sideListKey, sideSeqKey, type RoomChannelMessage } from './redisKeys.js';
import type { AsyncLock } from './serial.js';

/** SCAN iterations the health endpoint is willing to spend. */
const MAX_SCAN_ITERATIONS = 50;

/**
 * Writes a room only if it still reads as it did when the action was applied (a missing key reads
 * as ''). KEYS: room, side list, side hash, side seq, the seated player's presence key (or ''
 * when nobody was seated), then the presence keys of removed players. ARGV: expected value,
 * 'set' | 'destroy', new value, room TTL, '1' when the side store must be reset, its new stamp,
 * seated connection id (or ''), presence TTL.
 */
const WRITE_ROOM = `
local current = redis.call('GET', KEYS[1]) or ''
if current ~= ARGV[1] then return 0 end
if ARGV[2] == 'destroy' then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
else
  redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
  if ARGV[5] == '1' then
    redis.call('DEL', KEYS[2], KEYS[3])
    redis.call('HSET', KEYS[3], '${STAMP_FIELD}', ARGV[6])
    redis.call('PEXPIRE', KEYS[3], ARGV[4])
    redis.call('INCR', KEYS[4])
    redis.call('PEXPIRE', KEYS[4], ARGV[4])
  end
end
if ARGV[7] ~= '' then redis.call('SET', KEYS[5], ARGV[7], 'PX', ARGV[8]) end
for i = 6, #KEYS do redis.call('DEL', KEYS[i]) end
return 1
`;

export interface DispatchOptions {
  /** Start from a fresh room for this game when the key is missing (room creation). */
  createIfMissing?: GameId;
  /**
   * Runs with the new state once it is committed (or known unchanged) and before the effects are
   * published, so the caller can bind sockets that the published effects must reach.
   */
  onApplied?: (data: PlatformRoomData, result: ActionResult) => void;
}

export type Dispatched =
  | { ok: true; data: PlatformRoomData; effects: Effect[]; result: ActionResult }
  | { ok: false; code: 'ROOM_NOT_FOUND'; message: string };

export interface RoomCount {
  rooms: number;
  approximate: boolean;
}

/**
 * Room data in Redis with optimistic concurrency: every action is applied to the version just read
 * and written back by a compare-and-set on that very value, so instances never overwrite each
 * other. `lock` serialises this instance's own writes so they do not conflict with one another.
 */
export class RedisRooms {
  private readonly write: CasScript;

  constructor(
    private readonly redis: Redis,
    private readonly lock: AsyncLock,
    private readonly ctx: () => Ctx,
    private readonly presenceTtlMs: number,
  ) {
    this.write = new CasScript(redis, WRITE_ROOM);
  }

  async read(code: string): Promise<PlatformRoomData | null> {
    const raw = await this.redis.get(roomKey(code));
    return raw === null ? null : (JSON.parse(raw) as PlatformRoomData);
  }

  async exists(code: string): Promise<boolean> {
    return (await this.redis.exists(roomKey(code))) === 1;
  }

  dispatch(code: string, action: Action, options: DispatchOptions = {}): Promise<Dispatched> {
    return this.lock.run(() => Promise.resolve(retryCas(`room ${code}`, () => this.attempt(code, action, options))));
  }

  publish(code: string, msg: RoomChannelMessage): Promise<number> {
    return this.redis.publish(roomChannel(code), JSON.stringify(msg));
  }

  /**
   * Marks the player's connection alive for another presence TTL. The room's own keys are only
   * written by actions, so an idle room with connected players is kept alive from here too.
   */
  async touch(code: string, playerId: string, connectionId: string): Promise<void> {
    await this.redis
      .pipeline()
      .set(presenceKey(code, playerId), connectionId, 'PX', this.presenceTtlMs)
      .pexpire(roomKey(code), ROOM_TTL_MS)
      .pexpire(sideSeqKey(code), ROOM_TTL_MS)
      .exec();
  }

  /** The connection id stored for each player's presence, null where it expired. */
  async presence(code: string, playerIds: string[]): Promise<(string | null)[]> {
    if (playerIds.length === 0) return [];
    return this.redis.mget(playerIds.map((id) => presenceKey(code, id)));
  }

  /** Counts room keys with a bounded SCAN; `approximate` when the bound was hit. */
  async countRooms(): Promise<RoomCount> {
    let cursor = '0';
    let rooms = 0;
    for (let i = 0; i < MAX_SCAN_ITERATIONS; i++) {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', ROOM_KEY_PATTERN, 'COUNT', 200);
      rooms += keys.length;
      cursor = next;
      if (cursor === '0') return { rooms, approximate: false };
    }
    return { rooms, approximate: true };
  }

  private async attempt(code: string, action: Action, options: DispatchOptions): Promise<Dispatched | 'conflict'> {
    const key = roomKey(code);
    const raw = await this.redis.get(key);
    const ctx = this.ctx();
    let before: PlatformRoomData;
    if (raw === null) {
      if (!options.createIfMissing) return { ok: false, code: 'ROOM_NOT_FOUND', message: `No room with code ${code} exists.` };
      before = createRoomData(code, options.createIfMissing, ctx.now);
    } else {
      before = JSON.parse(raw) as PlatformRoomData;
    }
    const { data, effects, result } = applyAction(before, action, ctx);
    const destroyed = effects.some((e) => e.type === 'destroy');
    // The last reset wins: the side store ends up stamped for the state being written.
    const reset = effects.filter((e): e is Extract<Effect, { type: 'side' }> => e.type === 'side').at(-1);
    const isSeat = action.type === 'create' || action.type === 'join' || action.type === 'rejoin';
    const seated = isSeat && result.ok && result.playerId !== null ? { playerId: result.playerId, connectionId: action.connectionId } : null;
    const removed = before.players.filter((p) => !findPlayer(data, p.id)).map((p) => p.id);
    const changed = data !== before || raw === null;
    const message: RoomChannelMessage = { kind: 'effects', version: data.version, data, effects };

    if (changed || destroyed || reset || seated !== null || removed.length > 0) {
      const json = JSON.stringify(data);
      const committed = await this.write.run(
        [key, sideListKey(code), sideHashKey(code), sideSeqKey(code), seated ? presenceKey(code, seated.playerId) : '', ...removed.map((id) => presenceKey(code, id))],
        [raw ?? '', destroyed ? 'destroy' : 'set', json, ROOM_TTL_MS, reset ? '1' : '', reset?.stamp ?? '', seated?.connectionId ?? '', this.presenceTtlMs],
      );
      // A reply lost to a reconnect makes ioredis replay the script, which then fails against its own
      // write: re-read before retrying, or the action would be applied twice.
      if (committed !== 1 && !(await this.landed(key, destroyed ? null : json))) return 'conflict';
    }
    options.onApplied?.(data, result);
    if (changed || effects.length > 0) await this.publish(code, message);
    return { ok: true, data, effects, result };
  }

  private async landed(key: string, expected: string | null): Promise<boolean> {
    return (await this.redis.get(key)) === expected;
  }
}
