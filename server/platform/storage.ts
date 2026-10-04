/**
 * Per-room storage for game side stores: an append-only list of JSON-safe items, a string hash
 * and a sequence number that every write bumps. Writes are conditional on the sequence number the
 * caller read, so concurrent writers (other instances) never interleave; the memory implementation
 * is synchronous and never conflicts, the Redis one (drivers/redisStorage.ts) runs Lua scripts.
 */
import type { MaybePromise } from './drivers/types.js';

/** Reserved hash field holding the store's stamp (see GameSideStore.stamp). */
export const STAMP_FIELD = 'stamp';

export interface StorageState {
  hash: Record<string, string>;
  seq: number;
}

export interface GameStorage {
  /** The hash and the sequence number, read atomically. */
  state(code: string): MaybePromise<StorageState>;
  /** The whole list and the sequence number it is current to, read atomically. */
  list(code: string): MaybePromise<{ items: unknown[]; seq: number }>;
  length(code: string): MaybePromise<number>;
  /** Items in [start, stop] (inclusive, like LRANGE). */
  range(code: string, start: number, stop: number): MaybePromise<unknown[]>;
  /** Appends items and sets hash fields; the new seq, or 'conflict' when `seq` is no longer current. */
  append(code: string, seq: number, items: unknown[], fields: Record<string, string>): MaybePromise<number | 'conflict'>;
  /** Removes the last `count` items, adds `increments` to numeric fields and deletes `deletes`. */
  pop(code: string, seq: number, count: number, increments: Record<string, number>, deletes: string[]): MaybePromise<number | 'conflict'>;
  /** Empties the list and the hash, stamps the store and bumps seq. `seq` null means unconditional. */
  reset(code: string, seq: number | null, stamp: string): MaybePromise<number | 'conflict'>;
  /** Forgets the room entirely. */
  drop(code: string): MaybePromise<void>;
}

interface Entry {
  items: unknown[];
  hash: Record<string, string>;
  seq: number;
}

export class MemoryStorage implements GameStorage {
  private readonly rooms = new Map<string, Entry>();

  state(code: string): StorageState {
    const e = this.rooms.get(code);
    return e ? { hash: { ...e.hash }, seq: e.seq } : { hash: {}, seq: 0 };
  }

  list(code: string): { items: unknown[]; seq: number } {
    const e = this.rooms.get(code);
    return e ? { items: structuredClone(e.items), seq: e.seq } : { items: [], seq: 0 };
  }

  length(code: string): number {
    return this.rooms.get(code)?.items.length ?? 0;
  }

  range(code: string, start: number, stop: number): unknown[] {
    const e = this.rooms.get(code);
    return e ? structuredClone(e.items.slice(start, stop + 1)) : [];
  }

  append(code: string, seq: number, items: unknown[], fields: Record<string, string>): number | 'conflict' {
    const e = this.entry(code);
    if (e.seq !== seq) return 'conflict';
    e.items.push(...structuredClone(items));
    Object.assign(e.hash, fields);
    return ++e.seq;
  }

  pop(code: string, seq: number, count: number, increments: Record<string, number>, deletes: string[]): number | 'conflict' {
    const e = this.entry(code);
    if (e.seq !== seq) return 'conflict';
    e.items.splice(Math.max(0, e.items.length - count), count);
    for (const [field, delta] of Object.entries(increments)) e.hash[field] = String(Number(e.hash[field] ?? '0') + delta);
    for (const field of deletes) delete e.hash[field];
    return ++e.seq;
  }

  reset(code: string, seq: number | null, stamp: string): number | 'conflict' {
    const e = this.entry(code);
    if (seq !== null && e.seq !== seq) return 'conflict';
    e.items = [];
    e.hash = { [STAMP_FIELD]: stamp };
    return ++e.seq;
  }

  drop(code: string): void {
    this.rooms.delete(code);
  }

  private entry(code: string): Entry {
    let e = this.rooms.get(code);
    if (!e) {
      e = { items: [], hash: {}, seq: 0 };
      this.rooms.set(code, e);
    }
    return e;
  }
}
