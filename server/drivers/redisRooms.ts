import type { Redis } from 'ioredis';
import type { Action, ActionResult, Ctx } from '../engine/actions';
import type { Effect } from '../engine/effects';
import { findPlayer } from '../engine/players';
import { applyAction } from '../engine/reduce';
import { createRoomData, type RoomData } from '../engine/state';
import { ROOM_KEY_PATTERN, ROOM_TTL_MS, canvasKey, canvasMetaKey, presenceKey, roomChannel, roomKey, type RoomChannelMessage } from './redisKeys';
import type { AsyncLock } from './serial';

/** Concurrent writers (other instances) make EXEC fail; each retry re-reads the room. */
const MAX_CAS_RETRIES = 5;
/** SCAN iterations the health endpoint is willing to spend. */
const MAX_SCAN_ITERATIONS = 50;

export interface DispatchOptions {
  /** Start from a fresh room when the key is missing (room creation). */
  createIfMissing?: boolean;
  /**
   * Runs with the new state once it is committed (or known unchanged) and before the effects are
   * published, so the caller can bind sockets that the published effects must reach.
   */
  onApplied?: (data: RoomData, result: ActionResult) => void;
}

export type Dispatched =
  | { ok: true; data: RoomData; effects: Effect[]; result: ActionResult; destroyed: boolean }
  | { ok: false; code: 'ROOM_NOT_FOUND'; message: string };

export interface RoomCount {
  rooms: number;
  approximate: boolean;
}

/**
 * RoomData in Redis with optimistic concurrency: every action is applied to the version just
 * read and written back inside WATCH/MULTI/EXEC, so instances never overwrite each other. All
 * writes go through one dedicated connection guarded by `lock` (WATCH is per connection).
 */
export class RedisRooms {
  constructor(
    private readonly redis: Redis,
    private readonly tx: Redis,
    private readonly lock: AsyncLock,
    private readonly ctx: () => Ctx,
    private readonly presenceTtlMs: number,
  ) {}

  async read(code: string): Promise<RoomData | null> {
    const raw = await this.redis.get(roomKey(code));
    return raw === null ? null : (JSON.parse(raw) as RoomData);
  }

  async exists(code: string): Promise<boolean> {
    return (await this.redis.exists(roomKey(code))) === 1;
  }

  dispatch(code: string, action: Action, options: DispatchOptions = {}): Promise<Dispatched> {
    return this.lock.run(async () => {
      for (let attempt = 0; ; attempt++) {
        const out = await this.attempt(code, action, options);
        if (out !== 'conflict') return out;
        if (attempt >= MAX_CAS_RETRIES) throw new Error(`room ${code}: gave up after ${attempt} concurrent writes`);
        await sleep(5 + Math.random() * 20);
      }
    });
  }

  publish(code: string, msg: RoomChannelMessage): Promise<number> {
    return this.redis.publish(roomChannel(code), JSON.stringify(msg));
  }

  /** Marks the player's connection alive for another presence TTL. */
  async touch(code: string, playerId: string, connectionId: string): Promise<void> {
    await this.redis.set(presenceKey(code, playerId), connectionId, 'PX', this.presenceTtlMs);
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
    await this.tx.watch(key);
    try {
      const raw = await this.tx.get(key);
      const ctx = this.ctx();
      let before: RoomData;
      if (raw === null) {
        if (!options.createIfMissing) {
          await this.tx.unwatch();
          return { ok: false, code: 'ROOM_NOT_FOUND', message: `No room with code ${code} exists.` };
        }
        before = createRoomData(code, ctx.now);
      } else {
        before = JSON.parse(raw) as RoomData;
      }
      const { data, effects, result } = applyAction(before, action, ctx);
      const destroyed = effects.some((e) => e.type === 'destroy');
      const clearCanvas = effects.some((e) => e.type === 'canvas');
      const isSeat = action.type === 'create' || action.type === 'join' || action.type === 'rejoin';
      const seated = isSeat && result.ok && result.playerId !== null ? { playerId: result.playerId, connectionId: action.connectionId } : null;
      const removed = before.players.filter((p) => !findPlayer(data, p.id)).map((p) => p.id);
      const changed = data !== before || raw === null;
      const message: RoomChannelMessage = { kind: 'effects', version: data.version, data, effects };

      if (!changed && !destroyed && !clearCanvas && seated === null && removed.length === 0) {
        await this.tx.unwatch();
        options.onApplied?.(data, result);
        if (effects.length > 0) await this.publish(code, message);
        return { ok: true, data, effects, result, destroyed };
      }

      const multi = this.tx.multi();
      if (destroyed) {
        multi.del(key, canvasKey(code), canvasMetaKey(code));
      } else {
        multi.set(key, JSON.stringify(data), 'PX', ROOM_TTL_MS);
        if (clearCanvas) multi.del(canvasKey(code), canvasMetaKey(code));
      }
      // Presence is written in the same transaction as the seat, so a connected player always has a key until it expires.
      if (seated) multi.set(presenceKey(code, seated.playerId), seated.connectionId, 'PX', this.presenceTtlMs);
      for (const id of removed) multi.del(presenceKey(code, id));
      const res = await multi.exec();
      if (res === null) return 'conflict';
      options.onApplied?.(data, result);
      await this.publish(code, message);
      return { ok: true, data, effects, result, destroyed };
    } catch (err) {
      await this.tx.unwatch().catch(() => undefined);
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
