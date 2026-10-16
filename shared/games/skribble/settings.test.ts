import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKRIBBLE_SETTINGS,
  SKRIBBLE_DRAW_SECONDS,
  SKRIBBLE_SETTINGS_LIMITS,
  normalizeSkribbleSettings,
  parseCustomWords,
  skribbleSettingsSchema,
} from './protocol.js';

const patchSchema = skribbleSettingsSchema.partial();

describe('skribble settings schema', () => {
  it('accepts the defaults and rejects out-of-range values', () => {
    expect(skribbleSettingsSchema.safeParse(DEFAULT_SKRIBBLE_SETTINGS).success).toBe(true);
    expect(patchSchema.safeParse({}).success).toBe(true);
    expect(patchSchema.safeParse({ rounds: 0 }).success).toBe(false);
    expect(patchSchema.safeParse({ rounds: SKRIBBLE_SETTINGS_LIMITS.rounds.max + 1 }).success).toBe(false);
    expect(patchSchema.safeParse({ language: 'xx' }).success).toBe(false);
    expect(patchSchema.safeParse({ rounds: 2.5 }).success).toBe(false);
    expect(patchSchema.safeParse({ customWords: ['x'.repeat(SKRIBBLE_SETTINGS_LIMITS.customWords.maxLength + 1)] }).success).toBe(false);
  });

  it('has no draw time setting: the turn is the old default, 80 s, and a stored drawTime is ignored', () => {
    expect(SKRIBBLE_DRAW_SECONDS).toBe(80);
    expect(DEFAULT_SKRIBBLE_SETTINGS).not.toHaveProperty('drawTime');
    expect(SKRIBBLE_SETTINGS_LIMITS).not.toHaveProperty('drawTime');
    // Even a value the old schema refused is dropped, not refused: a stored room or an old client may still send it.
    expect(patchSchema.safeParse({ drawTime: 19, rounds: 2 })).toMatchObject({ success: true, data: { rounds: 2 } });
    const stored = skribbleSettingsSchema.safeParse({ ...DEFAULT_SKRIBBLE_SETTINGS, drawTime: 180 });
    expect(stored.success && stored.data).toEqual(DEFAULT_SKRIBBLE_SETTINGS);
  });
});

describe('parseCustomWords', () => {
  it('splits on commas and newlines, trims, dedupes case-insensitively and caps the count', () => {
    expect(parseCustomWords('cat, dog\nhot   dog,CAT,, ,Dog')).toEqual(['cat', 'dog', 'hot dog']);
    expect(parseCustomWords('')).toEqual([]);
    expect(parseCustomWords('x'.repeat(SKRIBBLE_SETTINGS_LIMITS.customWords.maxLength + 1))).toEqual([]);
    const many = Array.from({ length: SKRIBBLE_SETTINGS_LIMITS.customWords.maxCount + 50 }, (_, i) => `w${i}`).join(',');
    expect(parseCustomWords(many)).toHaveLength(SKRIBBLE_SETTINGS_LIMITS.customWords.maxCount);
  });
});

describe('normalizeSkribbleSettings', () => {
  it('normalises custom words and leaves the input untouched', () => {
    const next = normalizeSkribbleSettings({ ...DEFAULT_SKRIBBLE_SETTINGS, rounds: 5, customWords: [' Dog ', 'cat', 'dog'] });
    expect(next.rounds).toBe(5);
    expect(next.customWords).toEqual(['Dog', 'cat']);
    expect(DEFAULT_SKRIBBLE_SETTINGS.customWords).toEqual([]);
  });

  it('turns customWordsOnly off when there are too few custom words', () => {
    expect(normalizeSkribbleSettings({ ...DEFAULT_SKRIBBLE_SETTINGS, customWordsOnly: true }).customWordsOnly).toBe(false);
    const words = Array.from({ length: SKRIBBLE_SETTINGS_LIMITS.customWords.minForOnly }, (_, i) => `w${i}`);
    const enabled = normalizeSkribbleSettings({ ...DEFAULT_SKRIBBLE_SETTINGS, customWordsOnly: true, customWords: words });
    expect(enabled.customWordsOnly).toBe(true);
    expect(normalizeSkribbleSettings({ ...enabled, customWords: ['one'] }).customWordsOnly).toBe(false);
  });
});
