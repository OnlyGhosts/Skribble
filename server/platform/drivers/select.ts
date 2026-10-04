import { MemoryDriver } from './memory.js';
import { RedisDriver } from './redis.js';
import type { GameDriver } from './types.js';

/** Vercel Marketplace Redis injects REDIS_URL; some providers call it KV_URL. */
export function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.REDIS_URL || env.KV_URL || null;
}

export interface SelectDriverOptions {
  log: (msg: string) => void;
  /** Warn loudly when falling back to memory (multi-instance hosts lose rooms between instances). */
  expectRedis?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** RedisDriver when REDIS_URL/KV_URL is set, MemoryDriver otherwise. Redis connects lazily, on first use. */
export function createDriverFromEnv(options: SelectDriverOptions): GameDriver {
  const url = redisUrlFromEnv(options.env);
  if (url) {
    options.log(`driver: redis (${describeUrl(url)})`);
    return new RedisDriver({ url, log: options.log });
  }
  if (options.expectRedis) {
    options.log('WARNING: neither REDIS_URL nor KV_URL is set. Falling back to in-memory rooms, which only');
    options.log('WARNING: work while every player lands on the same instance. Add a Redis store to fix this.');
  } else {
    options.log('driver: memory');
  }
  return new MemoryDriver();
}

/** Host and scheme only; never the credentials. */
function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return 'unparseable url';
  }
}
