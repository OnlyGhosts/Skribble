/**
 * Hangman's part of the wire protocol: its settings, its client/server messages and the
 * per-recipient view the platform embeds in `RoomState.game`. The drawing itself travels on the
 * platform's shared canvas stream (shared/platform/canvas.ts).
 */
import { z } from 'zod';
import { CANVAS_SIDE_MESSAGE_TYPES, canvasClientMessageOptions, isCanvasWelcomeExtra, type CanvasServerMessage, type CanvasWelcomeExtra } from '../../platform/canvas.js';
import type { RoomState } from '../../platform/protocol.js';
import { parseWordList } from '../../platform/words.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const HANGMAN_SETTINGS_LIMITS = {
  rounds: { min: 1, max: 5 },
  guessSeconds: { min: 10, max: 60 },
  drawSeconds: { min: 10, max: 60 },
  customWords: { maxCount: 500, maxLength: 32, minForOnly: 10 },
} as const;

export const hangmanSettingsSchema = z.object({
  /** Number of rounds; every participant is the hangman once per round. */
  rounds: z.number().int().min(HANGMAN_SETTINGS_LIMITS.rounds.min).max(HANGMAN_SETTINGS_LIMITS.rounds.max),
  /** Seconds a guesser has for their letter or word. */
  guessSeconds: z.number().int().min(HANGMAN_SETTINGS_LIMITS.guessSeconds.min).max(HANGMAN_SETTINGS_LIMITS.guessSeconds.max),
  /** Seconds the hangman has to draw a section after a wrong guess. */
  drawSeconds: z.number().int().min(HANGMAN_SETTINGS_LIMITS.drawSeconds.min).max(HANGMAN_SETTINGS_LIMITS.drawSeconds.max),
  /** Extra words supplied by the host. */
  customWords: z.array(z.string().trim().min(1).max(HANGMAN_SETTINGS_LIMITS.customWords.maxLength)).max(HANGMAN_SETTINGS_LIMITS.customWords.maxCount),
  /** Use only custom words (requires at least HANGMAN_SETTINGS_LIMITS.customWords.minForOnly of them). */
  customWordsOnly: z.boolean(),
});

export type HangmanSettings = z.infer<typeof hangmanSettingsSchema>;

export const DEFAULT_HANGMAN_SETTINGS: HangmanSettings = {
  rounds: 1,
  guessSeconds: 20,
  drawSeconds: 25,
  customWords: [],
  customWordsOnly: false,
};

export function parseHangmanCustomWords(text: string): string[] {
  return parseWordList(text, HANGMAN_SETTINGS_LIMITS.customWords);
}

/** Fixes up invariants after a patch: normalised custom words, customWordsOnly needs enough of them. */
export function normalizeHangmanSettings(s: HangmanSettings): HangmanSettings {
  const customWords = parseHangmanCustomWords(s.customWords.join('\n'));
  const customWordsOnly = s.customWordsOnly && customWords.length >= HANGMAN_SETTINGS_LIMITS.customWords.minForOnly;
  return { ...s, customWords, customWordsOnly };
}

// ---------------------------------------------------------------------------
// Rules shared by both sides
// ---------------------------------------------------------------------------

/** Wrong guesses that complete the figure. */
export const HANGMAN_MAX_WRONG = 10;
/** Seconds the hangman has to pick or type a word. */
export const HANGMAN_CHOOSE_SECONDS = 30;
/** Seconds the "turn over" summary is shown before the next hangman is up. */
export const HANGMAN_TURN_END_SECONDS = 6;
/** Words the hangman picks from (besides typing their own). */
export const HANGMAN_WORD_CHOICES = 3;
/** Letters a word or phrase may hold (letters only; spaces, hyphens and apostrophes do not count). */
export const HANGMAN_WORD_LETTERS = { min: 3, max: 24 } as const;
/** Characters a typed word may contain once trimmed. */
export const HANGMAN_WORD_MAX_CHARS = 40;

export const HANGMAN_POINTS = {
  /** Per letter revealed by a correct letter guess. */
  letter: 10,
  /** For the hangman, per wrong guess. */
  wrongGuess: 15,
  /** Solving by naming the word. */
  solveWord: 100,
  /** Solving by revealing the last letter. */
  solveLastLetter: 50,
  /** On top of either solve bonus, per remaining life. */
  perLife: 10,
  /** For the hangman when the figure is complete or no guesser is left. */
  hangmanWins: 100,
} as const;

/** The ten sections of the figure, in drawing order (section N is drawn after the Nth wrong guess). */
export const HANGMAN_SECTIONS = ['base', 'post', 'beam', 'rope', 'head', 'body', 'left arm', 'right arm', 'left leg', 'right leg'] as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const hangmanClientMessageSchema = z.discriminatedUnion('t', [
  /** Hangman only, during `choosing`: one of the offered words. */
  z.object({ t: z.literal('chooseWord'), index: z.number().int().min(0).max(9) }),
  /** Hangman only, during `choosing`: a word or phrase of their own. */
  z.object({ t: z.literal('customWord'), text: z.string().max(HANGMAN_WORD_MAX_CHARS * 2) }),
  /** The current guesser, during `guessing`: one letter. */
  z.object({ t: z.literal('letter'), letter: z.string().regex(/^[A-Za-z]$/, 'expected one letter') }),
  /** The current guesser, during `guessing`: the whole word. */
  z.object({ t: z.literal('word'), text: z.string().min(1).max(HANGMAN_WORD_MAX_CHARS * 2) }),
  /** Hangman only, during `drawing`: the section is finished early. */
  z.object({ t: z.literal('drawDone') }),
  /** Hangman only, during `drawing`: the shared canvas messages, handled by the canvas side store. */
  ...canvasClientMessageOptions,
]);

export type HangmanClientMessage = z.infer<typeof hangmanClientMessageSchema>;

/** Message types the canvas side store handles outside the pure reducer. */
export const HANGMAN_SIDE_MESSAGE_TYPES: ReadonlySet<string> = CANVAS_SIDE_MESSAGE_TYPES;

/** Hangman's server stream is the shared canvas stream. */
export type HangmanServerMessage = CanvasServerMessage;

export type HangmanWelcomeExtra = CanvasWelcomeExtra;

export const isHangmanWelcomeExtra: (x: unknown) => x is HangmanWelcomeExtra = isCanvasWelcomeExtra;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type HangmanPhase = 'choosing' | 'guessing' | 'drawing' | 'turnEnd' | 'gameOver';

export type HangmanOutcome =
  /** A guesser named the word or revealed its last letter. */
  | { kind: 'solved'; solverId: string }
  /** The figure is complete or no guesser is left in. */
  | { kind: 'hangmanWins' }
  /** The hangman left for good: the word is revealed, nobody scores. */
  | { kind: 'hangmanLeft' }
  /** Every guesser left before a single guess was made: the word is revealed, nobody scores. */
  | { kind: 'noGuessers' };

export interface HangmanPlayerView {
  /** True once this player guessed a wrong word: out until the next word. */
  out: boolean;
  /** False for late joiners who watch until the next round. */
  playing: boolean;
}

export interface HangmanView {
  phase: HangmanPhase;
  /** 1-based current round. */
  round: number;
  totalRounds: number;
  /** 1-based turn within the round. */
  turn: number;
  turnsInRound: number;
  hangmanId: string;
  /** Whose guess it is during `guessing`; null otherwise (and while no guesser is connected). */
  guesserId: string | null;
  /** Hidden letters as "_", spaces/hyphens/apostrophes kept; '' while the word is being chosen. */
  mask: string;
  /** Upper-case letters guessed so far, right and wrong, in order. */
  usedLetters: string[];
  wrongLetters: string[];
  /** Wrong guesses so far (wrong words included). */
  wrong: number;
  maxWrong: number;
  lives: number;
  /** The figure section (1-10) being drawn during `drawing`; null otherwise. */
  section: number | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while its clock is paused. */
  endsAt: number | null;
  /** True while the clock holds for a disconnected hangman (choosing, drawing) or because no guesser is connected. */
  paused: boolean;
  /** Only in the hangman's snapshot during `choosing`. */
  choices?: string[];
  /** Only in the hangman's snapshot while the word is secret; in everyone's at `turnEnd`. */
  word?: string;
  /** Set at `turnEnd`. */
  outcome: HangmanOutcome | null;
  /** Points earned this turn by player id. */
  points: Record<string, number>;
  /** Per-player turn state, keyed by player id. */
  players: Record<string, HangmanPlayerView>;
}

export type HangmanRoomState = RoomState<HangmanView, HangmanSettings>;
