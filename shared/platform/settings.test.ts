import { describe, expect, it } from 'vitest';
import { gameById } from './games.js';
import { CONTENT_MODES, CONTENT_MODE_INFO, ROOM_HARD_CAP, defaultPlatformSettings, platformSettingsPatchSchema, seatLimit } from './settings.js';

describe('platform settings', () => {
  it('validates patches against the platform schema', () => {
    expect(platformSettingsPatchSchema.safeParse({}).success).toBe(true);
    // The retired mid-game join switch is stripped like any other unknown key.
    expect(platformSettingsPatchSchema.safeParse({ allowMidGameJoin: false })).toEqual({ success: true, data: {} });
    expect(platformSettingsPatchSchema.safeParse({ contentMode: 'filthy' }).success).toBe(false);
    for (const mode of CONTENT_MODES) expect(platformSettingsPatchSchema.safeParse({ contentMode: mode })).toEqual({ success: true, data: { contentMode: mode } });
    // Game fields (and the retired maxPlayers) are not the platform's business: they are stripped, not rejected.
    expect(platformSettingsPatchSchema.safeParse({ rounds: 5, maxPlayers: 4 })).toEqual({ success: true, data: {} });
  });

  it('derives room defaults and a seat limit per game', () => {
    expect(defaultPlatformSettings(gameById('scribble'))).toEqual({ contentMode: 'family' });
    expect(seatLimit(gameById('scribble'))).toBe(ROOM_HARD_CAP);
    expect(seatLimit({ ...gameById('scribble'), maxPlayers: 6 })).toBe(6);
  });

  it('labels every content mode', () => {
    for (const mode of CONTENT_MODES) {
      expect(CONTENT_MODE_INFO[mode].label.length).toBeGreaterThan(0);
      expect(CONTENT_MODE_INFO[mode].blurb.length).toBeGreaterThan(0);
    }
  });
});
