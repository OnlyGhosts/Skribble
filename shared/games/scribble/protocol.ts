/**
 * Scribble's part of the wire protocol: its settings, its client/server messages and the
 * per-recipient view the platform embeds in `RoomState.game`.
 */
import { z } from 'zod';
import { CANVAS_SIDE_MESSAGE_TYPES, canvasClientMessageOptions, isCanvasWelcomeExtra, type CanvasServerMessage, type CanvasWelcomeExtra } from '../../platform/canvas.js';
import type { RoomState } from '../../platform/protocol.js';
import { parseWordList } from '../../platform/words.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Seconds each drawing turn lasts. Fixed, not a setting: change it here to change it everywhere.
 */
export const SCRIBBLE_DRAW_SECONDS = 80;

export const SCRIBBLE_SETTINGS_LIMITS = {
  rounds: { min: 1, max: 10 },
  hints: { min: 0, max: 5 },
  wordChoices: { min: 2, max: 5 },
  customWords: { maxCount: 500, maxLength: 32, minForOnly: 10 },
} as const;

export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** A room or a patch stored with the retired `drawTime` key loads and ignores it. */
export const scribbleSettingsSchema = z.object({
  /** Number of rounds; every player draws once per round. */
  rounds: z.number().int().min(SCRIBBLE_SETTINGS_LIMITS.rounds.min).max(SCRIBBLE_SETTINGS_LIMITS.rounds.max),
  /** How many letters are revealed (spread over the turn) as hints. */
  hints: z.number().int().min(SCRIBBLE_SETTINGS_LIMITS.hints.min).max(SCRIBBLE_SETTINGS_LIMITS.hints.max),
  /** How many words the drawer picks from. */
  wordChoices: z.number().int().min(SCRIBBLE_SETTINGS_LIMITS.wordChoices.min).max(SCRIBBLE_SETTINGS_LIMITS.wordChoices.max),
  language: z.enum(LANGUAGES),
  /** Extra words supplied by the host. */
  customWords: z
    .array(z.string().trim().min(1).max(SCRIBBLE_SETTINGS_LIMITS.customWords.maxLength))
    .max(SCRIBBLE_SETTINGS_LIMITS.customWords.maxCount),
  /** Use only custom words (requires at least SCRIBBLE_SETTINGS_LIMITS.customWords.minForOnly of them). */
  customWordsOnly: z.boolean(),
});

export type ScribbleSettings = z.infer<typeof scribbleSettingsSchema>;

export const DEFAULT_SCRIBBLE_SETTINGS: ScribbleSettings = {
  rounds: 3,
  hints: 2,
  wordChoices: 3,
  language: 'en',
  customWords: [],
  customWordsOnly: false,
};

/** Parses a free-text custom word list ("cat, dog, hot dog" or newline separated). Dedupes case-insensitively. */
export function parseCustomWords(text: string): string[] {
  return parseWordList(text, SCRIBBLE_SETTINGS_LIMITS.customWords);
}

/** Fixes up invariants after a patch: normalised custom words, customWordsOnly needs enough of them. */
export function normalizeScribbleSettings(s: ScribbleSettings): ScribbleSettings {
  const customWords = parseCustomWords(s.customWords.join('\n'));
  const customWordsOnly = s.customWordsOnly && customWords.length >= SCRIBBLE_SETTINGS_LIMITS.customWords.minForOnly;
  return { ...s, customWords, customWordsOnly };
}

// ---------------------------------------------------------------------------
// Drawing: the platform's shared canvas (shared/platform/canvas.ts), re-exported for Scribble's imports
// ---------------------------------------------------------------------------

export type { CanvasAction, DrawOp } from '../../platform/canvas.js';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const scribbleClientMessageSchema = z.discriminatedUnion('t', [
  /** Drawer only, during `choosing`. */
  z.object({ t: z.literal('chooseWord'), index: z.number().int().min(0).max(9) }),
  /** Drawer only, during `drawing`: the shared canvas messages, handled by the canvas side store. */
  ...canvasClientMessageOptions,
  /** Non-drawers during `drawing`: rate the drawing. Sending the same value again clears it. */
  z.object({ t: z.literal('rate'), value: z.enum(['like', 'dislike']) }),
]);

export type ScribbleClientMessage = z.infer<typeof scribbleClientMessageSchema>;

/** Message types the canvas side store handles outside the pure reducer. */
export const SCRIBBLE_SIDE_MESSAGE_TYPES: ReadonlySet<string> = CANVAS_SIDE_MESSAGE_TYPES;

/** Scribble's server stream is the shared canvas stream. */
export type ScribbleServerMessage = CanvasServerMessage;

/** What Scribble puts in `welcome.extra`. */
export type ScribbleWelcomeExtra = CanvasWelcomeExtra;

export const isScribbleWelcomeExtra: (x: unknown) => x is ScribbleWelcomeExtra = isCanvasWelcomeExtra;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type Rating = 'like' | 'dislike';
export type TurnEndReason = 'allGuessed' | 'timeUp' | 'drawerLeft' | 'noWordChosen';

export type ScribblePhase =
  | {
      kind: 'choosing';
      drawerId: string;
      /** Epoch ms (server clock) when a word is auto-picked. */
      endsAt: number;
      /** Only present in the drawer's snapshot. */
      choices?: string[];
    }
  | {
      kind: 'drawing';
      drawerId: string;
      startedAt: number;
      endsAt: number;
      /** Hidden letters as "_", spaces/hyphens kept. Letters appear as hints are revealed. */
      mask: string;
      /** Only present in the drawer's snapshot (and for players who already guessed). */
      word?: string;
      likes: number;
      dislikes: number;
      /** This recipient's own rating, if any. */
      myRating?: Rating;
    }
  | {
      kind: 'turnEnd';
      drawerId: string;
      word: string;
      reason: TurnEndReason;
      endsAt: number;
      /** Points earned this turn by player id (drawer included). */
      points: Record<string, number>;
    }
  /** The last turn is over; the platform's results hold the outcome. */
  | { kind: 'gameOver' };

export interface ScribblePlayerView {
  /** True once this player has guessed the current word (also true for the drawer). */
  guessedThisTurn: boolean;
  /** Points earned during the current turn (reset each turn). */
  turnPoints: number;
}

export interface ScribbleView {
  /** Server epoch ms the game began, stamped on its first chat lines too (0 when unknown). */
  startedAt: number;
  phase: ScribblePhase;
  /** 1-based current round. */
  round: number;
  totalRounds: number;
  /** 1-based turn within the round. */
  turn: number;
  turnsInRound: number;
  /** Per-player turn state, keyed by player id. */
  players: Record<string, ScribblePlayerView>;
}

export type ScribbleRoomState = RoomState<ScribbleView, ScribbleSettings>;
