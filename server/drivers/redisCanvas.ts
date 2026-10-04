import type { Redis } from 'ioredis';
import type { CanvasAction, DrawOp } from '../../shared/protocol';
import { admitOp, emptyCounts, replayOps, startsAction, type AppendResult, type CanvasCounts } from '../canvasStore';
import { ROOM_TTL_MS, canvasKey, canvasMetaKey } from './redisKeys';
import type { AsyncLock } from './serial';

const MAX_CAS_RETRIES = 5;
/** Batches read per round trip while walking back to the start of the last action. */
const UNDO_CHUNK = 8;
const STROKE_FIELD = 's:';

/**
 * A room's canvas in Redis: a list of JSON op batches, each belonging to exactly one canvas
 * action (a batch never spans a 'start' or 'fill'), plus a hash with the counts the caps need.
 * The ops are admitted by the very same `admitOp` as the in-memory store, and late joiners get
 * the history by replaying the stored ops through it, so both drivers produce identical canvases.
 */
export class RedisCanvas {
  constructor(
    private readonly redis: Redis,
    private readonly lock: AsyncLock,
  ) {}

  append(code: string, ops: readonly DrawOp[]): Promise<AppendResult> {
    return this.retry(code, () => this.appendAttempt(code, ops));
  }

  /** Removes the last action; false when the canvas was empty. */
  undo(code: string): Promise<boolean> {
    return this.retry(code, () => this.undoAttempt(code));
  }

  async clear(code: string): Promise<void> {
    await this.redis.del(canvasKey(code), canvasMetaKey(code));
  }

  async load(code: string): Promise<CanvasAction[]> {
    const batches = await this.redis.lrange(canvasKey(code), 0, -1);
    return replayOps(batches.flatMap(parseBatch));
  }

  private retry<T>(code: string, attempt: () => Promise<T | 'conflict'>): Promise<T> {
    return this.lock.run(async () => {
      for (let i = 0; ; i++) {
        const out = await attempt();
        if (out !== 'conflict') return out;
        if (i >= MAX_CAS_RETRIES) throw new Error(`canvas ${code}: gave up after ${i} concurrent writes`);
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
      }
    });
  }

  private async appendAttempt(code: string, ops: readonly DrawOp[]): Promise<AppendResult | 'conflict'> {
    const list = canvasKey(code);
    const meta = canvasMetaKey(code);
    await this.redis.watch(meta);
    try {
      const counts = countsFrom(await this.redis.hgetall(meta));
      const accepted: DrawOp[] = [];
      const batches: DrawOp[][] = [];
      const touched = new Set<number>();
      let truncated = false;
      let current: DrawOp[] = [];
      let currentAction: string | null = null;
      for (const op of ops) {
        const kept = admitOp(op, counts);
        if (kept !== op && op.k !== 'end') truncated = true;
        if (!kept) continue;
        accepted.push(kept);
        const action = actionOf(kept);
        if (startsAction(kept) || action !== currentAction || current.length === 0) {
          current = [];
          batches.push(current);
          currentAction = action;
        }
        current.push(kept);
        if (kept.k === 'start' || kept.k === 'move') touched.add(kept.id);
      }
      if (batches.length === 0) {
        await this.redis.unwatch();
        return { accepted, truncated };
      }
      const fields: Record<string, string> = { actions: String(counts.actions), points: String(counts.points) };
      for (const id of touched) fields[`${STROKE_FIELD}${id}`] = String(counts.strokes.get(id) ?? 0);
      const res = await this.redis
        .multi()
        .rpush(list, ...batches.map((b) => JSON.stringify(b)))
        .hset(meta, fields)
        .pexpire(list, ROOM_TTL_MS)
        .pexpire(meta, ROOM_TTL_MS)
        .exec();
      if (res === null) return 'conflict';
      return { accepted, truncated };
    } catch (err) {
      await this.redis.unwatch().catch(() => undefined);
      throw err;
    }
  }

  private async undoAttempt(code: string): Promise<boolean | 'conflict'> {
    const list = canvasKey(code);
    const meta = canvasMetaKey(code);
    await this.redis.watch(list, meta);
    try {
      const length = await this.redis.llen(list);
      if (length === 0) {
        await this.redis.unwatch();
        return false;
      }
      // Walk back from the end to the batch that began the last action.
      const removed: DrawOp[][] = [];
      let found = false;
      let end = length;
      while (!found && end > 0) {
        const start = Math.max(0, end - UNDO_CHUNK);
        const chunk = await this.redis.lrange(list, start, end - 1);
        for (let i = chunk.length - 1; i >= 0; i--) {
          const batch = parseBatch(chunk[i]);
          removed.unshift(batch);
          if (batch.length > 0 && startsAction(batch[0])) {
            found = true;
            break;
          }
        }
        end = start;
      }
      const multi = this.redis.multi();
      if (!found) {
        // Nothing marks an action start: the history is unusable, so drop it rather than guess.
        multi.del(list, meta);
      } else {
        let points = 0;
        let strokeId: number | null = null;
        for (const op of removed.flat()) {
          if (op.k === 'start') {
            points += 2;
            strokeId = op.id;
          } else if (op.k === 'move') {
            points += op.pts.length;
          }
        }
        multi.rpop(list, removed.length).hincrby(meta, 'actions', -1);
        if (points > 0) multi.hincrby(meta, 'points', -points);
        if (strokeId !== null) multi.hdel(meta, `${STROKE_FIELD}${strokeId}`);
      }
      const res = await multi.exec();
      if (res === null) return 'conflict';
      return true;
    } catch (err) {
      await this.redis.unwatch().catch(() => undefined);
      throw err;
    }
  }
}

/** The canvas action an admitted op belongs to: its stroke, or a fill of its own. */
function actionOf(op: DrawOp): string {
  return op.k === 'fill' ? `fill:${op.x},${op.y},${op.color}` : `${STROKE_FIELD}${op.id}`;
}

function countsFrom(hash: Record<string, string>): CanvasCounts {
  const counts = emptyCounts();
  for (const [field, value] of Object.entries(hash)) {
    if (field === 'actions') counts.actions = Number(value);
    else if (field === 'points') counts.points = Number(value);
    else if (field.startsWith(STROKE_FIELD)) counts.strokes.set(Number(field.slice(STROKE_FIELD.length)), Number(value));
  }
  return counts;
}

function parseBatch(raw: string): DrawOp[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DrawOp[]) : [];
  } catch {
    return [];
  }
}
