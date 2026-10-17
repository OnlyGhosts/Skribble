/**
 * Sliding-window rate limiter: allows at most `limit` events per `windowMs`.
 * Timestamps are injected so tests (and the server's clock) stay deterministic.
 */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an event at `now` and returns whether it is within the limit. */
  tryAcquire(now: number): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0] <= cutoff) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}

/**
 * A RateLimiter per key (a room code, say). Keys quiet for a whole window are forgotten; beyond
 * `maxKeys` live keys a new key is refused, so the map cannot be grown without end.
 */
export class KeyedRateLimiter {
  private readonly limiters = new Map<string, { limiter: RateLimiter; lastAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  tryAcquire(key: string, now: number): boolean {
    let entry = this.limiters.get(key);
    if (!entry) {
      if (this.limiters.size >= this.maxKeys) this.prune(now);
      if (this.limiters.size >= this.maxKeys) return false;
      entry = { limiter: new RateLimiter(this.limit, this.windowMs), lastAt: now };
      this.limiters.set(key, entry);
    }
    entry.lastAt = now;
    return entry.limiter.tryAcquire(now);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.limiters) if (now - entry.lastAt >= this.windowMs) this.limiters.delete(key);
  }
}
