/**
 * Blackjack's part of the wire protocol: its settings, its client messages and the per-recipient
 * view the platform embeds in `RoomState.game`. Snapshots carry everything, so there are no server
 * messages. The table rules themselves (the endless deck, totals, the dealer's policy, payouts)
 * live in cards.ts.
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
} as const;

/**
 * How long a settled table stays up, on top of the dealer's reveal: before the next round's bets
 * open, and before the podium. Nothing else at the table runs on a clock: the bets and the turns
 * wait for the players.
 */
export const BLACKJACK_RESULTS_MS = 5000;

export const BLACKJACK_PAYOUTS = ['3:2', '6:5'] as const;
export type BlackjackPayout = (typeof BLACKJACK_PAYOUTS)[number];

const limited = (key: keyof typeof BLACKJACK_SETTINGS_LIMITS) => z.number().int().min(BLACKJACK_SETTINGS_LIMITS[key].min).max(BLACKJACK_SETTINGS_LIMITS[key].max);

export const blackjackSettingsSchema = z.object({
  /** Chips every player (late joiners included) starts with; the score is the chip count. */
  startingChips: limited('startingChips'),
  /** The dealer draws on a soft 17 (an ace counted as 11) instead of standing. */
  dealerHitsSoft17: z.boolean(),
  blackjackPayout: z.enum(BLACKJACK_PAYOUTS),
  allowDouble: z.boolean(),
  /** Pairs split, and re-split with no cap while the chips last; split aces take one card each; 21 after a split pays 1:1. */
  allowSplit: z.boolean(),
});

export type BlackjackSettings = z.infer<typeof blackjackSettingsSchema>;

export const DEFAULT_BLACKJACK_SETTINGS: BlackjackSettings = {
  startingChips: 1000,
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
  /** During `betting`, a seat with chips that has not bet: no cards this hand. A bet before the deal brings it back in. */
  z.object({ t: z.literal('sitOutHand') }),
  /**
   * During `betting` with at least one bet down: deals to the seats that bet; the rest sit the hand
   * out. The host's (anyone's while the table waits on the host's own bet).
   */
  z.object({ t: z.literal('dealNow') }),
  /**
   * On another player's turn: stands the hand named, if it is still the one in play (a second tap
   * never stands the next player's hand). The host's (anyone's on the host's own turn).
   */
  z.object({ t: z.literal('skip'), playerId: z.string().min(1).max(64), handIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }),
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
 * `results` keeps a settled table on show (the dealer's reveal, then BLACKJACK_RESULTS_MS), then
 * `betting` opens (the table stays on show in `lastRound` until the deal). Betting has no clock:
 * the cards go out once every connected seat with chips has bet or sat out, or when the host
 * deals. `acting` is one hand at a time, also unclocked (a disconnected player's hand stands at
 * once, and the host may skip an idle one), `held` waits for a player still in the game to
 * reconnect, `ending` keeps the final table on show for the same pause before the podium.
 */
export type BlackjackPhase = 'betting' | 'acting' | 'results' | 'held' | 'ending' | 'gameOver';

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
  /** Chose to sit this hand out during `betting` (a bet brings them back in before the deal). */
  sittingOut: boolean;
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

/** The viewer's table controls outside the hand in play. */
export interface BlackjackControls {
  /** Betting, in the round, chips left, no bet down and not sitting out already. */
  canSitOut: boolean;
  /** During betting with at least one bet down: the host, or anyone while the table waits on the host's bet. */
  canDealNow: boolean;
  /** While another player's hand is in play: the host, or anyone on the host's own turn. */
  canSkip: boolean;
}

export interface BlackjackView {
  phase: BlackjackPhase;
  /** 1-based current round (the round being bet on during `betting`); the rounds never run out. */
  round: number;
  /** The seats dealt this round, in join order: the play order. */
  order: string[];
  /** The hand in play during `acting`. */
  turn: { playerId: string; handIndex: number } | null;
  /** During `betting`: the seats the deal still waits for (connected, chips left, no bet, not sitting out). */
  waitingFor: string[];
  dealer: DealerView;
  /** Every participant, keyed by player id. */
  players: Record<string, BlackjackPlayerView>;
  /** What the viewer may do right now; all false unless it is their hand. */
  actions: BlackjackActions;
  controls: BlackjackControls;
  lastRound: LastRoundView | null;
  /** The host ended the game: it ends once the hand in play settles. */
  endRequested: boolean;
}

export type BlackjackRoomState = RoomState<BlackjackView, BlackjackSettings>;
