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
