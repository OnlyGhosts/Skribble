import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_MAX_AGE_MS, CHECKPOINT_MAX_CHARS } from '../../../shared/platform/constants.js';
import { CHECKPOINT_MAX_FUTURE_MS, CHECKPOINT_MAX_INFLATED_BYTES, openCheckpoint, sealCheckpoint } from './seal.js';

const KEY = randomBytes(32);
const NOW = new Date('2026-01-01T12:00:00Z').getTime();
const ROOM = { code: 'ABCD', players: [{ id: 'p1', token: 'secret-token' }], game: { endsAt: NOW + 5000 } };

/** The sealed bytes with one byte flipped at `index` (negative counts from the end). */
function flip(text: string, index: number): string {
  const raw = Buffer.from(text, 'base64url');
  const i = index < 0 ? raw.length + index : index;
  raw[i] ^= 0x01;
  return raw.toString('base64url');
}

describe('checkpoint seal', () => {
  it('opens what it sealed, with the time it was issued', () => {
    const text = sealCheckpoint(KEY, 'ABCD', NOW, ROOM);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW + 1000 })).toEqual({ ok: true, issuedAt: NOW, value: ROOM });
  });

  it('is opaque: nothing of the room shows in the text, and two seals of one room differ', () => {
    const a = sealCheckpoint(KEY, 'ABCD', NOW, ROOM);
    const b = sealCheckpoint(KEY, 'ABCD', NOW, ROOM);
    expect(a).not.toBe(b);
    const raw = Buffer.from(a, 'base64url').toString('latin1');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('players');
  });

  it('refuses any byte changed: header, time, IV, body and tag', () => {
    const text = sealCheckpoint(KEY, 'ABCD', NOW, ROOM);
    const open = (t: string): ReturnType<typeof openCheckpoint> => openCheckpoint(KEY, t, { code: 'ABCD', now: NOW });
    // The issued-at time is authenticated: an old checkpoint cannot be re-dated to win.
    expect(open(flip(text, 8))).toEqual({ ok: false, reason: 'auth' });
    expect(open(flip(text, 15))).toEqual({ ok: false, reason: 'auth' });
    expect(open(flip(text, 30))).toEqual({ ok: false, reason: 'auth' });
    expect(open(flip(text, -1))).toEqual({ ok: false, reason: 'auth' });
    expect(open(flip(text, -20))).toEqual({ ok: false, reason: 'auth' });
  });

  it('refuses a checkpoint sealed with another key', () => {
    const text = sealCheckpoint(randomBytes(32), 'ABCD', NOW, ROOM);
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'auth' });
  });

  it('refuses a checkpoint for another room, before any crypto', () => {
    const text = sealCheckpoint(KEY, 'WXYZ', NOW, ROOM);
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'code' });
    // Rewriting the code in the header gets past that check, but not the tag.
    const raw = Buffer.from(text, 'base64url');
    raw.write('ABCD', 10, 'ascii');
    expect(openCheckpoint(KEY, raw.toString('base64url'), { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'auth' });
  });

  it('refuses an unknown format version', () => {
    const raw = Buffer.from(sealCheckpoint(KEY, 'ABCD', NOW, ROOM), 'base64url');
    raw[0] = 2;
    expect(openCheckpoint(KEY, raw.toString('base64url'), { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'version' });
  });

  it('refuses one older than the limit and one dated in the future', () => {
    const text = sealCheckpoint(KEY, 'ABCD', NOW, ROOM);
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW + CHECKPOINT_MAX_AGE_MS }).ok).toBe(true);
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW + CHECKPOINT_MAX_AGE_MS + 1 })).toEqual({ ok: false, reason: 'expired' });
    expect(openCheckpoint(KEY, text, { code: 'ABCD', now: NOW - CHECKPOINT_MAX_FUTURE_MS - 1 })).toEqual({ ok: false, reason: 'future' });
  });

  it('refuses oversized text before decoding it, and garbage', () => {
    expect(openCheckpoint(KEY, 'A'.repeat(CHECKPOINT_MAX_CHARS + 1), { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'tooLarge' });
    expect(openCheckpoint(KEY, 'not base64url!', { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'malformed' });
    expect(openCheckpoint(KEY, 'AAAA', { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses one that inflates past the cap, even though its text is small', () => {
    const bomb = sealCheckpoint(KEY, 'ABCD', NOW, { pad: 'x'.repeat(CHECKPOINT_MAX_INFLATED_BYTES + 1) });
    expect(bomb.length).toBeLessThan(CHECKPOINT_MAX_CHARS);
    expect(openCheckpoint(KEY, bomb, { code: 'ABCD', now: NOW })).toEqual({ ok: false, reason: 'inflate' });
  });
});
