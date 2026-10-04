import type { Redis } from 'ioredis';
import type { CanvasAction, DrawOp } from '../../shared/protocol.js';
import { admitAll, emptyCounts, replayOps, startsAction, type AppendResult, type CanvasCounts } from '../canvasStore.js';
import { CasScript, retryCas } from './redisCas.js';
import { CANVAS_TURN_FIELD, ROOM_TTL_MS, canvasKey, canvasMetaKey, canvasSeqKey } from './redisKeys.js';
import type { AsyncLock } from './serial.js';

/** Batches read per round trip while walking back to the start of the last action. */
const UNDO_CHUNK = 8;
const STROKE_FIELD = 's:';

/** Every script takes KEYS list, meta, seq and ARGV[1] = the seq the caller read; a changed seq means a retry. */
const CHECK_SEQ = `
local seq = redis.call('GET', KEYS[3]) or '0'
if seq ~= ARGV[1] then return 0 end
`;

/** ARGV: seq, TTL, batch count n, n batches, then the meta fields and values. */
const APPEND = `${CHECK_SEQ}
local n = tonumber(ARGV[3])
redis.call('RPUSH', KEYS[1], unpack(ARGV, 4, 3 + n))
redis.call('HSET', KEYS[2], unpack(ARGV, 4 + n))
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
local next = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[2])
return next
`;

/** ARGV: seq, batches to pop, points to release, stroke field to drop (or ''). */
const POP_ACTION = `${CHECK_SEQ}
redis.call('RPOP', KEYS[1], ARGV[2])
redis.call('HINCRBY', KEYS[2], 'actions', -1)
if tonumber(ARGV[3]) > 0 then redis.call('HINCRBY', KEYS[2], 'points', -ARGV[3]) end
if ARGV[4] ~= '' then redis.call('HDEL', KEYS[2], ARGV[4]) end
return redis.call('INCR', KEYS[3])
`;

/** ARGV: seq, turnId, TTL. Empties the canvas and stamps it with the turn. */
const RESET = `${CHECK_SEQ}
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[2], '${CANVAS_TURN_FIELD}', ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
local next = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return next
`;

export interface CanvasAppend extends AppendResult {
  /** Sequence number of this change; 0 when nothing was accepted. */
  seq: number;
}

export interface CanvasSnapshot {
  actions: CanvasAction[];
  /** Sequence number of the last change the snapshot includes. */
  seq: number;
}

/**
 * A room's canvas in Redis: a list of JSON op batches, each belonging to exactly one canvas
 * action (a batch never spans a 'start' or 'fill'), a hash with the counts the caps need and the
 * turn the canvas belongs to, and a sequence number bumped by every change (the engine's resets
 * included). The ops are admitted by the very same `admitOp` as the in-memory store, and late
 * joiners get the history by replaying the stored ops through it, so both drivers produce
 * identical canvases.
 *
 * Every write names the drawer's turn: ops for a canvas the engine has since reset are 'stale'
 * (the drawer's instance authorised them against a state that had not seen the reset yet).
 */
export class RedisCanvas {
  private readonly appendScript: CasScript;
  private readonly popScript: CasScript;
  private readonly resetScript: CasScript;

  constructor(
    private readonly redis: Redis,
    private readonly lock: AsyncLock,
  ) {
    this.appendScript = new CasScript(redis, APPEND);
    this.popScript = new CasScript(redis, POP_ACTION);
    this.resetScript = new CasScript(redis, RESET);
  }

  append(code: string, turnId: number, ops: readonly DrawOp[]): Promise<CanvasAppend | 'stale'> {
    return this.lock.run(() => retryCas(`canvas ${code}`, () => this.appendAttempt(code, turnId, ops)));
  }

  /** Removes the last action; the change's sequence number, or null when there was nothing to undo. */
  undo(code: string, turnId: number): Promise<number | null> {
    return this.lock.run(() => retryCas(`canvas ${code}`, () => this.undoAttempt(code, turnId)));
  }

  /** Empties the canvas; the change's sequence number, or null for a stale turn. */
  clear(code: string, turnId: number): Promise<number | null> {
    return this.lock.run(() => retryCas(`canvas ${code}`, () => this.clearAttempt(code, turnId)));
  }

  /** The history and the sequence number it is current to, read atomically. */
  async load(code: string): Promise<CanvasSnapshot> {
    const res = await this.redis.multi().lrange(canvasKey(code), 0, -1).get(canvasSeqKey(code)).exec();
    if (!res) throw new Error(`canvas ${code}: snapshot failed`);
    const batches = res[0]?.[1];
    const actions = replayOps(Array.isArray(batches) ? batches.flatMap((b) => parseBatch(String(b))) : []);
    return { actions, seq: Number(res[1]?.[1] ?? 0) };
  }

  private keys(code: string): string[] {
    return [canvasKey(code), canvasMetaKey(code), canvasSeqKey(code)];
  }

  /** The meta hash and the sequence number, read atomically. */
  private async state(code: string): Promise<{ hash: Record<string, string>; seq: number }> {
    const res = await this.redis.multi().hgetall(canvasMetaKey(code)).get(canvasSeqKey(code)).exec();
    if (!res) throw new Error(`canvas ${code}: read failed`);
    const hash = res[0]?.[1];
    return { hash: isStringRecord(hash) ? hash : {}, seq: Number(res[1]?.[1] ?? 0) };
  }

  private async appendAttempt(code: string, turnId: number, ops: readonly DrawOp[]): Promise<CanvasAppend | 'stale' | 'conflict'> {
    const { hash, seq } = await this.state(code);
    if (isOtherTurn(hash[CANVAS_TURN_FIELD], turnId)) return 'stale';
    const counts = countsFrom(hash);
    const batches: DrawOp[][] = [];
    const touched = new Set<number>();
    let current: DrawOp[] = [];
    let currentAction: string | null = null;
    const { accepted, truncated } = admitAll(ops, counts, (kept) => {
      const action = actionOf(kept);
      if (startsAction(kept) || action !== currentAction || current.length === 0) {
        current = [];
        batches.push(current);
        currentAction = action;
      }
      current.push(kept);
      if (kept.k === 'start' || kept.k === 'move') touched.add(kept.id);
    });
    if (batches.length === 0) return { accepted, truncated, seq: 0 };
    const fields: string[] = [CANVAS_TURN_FIELD, String(turnId), 'actions', String(counts.actions), 'points', String(counts.points)];
    for (const id of touched) fields.push(`${STROKE_FIELD}${id}`, String(counts.strokes.get(id) ?? 0));
    const next = await this.appendScript.run(this.keys(code), [seq, ROOM_TTL_MS, batches.length, ...batches.map((b) => JSON.stringify(b)), ...fields]);
    return next === 0 ? 'conflict' : { accepted, truncated, seq: next };
  }

  private async undoAttempt(code: string, turnId: number): Promise<number | null | 'conflict'> {
    const list = canvasKey(code);
    const { hash, seq } = await this.state(code);
    if (isOtherTurn(hash[CANVAS_TURN_FIELD], turnId)) return null;
    const length = await this.redis.llen(list);
    if (length === 0) return null;
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
    // Nothing marks an action start: the history is unusable, so drop it rather than guess.
    if (!found) return this.reset(code, seq, turnId);
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
    const next = await this.popScript.run(this.keys(code), [seq, removed.length, points, strokeId === null ? '' : `${STROKE_FIELD}${strokeId}`]);
    return next === 0 ? 'conflict' : next;
  }

  private async clearAttempt(code: string, turnId: number): Promise<number | null | 'conflict'> {
    const { hash, seq } = await this.state(code);
    if (isOtherTurn(hash[CANVAS_TURN_FIELD], turnId)) return null;
    return this.reset(code, seq, turnId);
  }

  private async reset(code: string, seq: number, turnId: number): Promise<number | 'conflict'> {
    const next = await this.resetScript.run(this.keys(code), [seq, turnId, ROOM_TTL_MS]);
    return next === 0 ? 'conflict' : next;
  }
}

/** A canvas stamped with another turn refuses the write; an unstamped one (no turn started yet) accepts it. */
function isOtherTurn(stored: string | undefined, turnId: number): boolean {
  return stored !== undefined && Number(stored) !== turnId;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
