import { describe, expect, it } from 'vitest';
import { CONTENT_MODES } from '../../platform/settings.js';
import { FALLBACK_ANSWERS, PROMPTS, promptsForContentMode, tiersForContentMode } from './prompts.js';
import { QUIPGAME_ANSWER_MAX_LENGTH, QUIPGAME_SETTINGS_LIMITS } from './protocol.js';

describe('the prompt pack', () => {
  it('holds at least 300 prompts, unique across every tier, each 1 to 120 characters', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(PROMPTS.map((p) => p.text.toLowerCase())).size).toBe(PROMPTS.length);
    for (const tier of ['clean', 'cheeky', 'unhinged'] as const) expect(PROMPTS.some((p) => p.tier === tier)).toBe(true);
    for (const p of PROMPTS) {
      expect(p.text.length).toBeGreaterThanOrEqual(1);
      expect(p.text.length).toBeLessThanOrEqual(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength);
      expect(p.text).toBe(p.text.trim());
      expect(['clean', 'cheeky', 'unhinged']).toContain(p.tier);
    }
  });

  it('has enough clean prompts for a full game of eight without repeats', () => {
    // Two regular rounds of eight prompts plus one for the final.
    expect(PROMPTS.filter((p) => p.tier === 'clean').length).toBeGreaterThanOrEqual(17);
  });

  it('ships 200 short, varied unhinged prompts', () => {
    const unhinged = PROMPTS.filter((p) => p.tier === 'unhinged').map((p) => p.text);
    expect(unhinged).toHaveLength(200);
    for (const text of unhinged) {
      expect(text.length).toBeLessThanOrEqual(90);
      expect(text).not.toContain('\u2014');
      // A fill-in prompt marks its blank the same way everywhere.
      if (text.includes('_')) expect(text).toMatch(/(^|[^_])____([^_]|$)/);
    }
    expect(unhinged.filter((t) => t.startsWith('The worst')).length).toBeLessThanOrEqual(unhinged.length / 4);
    expect(unhinged.filter((t) => t.includes('____')).length).toBeGreaterThanOrEqual(20);
  });

  it('picks the tiers by content mode: family is clean only, unhinged plays everything that was cheeky plus the unhinged tier', () => {
    expect(tiersForContentMode('family')).toEqual(['clean']);
    expect(tiersForContentMode('unhinged')).toEqual(['cheeky', 'unhinged']);
    for (const mode of CONTENT_MODES) {
      const tiers = tiersForContentMode(mode);
      const pool = promptsForContentMode(mode);
      expect(pool.length).toBe(PROMPTS.filter((p) => tiers.includes(p.tier)).length);
      for (const p of pool) expect(tiers).toContain(p.tier);
    }
    expect(promptsForContentMode('family').every((p) => p.tier === 'clean')).toBe(true);
    expect(promptsForContentMode('unhinged').some((p) => p.tier === 'clean')).toBe(false);
  });

  it('ships fallback answers that are valid answers themselves', () => {
    expect(FALLBACK_ANSWERS.length).toBeGreaterThan(0);
    for (const a of FALLBACK_ANSWERS) {
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(QUIPGAME_ANSWER_MAX_LENGTH);
    }
  });
});
