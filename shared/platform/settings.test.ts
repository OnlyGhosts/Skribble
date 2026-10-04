import { describe, expect, it } from 'vitest';
import { gameById } from './games.js';
import { PLATFORM_SETTINGS_LIMITS, clampMaxPlayers, defaultPlatformSettings, platformSettingsPatchSchema } from './settings.js';

describe('platform settings', () => {
  it('validates patches against the global bounds', () => {
    expect(platformSettingsPatchSchema.safeParse({}).success).toBe(true);
    expect(platformSettingsPatchSchema.safeParse({ maxPlayers: 0 }).success).toBe(false);
    expect(platformSettingsPatchSchema.safeParse({ maxPlayers: PLATFORM_SETTINGS_LIMITS.maxPlayers.max + 1 }).success).toBe(false);
    expect(platformSettingsPatchSchema.safeParse({ maxPlayers: 2.5 }).success).toBe(false);
    expect(platformSettingsPatchSchema.safeParse({ allowMidGameJoin: 'yes' }).success).toBe(false);
    // Game fields are not the platform's business: they are stripped, not rejected.
    expect(platformSettingsPatchSchema.safeParse({ rounds: 5 })).toEqual({ success: true, data: {} });
  });

  it('derives room defaults and clamps maxPlayers to the game and the people seated', () => {
    const skribble = gameById('skribble');
    expect(defaultPlatformSettings(skribble)).toEqual({ maxPlayers: 12, allowMidGameJoin: true });
    expect(clampMaxPlayers(50, skribble, 0)).toBe(skribble.maxPlayers);
    expect(clampMaxPlayers(1, skribble, 0)).toBe(skribble.minPlayers);
    expect(clampMaxPlayers(2, skribble, 3)).toBe(3);
    expect(clampMaxPlayers(8, skribble, 3)).toBe(8);
  });
});
