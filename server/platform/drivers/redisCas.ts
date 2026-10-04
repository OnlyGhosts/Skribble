import type { Redis } from 'ioredis';

export { MAX_CAS_RETRIES, retryCas } from '../cas.js';

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
