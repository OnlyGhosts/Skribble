import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  applySettingsPatch,
  parseCustomWords,
  roomSettingsPatchSchema,
  roomSettingsSchema,
} from './settings';

describe('settings schemas', () => {
  it('accepts the defaults and rejects out-of-range values', () => {
    expect(roomSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({}).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({ rounds: 0 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ rounds: SETTINGS_LIMITS.rounds.max + 1 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ drawTime: 19 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ maxPlayers: 1 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ language: 'xx' }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ rounds: 2.5 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ customWords: ['x'.repeat(SETTINGS_LIMITS.customWords.maxLength + 1)] }).success).toBe(false);
  });
});

describe('parseCustomWords', () => {
  it('splits on commas and newlines, trims, dedupes case-insensitively and caps the count', () => {
    expect(parseCustomWords('cat, dog\nhot   dog,CAT,, ,Dog')).toEqual(['cat', 'dog', 'hot dog']);
    expect(parseCustomWords('')).toEqual([]);
    expect(parseCustomWords('x'.repeat(SETTINGS_LIMITS.customWords.maxLength + 1))).toEqual([]);
    const many = Array.from({ length: SETTINGS_LIMITS.customWords.maxCount + 50 }, (_, i) => `w${i}`).join(',');
    expect(parseCustomWords(many)).toHaveLength(SETTINGS_LIMITS.customWords.maxCount);
  });
});

describe('applySettingsPatch', () => {
  it('merges patches and normalises custom words', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { rounds: 5, customWords: [' Dog ', 'cat', 'dog'] });
    expect(next.rounds).toBe(5);
    expect(next.customWords).toEqual(['Dog', 'cat']);
    expect(next.drawTime).toBe(DEFAULT_SETTINGS.drawTime);
    expect(DEFAULT_SETTINGS.rounds).toBe(3); // input untouched
  });

  it('turns customWordsOnly off when there are too few custom words', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { customWordsOnly: true }).customWordsOnly).toBe(false);
    const words = Array.from({ length: SETTINGS_LIMITS.customWords.minForOnly }, (_, i) => `w${i}`);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { customWordsOnly: true, customWords: words }).customWordsOnly).toBe(true);
    const enabled = applySettingsPatch(DEFAULT_SETTINGS, { customWordsOnly: true, customWords: words });
    expect(applySettingsPatch(enabled, { customWords: ['one'] }).customWordsOnly).toBe(false);
  });
});
