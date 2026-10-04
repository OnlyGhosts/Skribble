import { describe, expect, it } from 'vitest';
import { drawerPoints, guesserPoints } from './scoring';

describe('guesserPoints', () => {
  it('scales from 400 (instant) down to 50 (last moment) and clamps out-of-range input', () => {
    expect(guesserPoints(60_000, 60_000)).toBe(400);
    expect(guesserPoints(30_000, 60_000)).toBe(225);
    expect(guesserPoints(0, 60_000)).toBe(50);
    expect(guesserPoints(-5, 60_000)).toBe(50);
    expect(guesserPoints(90_000, 60_000)).toBe(400);
    expect(guesserPoints(10, 0)).toBe(50);
  });

  it('is monotonic in remaining time', () => {
    let prev = guesserPoints(0, 80_000);
    for (let ms = 1000; ms <= 80_000; ms += 1000) {
      const next = guesserPoints(ms, 80_000);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});

describe('drawerPoints', () => {
  it('rewards the share of guessers who got the word, capped at 300', () => {
    expect(drawerPoints(0, 3)).toBe(0);
    expect(drawerPoints(3, 0)).toBe(0);
    expect(drawerPoints(1, 2)).toBe(150);
    expect(drawerPoints(2, 3)).toBe(200);
    expect(drawerPoints(3, 3)).toBe(300);
    expect(drawerPoints(5, 3)).toBe(300);
  });
});
