import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from '@shared/platform/roomCode';
import { roomTitle, sansBold } from './tabTitle';

/** The Mathematical Sans-Serif Bold forms, typed out rather than computed, for every room code character. */
const EXPECTED: Record<string, string> = {
  A: '𝗔',
  B: '𝗕',
  C: '𝗖',
  D: '𝗗',
  E: '𝗘',
  F: '𝗙',
  G: '𝗚',
  H: '𝗛',
  J: '𝗝',
  K: '𝗞',
  M: '𝗠',
  N: '𝗡',
  P: '𝗣',
  Q: '𝗤',
  R: '𝗥',
  S: '𝗦',
  T: '𝗧',
  U: '𝗨',
  V: '𝗩',
  W: '𝗪',
  X: '𝗫',
  Y: '𝗬',
  Z: '𝗭',
  '2': '𝟮',
  '3': '𝟯',
  '4': '𝟰',
  '5': '𝟱',
  '6': '𝟲',
  '7': '𝟳',
  '8': '𝟴',
  '9': '𝟵',
};

describe('the room tab title', () => {
  it('turns every character a room code can contain into its sans-serif bold form', () => {
    expect(Object.keys(EXPECTED).sort().join('')).toBe([...ROOM_CODE_ALPHABET].sort().join(''));
    for (const ch of ROOM_CODE_ALPHABET) {
      const bold = sansBold(ch);
      expect(bold, ch).toBe(EXPECTED[ch]);
      expect([...bold], ch).toHaveLength(1);
      expect(bold.codePointAt(0), ch).toBeGreaterThanOrEqual(0x1d5d4);
    }
  });

  it('leaves anything else as it is', () => {
    expect(sansBold('a-0 1!')).toBe('𝗮-𝟬 𝟭!');
    expect(sansBold('·')).toBe('·');
  });

  it('reads the site, a door, then the code', () => {
    expect(roomTitle('5S64')).toBe('boredgames.io 🚪 𝟱𝗦𝟲𝟰');
    expect(roomTitle('ABCD')).toBe('boredgames.io \u{1F6AA} 𝗔𝗕𝗖𝗗');
  });
});
