import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimiter';

describe('RateLimiter', () => {
  it('allows `limit` events per window and recovers as the window slides', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.tryAcquire(0)).toBe(true);
    expect(rl.tryAcquire(100)).toBe(true);
    expect(rl.tryAcquire(200)).toBe(true);
    expect(rl.tryAcquire(300)).toBe(false);
    expect(rl.tryAcquire(999)).toBe(false);
    // The first hit (t=0) falls out of the window at t=1000.
    expect(rl.tryAcquire(1000)).toBe(true);
    expect(rl.tryAcquire(1050)).toBe(false);
    expect(rl.tryAcquire(1100)).toBe(true);
  });

  it('rejected attempts do not count against the window', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.tryAcquire(0)).toBe(true);
    for (let t = 1; t < 1000; t += 100) expect(rl.tryAcquire(t)).toBe(false);
    expect(rl.tryAcquire(1000)).toBe(true);
  });
});
