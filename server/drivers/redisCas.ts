import type { Redis } from 'ioredis';

/** Concurrent writers (other instances) make a compare-and-set fail; each retry re-reads its input. */
export const MAX_CAS_RETRIES = 5;

/** Repeats `attempt` while another writer gets in first, up to MAX_CAS_RETRIES. */
export async function retryCas<T>(what: string, attempt: () => Promise<T | 'conflict'>): Promise<T> {
  for (let i = 0; ; i++) {
    const out = await attempt();
    if (out !== 'conflict') return out;
    if (i >= MAX_CAS_RETRIES) throw new Error(`${what}: gave up after ${i} concurrent writes`);
    await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
  }
}

/**
 * A compare-and-set written as a Lua script. Redis' own WATCH/MULTI/EXEC is bound to a connection:
 * when the connection drops in between, ioredis replays the pending MULTI/EXEC on the new one and
 * EXEC commits without the WATCH, over whatever another instance wrote meanwhile. A script checks
 * the condition in the same atomic step as the write, so a replay either applies once or fails.
 */
export class CasScript {
  constructor(
    private readonly redis: Redis,
    private readonly lua: string,
  ) {}

  /** The script's integer result; 0 means the condition did not hold. */
  async run(keys: string[], args: (string | number)[]): Promise<number> {
    return Number(await this.redis.eval(this.lua, keys.length, ...keys, ...args));
  }
}
