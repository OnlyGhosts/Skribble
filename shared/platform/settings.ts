import { z } from 'zod';
import type { GameMeta } from './games.js';

/**
 * Content mode for every game in the room, chosen by the host: family = clean for any table;
 * unhinged = adults only (the rude-but-harmless tiers and the crude ones together). Games that
 * read it (GameMeta.contentModes) pick their word lists, prompts and locations from it.
 */
export const CONTENT_MODES = ['family', 'unhinged'] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const CONTENT_MODE_INFO: Record<ContentMode, { label: string; blurb: string }> = {
  family: { label: 'Family', blurb: 'Clean content for any table.' },
  unhinged: { label: 'Unhinged', blurb: 'Adults only. Crude and filthy.' },
};

/**
 * A stored content mode read back as one that exists: rooms saved before the middle tier was
 * dropped carry 'cheeky' (or nothing at all), and both play as a family room.
 */
export function upgradeContentMode(mode: unknown): ContentMode {
  return mode === 'unhinged' ? 'unhinged' : 'family';
}

/** Hard cap on seats in any room; games with a smaller table sit the extra players out. */
export const ROOM_HARD_CAP = 24;

export const platformSettingsSchema = z.object({
  /** Let people join with the code while a game is running. */
  allowMidGameJoin: z.boolean(),
  contentMode: z.enum(CONTENT_MODES),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const platformSettingsPatchSchema = platformSettingsSchema.partial();

export function defaultPlatformSettings(_meta: GameMeta): PlatformSettings {
  return { allowMidGameJoin: true, contentMode: 'family' };
}

/** The number of players a game can seat at once; null in the registry means "as many as the room holds". */
export function seatLimit(meta: GameMeta): number {
  return meta.maxPlayers ?? ROOM_HARD_CAP;
}
