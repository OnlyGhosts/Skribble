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

export type { Card, CardRank } from '../../platform/cards.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const BLACKJACK_SETTINGS_LIMITS = {
  startingChips: { min: 100, max: 100_000 },
  /** The fewest decks in the shoe; a big table gets more (see shoeDecks in cards.ts). */
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
  /** The fewest decks in the shoe; it is reshuffled once under a quarter of it (or a round's worth) remains. */
  decks: limited('decks'),
  betSeconds: limited('betSeconds'),
  actSeconds: limited('actSeconds'),
  resultsSeconds: limited('resultsSeconds'),
  /** The dealer draws on a soft 17 (an ace counted as 11) instead of standing. */
  dealerHitsSoft17: z.boolean(),
  blackjackPayout: z.enum(BLACKJACK_PAYOUTS),
  allowDouble: z.boolean(),
  /** Pairs split (and re-split) up to MAX_HANDS (4) hands a seat; split aces take one card each; 21 after a split pays 1:1. */
  allowSplit: z.boolean(),
});

export type BlackjackSettings = z.infer<typeof blackjackSettingsSchema>;

export const DEFAULT_BLACKJACK_SETTINGS: BlackjackSettings = {
  startingChips: 1000,
  decks: 6,
  betSeconds: 15,
  actSeconds: 20,
  resultsSeconds: 5,
  dealerHitsSoft17: false,
  blackjackPayout: '3:2',
  allowDouble: true,
  allowSplit: true,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const blackjackClientMessageSchema = z.discriminatedUnion('t', [
  /** During `betting`: the chips wagered this round, any whole number from 1 up to the player's whole stack. */
  z.object({ t: z.literal('bet'), amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
  /** The acting player, on the hand in play. */
  z.object({ t: z.literal('hit') }),
  z.object({ t: z.literal('stand') }),
  z.object({ t: z.literal('double') }),
  z.object({ t: z.literal('split') }),
  /** Host only: ends the game once the hand in play settles (at once between hands); the podium ranks the chips. */
  z.object({ t: z.literal('endGame') }),
]);

export type BlackjackClientMessage = z.infer<typeof blackjackClientMessageSchema>;

/** Blackjack sends nothing beyond snapshots. */
export type BlackjackServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * `betting` opens straight after the last round settled (its table stays on show in `lastRound`;
 * once its clock ran out with no bet at all it waits, unclocked, for the first one),
 * `acting` is one hand at a time, `held` waits for a player still in the game to reconnect,
 * `ending` keeps the final table on show before the podium.
 */
export type BlackjackPhase = 'betting' | 'acting' | 'held' | 'ending' | 'gameOver';

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
  /** Made by splitting aces: one card only (a second ace may be split again). */
  splitAces: boolean;
}

export interface SettledHandView extends HandView {
  outcome: HandOutcome;
  /** Chips the hand returned to the player: 0 on a loss, the stake on a push, more on a win. */
  payout: number;
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
  /** This round's hands, left to right (split hands included); empty between the settle and the deal. */
  hands: HandView[];
  /** Dealt in this round. */
  inRound: boolean;
  /** Out of the game: no chips left. */
  bustedOut: boolean;
}

/** The last settled round's table, on show from the settle until the next deal replaces it. */
export interface LastRoundView {
  round: number;
  /** The seats that were dealt, in play order. */
  order: string[];
  /** Every card the dealer ended with, the hole card shown. */
  dealer: DealerView;
  /** Settled hands by player id, left to right (players who left since are dropped). */
  hands: Record<string, SettledHandView[]>;
  /** The dealer had blackjack at the peek: the round settled straight after the deal. */
  peeked: boolean;
  /** Epoch ms (server clock) by which the hole card and the dealer's draws have had time to show. */
  revealEndsAt: number;
}

export interface BlackjackActions {
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

export interface BlackjackView {
  phase: BlackjackPhase;
  /** 1-based current round (the round being bet on during `betting`); the rounds never run out. */
  round: number;
  /** The seats dealt this round, in join order: the play order. */
  order: string[];
  /** The hand in play during `acting`. */
  turn: { playerId: string; handIndex: number } | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while held, at the end and while the table waits for a first bet. */
  endsAt: number | null;
  dealer: DealerView;
  /** Every participant, keyed by player id. */
  players: Record<string, BlackjackPlayerView>;
  /** What the viewer may do right now; all false unless it is their hand. */
  actions: BlackjackActions;
  lastRound: LastRoundView | null;
  /** The host ended the game: it ends once the hand in play settles. */
  endRequested: boolean;
  /** Cards left in the shoe. */
  shoeRemaining: number;
  /** Cards in the shoe when it was last built: more decks than the setting at a big table. */
  shoeSize: number;
  /** The shoe was reshuffled at the start of this round. */
  reshuffled: boolean;
}

export type BlackjackRoomState = RoomState<BlackjackView, BlackjackSettings>;
