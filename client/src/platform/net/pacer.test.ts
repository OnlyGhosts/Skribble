import { describe, expect, it } from 'vitest';
import { CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS, GAME_MESSAGE_RATE_LIMIT_PER_SECOND, PLATFORM_RATE_LIMIT_COUNT } from '@shared/platform/constants';
import { PACE_MARGIN_MS, SendPacer, laneOf } from './pacer';

describe('the resend pacer', () => {
  it('sorts room messages into the server’s three limits', () => {
    expect(laneOf({ t: 'chat', text: 'hi' })).toBe('chat');
    expect(laneOf({ t: 'ready', ready: true })).toBe('platform');
    expect(laneOf({ t: 'endGame' })).toBe('platform');
    expect(laneOf({ t: 'hit' })).toBe('game');
  });

  it('lets a lane fill up to its limit, then waits until the oldest send leaves the window (plus a margin)', () => {
    const pacer = new SendPacer();
    for (let i = 0; i < CHAT_RATE_LIMIT_COUNT; i++) {
      expect(pacer.waitFor('chat', 1000 + i)).toBe(0);
      pacer.record('chat', 1000 + i);
    }
    const now = 1000 + CHAT_RATE_LIMIT_COUNT;
    expect(pacer.waitFor('chat', now)).toBe(1000 + CHAT_RATE_LIMIT_WINDOW_MS + PACE_MARGIN_MS - now);
    expect(pacer.waitFor('chat', 1000 + CHAT_RATE_LIMIT_WINDOW_MS + PACE_MARGIN_MS)).toBe(0);
    // The other lanes are counted apart.
    expect(pacer.waitFor('game', now)).toBe(0);
    expect(pacer.waitFor('platform', now)).toBe(0);
  });

  it('counts sends past the limit too (a player tapping fast), so the wait covers all of them', () => {
    const pacer = new SendPacer();
    for (let i = 0; i < PLATFORM_RATE_LIMIT_COUNT + 5; i++) pacer.record('platform', i * 10);
    const last = (PLATFORM_RATE_LIMIT_COUNT + 4) * 10;
    expect(pacer.waitFor('platform', last)).toBeGreaterThan(0);
    for (let i = 0; i < GAME_MESSAGE_RATE_LIMIT_PER_SECOND; i++) pacer.record('game', 0);
    expect(pacer.waitFor('game', 0)).toBe(1000 + PACE_MARGIN_MS);
  });
});
