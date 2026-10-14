/**
 * Blackjack's part of the wire protocol: its settings, its client messages and the per-recipient
 * view the platform embeds in `RoomState.game`. Snapshots carry everything, so there are no server
 * messages. The table rules themselves (totals, the dealer's policy, payouts) live in cards.ts.
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

// ---------------------------------------------------------------------------
// Cards: the shared deck (shared/platform/cards.ts), re-exported for the client components
// ---------------------------------------------------------------------------

import type { Card } from '../../platform/cards.js';

export { CARD_RANKS, CARD_SUITS } from '../../platform/cards.js';
export type { Card, CardRank, CardSuit } from '../../platform/cards.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const BLACKJACK_SETTINGS_LIMITS = {
  startingChips: { min: 100, max: 100_000 },
  minBet: { min: 1, max: 1000 },
  /** The effective floor is minBet: normalizeBlackjackSettings lifts maxBet to it. */
  maxBet: { min: 1, max: 100_000 },
  rounds: { min: 1, max: 50 },
  decks: { min: 1, max: 8 },
  betSeconds: { min: 10, max: 60 },
  actSeconds: { min: 10, max: 60 },
  resultsSeconds: { min: 4, max: 20 },
} as const;

export const BLACKJACK_PAYOUTS = ['3:2', '6:5'] as const;
export type BlackjackPayout = (typeof BLACKJACK_PAYOUTS)[number];

const limited = (key: keyof typeof BLACKJACK_SETTINGS_LIMITS) => z.number().int().min(BLACKJACK_SETTINGS_LIMITS[key].min).max(BLACKJACK_SETTINGS_LIMITS[key].max);

export const blackjackSettingsSchema = z.object({
  /** Chips every player (late joiners included) starts with; the score is the chip count. */
  startingChips: limited('startingChips'),
  minBet: limited('minBet'),
  maxBet: limited('maxBet'),
  rounds: limited('rounds'),
  /** Decks in the shoe; it is reshuffled once under a quarter of it remains. */
  decks: limited('decks'),
  betSeconds: limited('betSeconds'),
  actSeconds: limited('actSeconds'),
  resultsSeconds: limited('resultsSeconds'),
  /** The dealer draws on a soft 17 (an ace counted as 11) instead of standing. */
  dealerHitsSoft17: z.boolean(),
  blackjackPayout: z.enum(BLACKJACK_PAYOUTS),
  allowDouble: z.boolean(),
  /** One split per round; split aces get one card each; 21 after a split pays 1:1. */
  allowSplit: z.boolean(),
});

export type BlackjackSettings = z.infer<typeof blackjackSettingsSchema>;

export const DEFAULT_BLACKJACK_SETTINGS: BlackjackSettings = {
  startingChips: 1000,
  minBet: 10,
  maxBet: 500,
  rounds: 10,
  decks: 6,
  betSeconds: 20,
  actSeconds: 20,
  resultsSeconds: 8,
  dealerHitsSoft17: false,
  blackjackPayout: '3:2',
  allowDouble: true,
  allowSplit: true,
};

/** Fixes up the bet window after a patch: a minimum nobody could afford at the start is lowered, the maximum never sits below it. */
export function normalizeBlackjackSettings(s: BlackjackSettings): BlackjackSettings {
  const minBet = Math.min(s.minBet, s.startingChips);
  return { ...s, minBet, maxBet: Math.max(s.maxBet, minBet) };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const blackjackClientMessageSchema = z.discriminatedUnion('t', [
  /** During `betting`: the chips wagered this round (between minBet and the lesser of maxBet and the player's chips). */
  z.object({ t: z.literal('bet'), amount: z.number().int().min(1).max(BLACKJACK_SETTINGS_LIMITS.maxBet.max) }),
  /** The acting player, on the hand in play. */
  z.object({ t: z.literal('hit') }),
  z.object({ t: z.literal('stand') }),
  z.object({ t: z.literal('double') }),
  z.object({ t: z.literal('split') }),
  /** Host only, during `results`: on to the next round without waiting. */
  z.object({ t: z.literal('next') }),
]);

export type BlackjackClientMessage = z.infer<typeof blackjackClientMessageSchema>;

/** Blackjack sends nothing beyond snapshots. */
export type BlackjackServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type BlackjackPhase = 'betting' | 'acting' | 'results' | 'gameOver';

/** A hand's state as the round goes: dealt (`waiting`), in play, finished by the player, settled by the dealer. */
export type HandStatus = 'waiting' | 'acting' | 'stood' | 'bust' | 'blackjack' | 'won' | 'lost' | 'push';

export type HandOutcome = 'win' | 'blackjack' | 'push' | 'loss';

export interface HandView {
  cards: Card[];
  /** The best total: aces count 11 while that keeps the hand at 21 or under. */
  total: number;
  /** An ace counts as 11 in `total`. */
  soft: boolean;
  bet: number;
  status: HandStatus;
  doubled: boolean;
  fromSplit: boolean;
}

export interface DealerView {
  /** The up card only while the hole card is hidden. */
  cards: Card[];
  holeHidden: boolean;
  /** The total of the visible cards. */
  total: number;
  soft: boolean;
  /** A natural; only known once the hole card shows. */
  blackjack: boolean;
}

export interface BlackjackPlayerView {
  chips: number;
  /** Chips wagered this round (the first hand's original stake), 0 before betting. */
  bet: number;
  hands: HandView[];
  /** Dealt in this round. */
  inRound: boolean;
  /** Out of the game: fewer chips than the minimum bet. */
  bustedOut: boolean;
}

export interface HandResult {
  playerId: string;
  handIndex: number;
  outcome: HandOutcome;
  bet: number;
  /** Chips the hand returned to the player: 0 on a loss, the stake on a push, more on a win. */
  payout: number;
}

export interface BlackjackActions {
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

export interface BlackjackView {
  phase: BlackjackPhase;
  /** 1-based current round. */
  round: number;
  totalRounds: number;
  /** The seats dealt this round, in join order. */
  order: string[];
  /** The hand in play during `acting`. */
  turn: { playerId: string; handIndex: number } | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while held between rounds. */
  endsAt: number | null;
  /** True while the next round waits for disconnected players. */
  paused: boolean;
  dealer: DealerView;
  /** Every participant, keyed by player id. */
  players: Record<string, BlackjackPlayerView>;
  /** What the viewer may do right now; all false unless it is their hand. */
  actions: BlackjackActions;
  /** Settled hands of the last completed round, kept through the next betting phase. */
  results: HandResult[];
  /** Cards left in the shoe. */
  shoeRemaining: number;
  /** The shoe was reshuffled at the start of this round. */
  reshuffled: boolean;
}

export type BlackjackRoomState = RoomState<BlackjackView, BlackjackSettings>;
