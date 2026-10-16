import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_EMOJIS, AVATAR_FACES, avatarEmoji, avatarFace, avatarSchema, randomAvatar } from './avatar.js';

/** The faces before the Fluent pictures, in their saved order: a stored index must keep its face. */
const FIRST_24 = ['😀', '😎', '🤠', '🥳', '🤖', '👻', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🐧', '🦖', '🍕', '🌵', '🚀', '🎃', '🐝', '🦋', '🐢', '🦁'];
const ADDED_26 = ['🤪', '😴', '🤓', '🥸', '🤡', '👽', '💀', '🐻', '🐨', '🐯', '🐷', '🐮', '🐰', '🦉', '🦩', '🐳', '🦈', '🦀', '🐲', '🦥', '🦔', '🍔', '🌮', '🍩', '🍉', '🥑'];

const avatarsDir = fileURLToPath(new URL('../../client/public/avatars/', import.meta.url));

describe('avatar faces', () => {
  it('are 50, the first 24 unchanged and the 26 new ones after them in order', () => {
    expect(AVATAR_FACES).toHaveLength(50);
    expect(AVATAR_EMOJIS).toEqual([...FIRST_24, ...ADDED_26]);
  });

  it('have no repeated emoji, name or file', () => {
    for (const key of ['emoji', 'name', 'file'] as const) {
      expect(new Set(AVATAR_FACES.map((f) => f[key])).size, key).toBe(AVATAR_FACES.length);
    }
  });

  it('each have a 104px WebP picture beside the Fluent Emoji licence', () => {
    let total = 0;
    for (const { file } of AVATAR_FACES) {
      const bytes = readFileSync(`${avatarsDir}${file}.webp`);
      total += bytes.length;
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('RIFF');
      expect(bytes.subarray(8, 16).toString('latin1'), file).toBe('WEBPVP8X');
      // VP8X stores the canvas width and height less one, 24 bits each.
      expect(bytes.readUIntLE(24, 3) + 1, file).toBe(104);
      expect(bytes.readUIntLE(27, 3) + 1, file).toBe(104);
    }
    expect(total).toBeLessThan(250_000);
    expect(readFileSync(`${avatarsDir}LICENSE-fluentui-emoji.txt`, 'utf8')).toMatch(/^MIT License\n\nCopyright \(c\) Microsoft Corporation\./);
    expect(existsSync(`${avatarsDir}README.md`)).toBe(true);
  });
});

describe('avatar schema', () => {
  it('takes every face and colour, including what an old client sends', () => {
    for (let emoji = 0; emoji < 50; emoji++) expect(avatarSchema.safeParse({ color: 0, emoji }).success, String(emoji)).toBe(true);
    expect(avatarSchema.safeParse({ color: 11, emoji: 23 }).success).toBe(true);
  });

  it('refuses a face or colour past the lists', () => {
    expect(avatarSchema.safeParse({ color: 0, emoji: 50 }).success).toBe(false);
    expect(avatarSchema.safeParse({ color: 0, emoji: -1 }).success).toBe(false);
    expect(avatarSchema.safeParse({ color: 12, emoji: 0 }).success).toBe(false);
    expect(avatarSchema.safeParse({ color: 0, emoji: 1.5 }).success).toBe(false);
  });

  it('draws a random avatar from all 50 faces', () => {
    expect(randomAvatar(() => 0.999)).toEqual({ color: 11, emoji: 49 });
    expect(randomAvatar(() => 0)).toEqual({ color: 0, emoji: 0 });
  });

  it('falls back to the first face for an index it does not know', () => {
    expect(avatarFace({ color: 0, emoji: 49 }).name).toBe('Avocado');
    expect(avatarFace({ color: 0, emoji: 99 })).toBe(AVATAR_FACES[0]);
    expect(avatarEmoji({ color: 0, emoji: 29 })).toBe('👽');
  });
});
