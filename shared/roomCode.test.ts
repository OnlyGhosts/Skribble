import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  extractRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from './roomCode';

describe('room codes', () => {
  it('alphabet has no look-alike glyphs', () => {
    for (const ch of 'ILO01') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('generates valid codes', () => {
    for (let i = 0; i < 500; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });

  it('is deterministic with an injected rng', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAA');
    expect(generateRoomCode(() => 0.9999)).toBe('9999');
  });

  it('normalizes user input', () => {
    expect(normalizeRoomCode(' ab-c2 ')).toBe('ABC2');
    expect(normalizeRoomCode('abcd2')).toBe('ABCD');
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('ABCO')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
  });

  it('extracts codes from share links and raw text', () => {
    expect(extractRoomCode('https://play.example.com/XK4P')).toBe('XK4P');
    expect(extractRoomCode('https://play.example.com/?room=xk4p')).toBe('XK4P');
    expect(extractRoomCode('xk4p')).toBe('XK4P');
    expect(extractRoomCode('hello')).toBeNull();
    expect(extractRoomCode('')).toBeNull();
  });
});
