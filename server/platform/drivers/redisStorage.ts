import type { Redis } from 'ioredis';
import { STAMP_FIELD, type GameStorage, type StorageState } from '../storage.js';
import { CasScript } from './redisCas.js';
import { ROOM_TTL_MS, sideHashKey, sideListKey, sideSeqKey } from './redisKeys.js';

/** Every script takes KEYS list, hash, seq and ARGV[1] = the seq the caller read; a changed seq means a retry. */
const CHECK_SEQ = `
local seq = redis.call('GET', KEYS[3]) or '0'
if seq ~= ARGV[1] then return 0 end
`;

/** ARGV: seq, TTL, item count n, n items, then the hash fields and values. */
const APPEND = `${CHECK_SEQ}
local n = tonumber(ARGV[3])
if n > 0 then redis.call('RPUSH', KEYS[1], unpack(ARGV, 4, 3 + n)) end
if #ARGV > 3 + n then redis.call('HSET', KEYS[2], unpack(ARGV, 4 + n)) end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
local next = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[2])
return next
`;

/** ARGV: seq, items to pop, increment count m, m field/delta pairs, then fields to delete. */
const POP = `${CHECK_SEQ}
if tonumber(ARGV[2]) > 0 then redis.call('RPOP', KEYS[1], ARGV[2]) end
local m = tonumber(ARGV[3])
for i = 0, m - 1 do redis.call('HINCRBY', KEYS[2], ARGV[4 + i * 2], ARGV[5 + i * 2]) end
for i = 4 + m * 2, #ARGV do redis.call('HDEL', KEYS[2], ARGV[i]) end
return redis.call('INCR', KEYS[3])
`;

/** ARGV: seq ('' for unconditional), stamp, TTL. Empties the store and stamps it. */
const RESET = `
if ARGV[1] ~= '' then
  local seq = redis.call('GET', KEYS[3]) or '0'
  if seq ~= ARGV[1] then return 0 end
end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[2], '${STAMP_FIELD}', ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
local next = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return next
`;

/**
 * GameStorage in Redis: items are JSON strings in a list, the hash and the sequence number are
 * plain keys. Conditional writes are Lua scripts so the seq check and the write are one step.
 */
export class RedisStorage implements GameStorage {
  private readonly appendScript: CasScript;
  private readonly popScript: CasScript;
  private readonly resetScript: CasScript;

  constructor(private readonly redis: Redis) {
    this.appendScript = new CasScript(redis, APPEND);
    this.popScript = new CasScript(redis, POP);
    this.resetScript = new CasScript(redis, RESET);
  }

  async state(code: string): Promise<StorageState> {
    const res = await this.redis.multi().hgetall(sideHashKey(code)).get(sideSeqKey(code)).exec();
    if (!res) throw new Error(`storage ${code}: read failed`);
    const hash = res[0]?.[1];
    return { hash: isStringRecord(hash) ? hash : {}, seq: Number(res[1]?.[1] ?? 0) };
  }

  async list(code: string): Promise<{ items: unknown[]; seq: number }> {
    const res = await this.redis.multi().lrange(sideListKey(code), 0, -1).get(sideSeqKey(code)).exec();
    if (!res) throw new Error(`storage ${code}: snapshot failed`);
    const raw = res[0]?.[1];
    return { items: Array.isArray(raw) ? raw.map((r) => parseItem(String(r))) : [], seq: Number(res[1]?.[1] ?? 0) };
  }

  length(code: string): Promise<number> {
    return this.redis.llen(sideListKey(code));
  }

  async range(code: string, start: number, stop: number): Promise<unknown[]> {
    return (await this.redis.lrange(sideListKey(code), start, stop)).map(parseItem);
  }

  async append(code: string, seq: number, items: unknown[], fields: Record<string, string>): Promise<number | 'conflict'> {
    const flat: string[] = [];
    for (const [k, v] of Object.entries(fields)) flat.push(k, v);
    const next = await this.appendScript.run(this.keys(code), [seq, ROOM_TTL_MS, items.length, ...items.map((i) => JSON.stringify(i)), ...flat]);
    return next === 0 ? 'conflict' : next;
  }

  async pop(code: string, seq: number, count: number, increments: Record<string, number>, deletes: string[]): Promise<number | 'conflict'> {
    const pairs: (string | number)[] = [];
    for (const [k, v] of Object.entries(increments)) pairs.push(k, v);
    const next = await this.popScript.run(this.keys(code), [seq, count, Object.keys(increments).length, ...pairs, ...deletes]);
    return next === 0 ? 'conflict' : next;
  }

  async reset(code: string, seq: number | null, stamp: string): Promise<number | 'conflict'> {
    const next = await this.resetScript.run(this.keys(code), [seq === null ? '' : seq, stamp, ROOM_TTL_MS]);
    return next === 0 ? 'conflict' : next;
  }

  async drop(code: string): Promise<void> {
    await this.redis.del(...this.keys(code));
  }

  private keys(code: string): string[] {
    return [sideListKey(code), sideHashKey(code), sideSeqKey(code)];
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
