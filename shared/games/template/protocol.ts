/**
 * Click Race: the template game. Copy this file for a new game and replace the settings,
 * messages and view. Everything a game needs on the wire lives here; the platform handles rooms,
 * seats, chat, scores and the podium.
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

export const TEMPLATE_SETTINGS_LIMITS = {
  targetClicks: { min: 10, max: 100 },
  timeLimit: { min: 10, max: 120 },
} as const;

export const templateSettingsSchema = z.object({
  /** Clicks needed to win. */
  targetClicks: z.number().int().min(TEMPLATE_SETTINGS_LIMITS.targetClicks.min).max(TEMPLATE_SETTINGS_LIMITS.targetClicks.max),
  /** Seconds before the race ends on its own. */
  timeLimit: z.number().int().min(TEMPLATE_SETTINGS_LIMITS.timeLimit.min).max(TEMPLATE_SETTINGS_LIMITS.timeLimit.max),
});

export type TemplateSettings = z.infer<typeof templateSettingsSchema>;

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = { targetClicks: 30, timeLimit: 30 };

export const templateClientMessageSchema = z.discriminatedUnion('t', [z.object({ t: z.literal('click') })]);
export type TemplateClientMessage = z.infer<typeof templateClientMessageSchema>;

/** Click Race sends nothing beyond snapshots. */
export type TemplateServerMessage = never;

export interface TemplateView {
  /** Clicks so far, by player id (0 for players who joined mid-game). */
  clicks: Record<string, number>;
  /** Epoch ms (server clock) when the race ends. */
  endsAt: number;
  /** Set once somebody reached the target. */
  winnerId: string | null;
}

export type TemplateRoomState = RoomState<TemplateView, TemplateSettings>;
