/**
 * Quip Game's part of the wire protocol: its settings, its client messages and the per-recipient
 * view the platform embeds in `RoomState.game`. Snapshots carry everything, so there are no server
 * messages. The game's display name lives in the registry (`gameById('quipgame').name`).
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

// ---------------------------------------------------------------------------
// Rules constants
// ---------------------------------------------------------------------------

/** Rounds before the optional final: everyone writes two answers per round. */
export const QUIPGAME_REGULAR_ROUNDS = 2;
export const QUIPGAME_ANSWER_MAX_LENGTH = 80;

export const QUIPGAME_POINTS = {
  /** Points shared between the two authors of a matchup in proportion to their votes, times the round multiplier. */
  pool: 1000,
  /** On top, times the multiplier, for an answer that took every vote. */
  flawless: 250,
  /** Votes a matchup needs before a sweep counts as flawless. */
  flawlessMinVotes: 2,
  /** Final round: what a voter's first, second and third pick earn their author. */
  finalPicks: [1500, 1000, 500],
} as const;

/** Picks a final-round voter may rank at most. */
export const QUIPGAME_MAX_PICKS = QUIPGAME_POINTS.finalPicks.length;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const QUIPGAME_SETTINGS_LIMITS = {
  writeSeconds: { min: 30, max: 180, step: 10 },
  voteSeconds: { min: 10, max: 60, step: 5 },
  resultsSeconds: { min: 4, max: 20 },
  customPrompts: { maxCount: 200, maxLength: 120, minForOnly: 10 },
} as const;

/** Collapses whitespace (tabs and newlines included), strips the other control characters and trims: what every typed line goes through. */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

export const quipgameSettingsSchema = z.object({
  /** Seconds to write the round's answers. */
  writeSeconds: z.number().int().min(QUIPGAME_SETTINGS_LIMITS.writeSeconds.min).max(QUIPGAME_SETTINGS_LIMITS.writeSeconds.max),
  /** Seconds a matchup (or the final ranking) stays open. */
  voteSeconds: z.number().int().min(QUIPGAME_SETTINGS_LIMITS.voteSeconds.min).max(QUIPGAME_SETTINGS_LIMITS.voteSeconds.max),
  /** Seconds a result stays up before the next matchup starts on its own. */
  resultsSeconds: z.number().int().min(QUIPGAME_SETTINGS_LIMITS.resultsSeconds.min).max(QUIPGAME_SETTINGS_LIMITS.resultsSeconds.max),
  /** Include the 'cheeky' prompt tier. */
  cheeky: z.boolean(),
  /** Play a final round where everyone answers one prompt and ranks the answers. */
  finalRound: z.boolean(),
  /** Pick a player per matchup to read the prompt and answers out loud. */
  announcer: z.boolean(),
  /** Extra prompts supplied by the host, one per line. */
  customPrompts: z
    .array(z.string().trim().min(1).max(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength))
    .max(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxCount),
  /** Use only custom prompts (requires at least QUIPGAME_SETTINGS_LIMITS.customPrompts.minForOnly of them). */
  customPromptsOnly: z.boolean(),
});

export type QuipgameSettings = z.infer<typeof quipgameSettingsSchema>;

export const DEFAULT_QUIPGAME_SETTINGS: QuipgameSettings = {
  writeSeconds: 90,
  voteSeconds: 30,
  resultsSeconds: 8,
  cheeky: false,
  finalRound: true,
  announcer: false,
  customPrompts: [],
  customPromptsOnly: false,
};

/** Parses a textarea of custom prompts, one per line (prompts contain commas). Dedupes case-insensitively. */
export function parseCustomPrompts(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const prompt = cleanText(raw);
    if (!prompt || prompt.length > QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prompt);
    if (out.length >= QUIPGAME_SETTINGS_LIMITS.customPrompts.maxCount) break;
  }
  return out;
}

/** Fixes up invariants after a patch: normalised custom prompts, customPromptsOnly needs enough of them. */
export function normalizeQuipgameSettings(s: QuipgameSettings): QuipgameSettings {
  const customPrompts = parseCustomPrompts(s.customPrompts.join('\n'));
  const customPromptsOnly = s.customPromptsOnly && customPrompts.length >= QUIPGAME_SETTINGS_LIMITS.customPrompts.minForOnly;
  return { ...s, customPrompts, customPromptsOnly };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(64);

/** An answer as typed: cleaned up before the length rule applies, so "   " is as invalid as "". */
export const answerTextSchema = z.string().max(1000).transform(cleanText).pipe(z.string().min(1).max(QUIPGAME_ANSWER_MAX_LENGTH));

export const quipgameClientMessageSchema = z.discriminatedUnion('t', [
  /** Round players, while writing: an answer to one of their prompts. Resubmitting replaces the earlier answer. */
  z.object({ t: z.literal('answer'), promptId: idSchema, text: answerTextSchema }),
  /** Everyone but the two authors, during a matchup. Changeable until the matchup resolves. */
  z.object({ t: z.literal('vote'), choice: z.enum(['a', 'b']) }),
  /** Final round: favourite answers first, never one's own. Changeable until the ranking resolves. */
  z.object({ t: z.literal('rank'), answerIds: z.array(idSchema).min(1).max(QUIPGAME_MAX_PICKS) }),
  /** Host only, during a result: skip the rest of the result timer. */
  z.object({ t: z.literal('next') }),
]);

export type QuipgameClientMessage = z.infer<typeof quipgameClientMessageSchema>;

/** Quip Game sends nothing beyond snapshots. */
export type QuipgameServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const QUIPGAME_PHASES = ['writing', 'voting', 'result', 'finalWriting', 'finalVoting', 'finalResult'] as const;
export type QuipgamePhase = (typeof QUIPGAME_PHASES)[number];

export type QuipgameChoice = 'a' | 'b';

/** How a matchup ended: one side took it, the votes split evenly, or nobody voted. */
export const QUIPGAME_OUTCOMES = ['a', 'b', 'tie', 'noVotes'] as const;
export type QuipgameOutcome = (typeof QUIPGAME_OUTCOMES)[number];

export interface QuipgamePromptView {
  id: string;
  text: string;
}

/** A matchup while the votes are open: authors stay hidden. */
export interface QuipgameMatchupView {
  /** 0-based position in the round's matchup order. */
  index: number;
  total: number;
  prompt: string;
  a: string;
  b: string;
  /** Votes cast so far (shown live to everyone). */
  votes: number;
}

export interface QuipgameAnswerResultView {
  text: string;
  authorId: string;
  /** The author's name as of the round start: they may have left by the result. */
  authorName: string;
  votes: number;
  points: number;
  flawless: boolean;
  /** The author ran out of time: the text is a stand-in. */
  fallback: boolean;
}

export interface QuipgameMatchupResultView {
  index: number;
  total: number;
  prompt: string;
  a: QuipgameAnswerResultView;
  b: QuipgameAnswerResultView;
  outcome: QuipgameOutcome;
}

/** A final-round answer while the ranking is open: anonymous, in one shared shuffled order. */
export interface QuipgameFinalAnswerView {
  id: string;
  text: string;
}

export interface QuipgameFinalResultView {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  points: number;
  /** 1-based; tied points share a rank. */
  rank: number;
  fallback: boolean;
}

export interface QuipgameView {
  phase: QuipgamePhase;
  /** 1-based current round; the final is the last one when enabled. */
  round: number;
  totalRounds: number;
  /** Epoch ms (server clock) when the current phase ends on its own. */
  endsAt: number;
  /** Points multiplier of the current regular round (1, then 2). */
  multiplier: number;
  /** Players who write this round; everyone else spectates (and votes) until the next round. */
  roundPlayers: string[];
  spectators: string[];
  isSpectator: boolean;
  /** Writing phases: this recipient's prompts, in the order to answer them (empty for spectators). */
  myPrompts: QuipgamePromptView[];
  /** This recipient's answers so far, by prompt id. */
  myAnswers: Record<string, string>;
  /** Writing phases: "done of total" round players who have answered everything. */
  done: number;
  total: number;
  /** Writing phases: the round players who have answered everything (the player list badges). */
  finished: string[];
  /** The open matchup while voting; null otherwise. */
  matchup: QuipgameMatchupView | null;
  /** This recipient may cast (and change) a vote: seated, connected and not one of the authors. */
  canVote: boolean;
  isAuthor: boolean;
  myVote: QuipgameChoice | null;
  /** Voting phases: who has cast a vote (or a final ranking) so far. */
  voted: string[];
  /** The matchup just resolved during 'result'; null otherwise. */
  result: QuipgameMatchupResultView | null;
  /** The final's prompt during the final phases. */
  finalPrompt: string | null;
  /** Final voting: every answer, anonymous, in one shared shuffled order. */
  finalAnswers: QuipgameFinalAnswerView[];
  /** This recipient's own final answer id (disabled in the ranking UI), when they wrote one. */
  myAnswerId: string | null;
  /** How many answers this recipient may rank: min(3, answers they may pick); 0 when they cannot rank. */
  maxPicks: number;
  myRanking: string[];
  /** Final voting: rankings submitted so far (shown live). */
  ranked: number;
  /** The ranked answers with authors and points during 'finalResult'; null otherwise. */
  finalResult: QuipgameFinalResultView[] | null;
  /** The player asked to read the prompt and answers out loud (announcer setting); null when nobody is. */
  announcerId: string | null;
  isAnnouncer: boolean;
  /** The host may skip the rest of a result timer. */
  canSkip: boolean;
}

export type QuipgameRoomState = RoomState<QuipgameView, QuipgameSettings>;
