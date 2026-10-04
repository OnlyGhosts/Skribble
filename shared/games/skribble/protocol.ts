/**
 * Skribble's part of the wire protocol: its settings, its client/server messages and the
 * per-recipient view the platform embeds in `RoomState.game`.
 */
import { z } from 'zod';
import type { RoomState, WelcomeMessage } from '../../platform/protocol.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SKRIBBLE_SETTINGS_LIMITS = {
  rounds: { min: 1, max: 10 },
  drawTime: { min: 20, max: 180, step: 10 },
  hints: { min: 0, max: 5 },
  wordChoices: { min: 2, max: 5 },
  customWords: { maxCount: 500, maxLength: 32, minForOnly: 10 },
} as const;

export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const skribbleSettingsSchema = z.object({
  /** Number of rounds; every player draws once per round. */
  rounds: z.number().int().min(SKRIBBLE_SETTINGS_LIMITS.rounds.min).max(SKRIBBLE_SETTINGS_LIMITS.rounds.max),
  /** Seconds each drawing turn lasts. */
  drawTime: z.number().int().min(SKRIBBLE_SETTINGS_LIMITS.drawTime.min).max(SKRIBBLE_SETTINGS_LIMITS.drawTime.max),
  /** How many letters are revealed (spread over the turn) as hints. */
  hints: z.number().int().min(SKRIBBLE_SETTINGS_LIMITS.hints.min).max(SKRIBBLE_SETTINGS_LIMITS.hints.max),
  /** How many words the drawer picks from. */
  wordChoices: z.number().int().min(SKRIBBLE_SETTINGS_LIMITS.wordChoices.min).max(SKRIBBLE_SETTINGS_LIMITS.wordChoices.max),
  language: z.enum(LANGUAGES),
  /** Extra words supplied by the host. */
  customWords: z
    .array(z.string().trim().min(1).max(SKRIBBLE_SETTINGS_LIMITS.customWords.maxLength))
    .max(SKRIBBLE_SETTINGS_LIMITS.customWords.maxCount),
  /** Use only custom words (requires at least SKRIBBLE_SETTINGS_LIMITS.customWords.minForOnly of them). */
  customWordsOnly: z.boolean(),
});

export type SkribbleSettings = z.infer<typeof skribbleSettingsSchema>;

export const DEFAULT_SKRIBBLE_SETTINGS: SkribbleSettings = {
  rounds: 3,
  drawTime: 80,
  hints: 2,
  wordChoices: 3,
  language: 'en',
  customWords: [],
  customWordsOnly: false,
};

/** Parses a free-text custom word list ("cat, dog, hot dog" or newline separated). Dedupes case-insensitively. */
export function parseCustomWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const w = raw.trim().replace(/\s+/g, ' ');
    if (!w || w.length > SKRIBBLE_SETTINGS_LIMITS.customWords.maxLength) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= SKRIBBLE_SETTINGS_LIMITS.customWords.maxCount) break;
  }
  return out;
}

/** Fixes up invariants after a patch: normalised custom words, customWordsOnly needs enough of them. */
export function normalizeSkribbleSettings(s: SkribbleSettings): SkribbleSettings {
  const customWords = parseCustomWords(s.customWords.join('\n'));
  const customWordsOnly = s.customWordsOnly && customWords.length >= SKRIBBLE_SETTINGS_LIMITS.customWords.minForOnly;
  return { ...s, customWords, customWordsOnly };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const toolSchema = z.enum(['brush', 'eraser']);
export type Tool = z.infer<typeof toolSchema>;

/**
 * Streaming drawing operations. Coordinates are logical canvas pixels
 * (0..CANVAS_WIDTH, 0..CANVAS_HEIGHT) and may be fractional. Stroke `id`s are
 * assigned by the drawer and must be unique within a turn (an incrementing counter).
 */
export const drawOpSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('start'),
    id: z.number().int().nonnegative(),
    tool: toolSchema,
    color: hexColorSchema,
    size: z.number().min(1).max(100),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  /** Append points to the stroke `id`; `pts` is flat: [x0, y0, x1, y1, ...]. */
  z.object({
    k: z.literal('move'),
    id: z.number().int().nonnegative(),
    pts: z.array(z.number().finite()).min(2).max(2000).refine((a) => a.length % 2 === 0, 'pts must be pairs'),
  }),
  z.object({ k: z.literal('end'), id: z.number().int().nonnegative() }),
  /** Flood fill at (x, y) with `color`. */
  z.object({ k: z.literal('fill'), x: z.number().finite(), y: z.number().finite(), color: hexColorSchema }),
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

/** Canvas history as kept by the server and replayed by late joiners. Undo removes the last action. */
export type CanvasAction =
  | {
      kind: 'stroke';
      id: number;
      tool: Tool;
      color: string;
      size: number;
      points: number[];
      /** Set once the drawer's 'end' op arrived; absent while the stroke may still receive points. */
      done?: boolean;
    }
  | { kind: 'fill'; x: number; y: number; color: string };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const skribbleClientMessageSchema = z.discriminatedUnion('t', [
  /** Drawer only, during `choosing`. */
  z.object({ t: z.literal('chooseWord'), index: z.number().int().min(0).max(9) }),
  /** Drawer only, during `drawing`. Ops are batched by the client (~every 30ms). Handled by the canvas side store. */
  z.object({ t: z.literal('draw'), ops: z.array(drawOpSchema).min(1).max(200) }),
  z.object({ t: z.literal('undo') }),
  z.object({ t: z.literal('clear') }),
  /** Non-drawers during `drawing`: rate the drawing. Sending the same value again clears it. */
  z.object({ t: z.literal('rate'), value: z.enum(['like', 'dislike']) }),
]);

export type SkribbleClientMessage = z.infer<typeof skribbleClientMessageSchema>;

/** Message types the canvas side store handles outside the pure reducer. */
export const SKRIBBLE_SIDE_MESSAGE_TYPES: ReadonlySet<string> = new Set(['draw', 'undo', 'clear']);

export type SkribbleServerMessage =
  | { t: 'draw'; ops: DrawOp[] }
  | { t: 'undo' }
  | { t: 'clear' }
  /** Full canvas resync (e.g. after the drawer's ops were truncated by the caps). */
  | { t: 'canvas'; actions: CanvasAction[] };

/** What Skribble puts in `welcome.extra`. */
export interface SkribbleWelcomeExtra {
  canvas: CanvasAction[];
}

export function isSkribbleWelcomeExtra(x: unknown): x is SkribbleWelcomeExtra {
  return typeof x === 'object' && x !== null && Array.isArray((x as { canvas?: unknown }).canvas);
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type Rating = 'like' | 'dislike';
export type TurnEndReason = 'allGuessed' | 'timeUp' | 'drawerLeft' | 'noWordChosen';

export type SkribblePhase =
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
  /** The last turn is over; the platform's podium holds the result. */
  | { kind: 'gameOver' };

export interface SkribblePlayerView {
  /** True once this player has guessed the current word (also true for the drawer). */
  guessedThisTurn: boolean;
  /** Points earned during the current turn (reset each turn). */
  turnPoints: number;
}

export interface SkribbleView {
  phase: SkribblePhase;
  /** 1-based current round. */
  round: number;
  totalRounds: number;
  /** 1-based turn within the round. */
  turn: number;
  turnsInRound: number;
  /** Per-player turn state, keyed by player id. */
  players: Record<string, SkribblePlayerView>;
}

export type SkribbleRoomState = RoomState<SkribbleView, SkribbleSettings>;
export type SkribbleWelcome = WelcomeMessage<SkribbleView, SkribbleSettings>;
