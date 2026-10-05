/**
 * The Spy Game's part of the wire protocol: its settings, its client messages and the
 * per-recipient view the platform embeds in `RoomState.game`. Snapshots carry everything, so
 * there are no server messages.
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

// ---------------------------------------------------------------------------
// Rules constants
// ---------------------------------------------------------------------------

/** Locations shown to everyone each round (the real one plus decoys), in one shared order. */
export const SPYGAME_CANDIDATES = 24;
/** Wrong guesses the spy may make before the round is lost. */
export const SPYGAME_GUESSES = 2;
/** How long the reveal stays up before the next round starts on its own. */
export const SPYGAME_REVEAL_SECONDS = 15;

export const SPYGAME_POINTS = {
  /** The spy names the location on their first / second guess. */
  spyFirstGuess: 4,
  spySecondGuess: 3,
  /** A passed vote against an agent. */
  wrongAccusation: 2,
  /** Every agent, whenever the agents take the round. */
  agentWin: 1,
  /** On top of agentWin for the player whose accusation caught the spy. */
  accuserBonus: 2,
} as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SPYGAME_SETTINGS_LIMITS = {
  rounds: { min: 1, max: 10 },
  roundMinutes: { min: 3, max: 15 },
  voteSeconds: { min: 15, max: 60, step: 5 },
} as const;

export const spygameSettingsSchema = z.object({
  /** Rounds per game; one spy per round. */
  rounds: z.number().int().min(SPYGAME_SETTINGS_LIMITS.rounds.min).max(SPYGAME_SETTINGS_LIMITS.rounds.max),
  /** Minutes on the round clock. */
  roundMinutes: z.number().int().min(SPYGAME_SETTINGS_LIMITS.roundMinutes.min).max(SPYGAME_SETTINGS_LIMITS.roundMinutes.max),
  /** Seconds a vote stays open before missing votes count as No. */
  voteSeconds: z.number().int().min(SPYGAME_SETTINGS_LIMITS.voteSeconds.min).max(SPYGAME_SETTINGS_LIMITS.voteSeconds.max),
});

export type SpygameSettings = z.infer<typeof spygameSettingsSchema>;

export const DEFAULT_SPYGAME_SETTINGS: SpygameSettings = { rounds: 5, roundMinutes: 8, voteSeconds: 30 };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(64);

export const spygameClientMessageSchema = z.discriminatedUnion('t', [
  /** Spy only, while playing: guess the location. */
  z.object({ t: z.literal('guess'), locationId: idSchema }),
  /** Agents only, while playing: start a vote against another round player. */
  z.object({ t: z.literal('accuse'), playerId: idSchema }),
  /** Eligible voters only, while voting. Changeable until the vote resolves. */
  z.object({ t: z.literal('vote'), yes: z.boolean() }),
  /** Host only, during the reveal: skip the rest of the reveal timer. */
  z.object({ t: z.literal('nextRound') }),
  /** Host only, during the reveal: abandon the game and take everyone back to the lobby. */
  z.object({ t: z.literal('endGame') }),
]);

export type SpygameClientMessage = z.infer<typeof spygameClientMessageSchema>;

/** The Spy Game sends nothing beyond snapshots. */
export type SpygameServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type SpygamePhase = 'playing' | 'voting' | 'reveal';

export const SPYGAME_OUTCOMES = ['spyGuessed', 'spyWrong', 'spyCaught', 'wrongAccusation', 'timeUp', 'spyLeft'] as const;
export type SpygameOutcome = (typeof SPYGAME_OUTCOMES)[number];

/** Whether the agents or the spy took the round. */
export function outcomeWinner(outcome: SpygameOutcome): 'spy' | 'agents' {
  return outcome === 'spyGuessed' || outcome === 'wrongAccusation' ? 'spy' : 'agents';
}

export type SpygameRole = 'spy' | 'agent' | 'spectator';

export type SpygamePauseReason = 'vote' | 'spyAway' | 'reveal';

/** The round clock: running towards `endsAt`, or paused with the time that is left. */
export type SpygameClock =
  | { endsAt: number; pausedRemainingMs: null; pausedReason: null; waitingForId: null }
  | {
      endsAt: null;
      pausedRemainingMs: number;
      pausedReason: SpygamePauseReason;
      /** The player everyone waits for while the spy's socket is down ('spyAway'); null otherwise. */
      waitingForId: string | null;
    };

export interface SpygamePlayerView {
  /** True once this player has started a vote this round (one accusation per player per round). */
  hasAccused: boolean;
  isAccused: boolean;
  /** Joined mid-round: watches until the next round starts. */
  isSpectator: boolean;
}

export interface SpygameVoteView {
  accuserId: string;
  accusedId: string;
  /** Votes cast so far. Who may vote is never listed: the voters are the agents, so the list would name the spy. */
  yes: number;
  no: number;
  /** Epoch ms (server clock) when missing votes count as No. */
  endsAt: number;
  /** This recipient may cast (and change) a vote: an agent in the round who is neither the accuser nor the accused. */
  canVote: boolean;
  /** This recipient's vote, null when they have not voted (or cannot). */
  myVote: boolean | null;
}

export interface SpygameRevealView {
  outcome: SpygameOutcome;
  spyId: string;
  /** The spy's name as of the round start: they may have left the room by the reveal. */
  spyName: string;
  locationId: string;
  /** Points earned this round by player id (zero entries omitted). */
  points: Record<string, number>;
  /** Epoch ms (server clock) when the next round starts on its own. */
  endsAt: number;
}

export interface SpygameView {
  phase: SpygamePhase;
  /** 1-based current round. */
  round: number;
  totalRounds: number;
  clock: SpygameClock;
  /** SPYGAME_CANDIDATES location ids; identical for every recipient. */
  candidates: string[];
  guessesLeft: number;
  /** Locations the spy already guessed wrong this round (public). */
  spyGuessed: string[];
  roundPlayers: string[];
  spectators: string[];
  players: Record<string, SpygamePlayerView>;
  vote: SpygameVoteView | null;
  reveal: SpygameRevealView | null;
  /** This recipient's role; 'spectator' for mid-round joiners and the role-less preview. */
  role: SpygameRole;
  /** The real location: agents only while the round runs, everyone during the reveal. */
  locationId: string | null;
}

export type SpygameRoomState = RoomState<SpygameView, SpygameSettings>;
