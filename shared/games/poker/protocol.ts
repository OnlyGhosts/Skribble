/**
 * Poker's part of the wire protocol: its settings, its client messages and the per-recipient
 * view the platform embeds in `RoomState.game`. Snapshots carry everything, so there are no
 * server messages. The hand rankings live in hands.ts; the deck is the shared one.
 */
import { z } from 'zod';
import type { Card } from '../../platform/cards.js';
import type { RoomState } from '../../platform/protocol.js';
import type { HandCategory } from './hands.js';

export type { Card } from '../../platform/cards.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const POKER_SETTINGS_LIMITS = {
  startingChips: { min: 100, max: 100_000 },
  /** The big blind is always twice the small blind. */
  smallBlind: { min: 1, max: 1000 },
  /** Hands between blind increases; 0 never raises them. */
  blindsIncreaseEvery: { min: 0, max: 50 },
  /** Hands in the game; 0 plays until one player holds every chip. */
  hands: { min: 0, max: 100 },
  actSeconds: { min: 10, max: 60 },
  resultsSeconds: { min: 4, max: 20 },
} as const;

const limited = (key: keyof typeof POKER_SETTINGS_LIMITS) => z.number().int().min(POKER_SETTINGS_LIMITS[key].min).max(POKER_SETTINGS_LIMITS[key].max);

export const pokerSettingsSchema = z.object({
  /** Chips every player (late joiners included) starts with; the score is the chip count. */
  startingChips: limited('startingChips'),
  smallBlind: limited('smallBlind'),
  /** Every this many hands both blinds double; 0 keeps them fixed. */
  blindsIncreaseEvery: limited('blindsIncreaseEvery'),
  /** Hands to play; 0 plays until one player has all the chips. */
  hands: limited('hands'),
  actSeconds: limited('actSeconds'),
  resultsSeconds: limited('resultsSeconds'),
});

export type PokerSettings = z.infer<typeof pokerSettingsSchema>;

export const DEFAULT_POKER_SETTINGS: PokerSettings = {
  startingChips: 1000,
  smallBlind: 5,
  blindsIncreaseEvery: 0,
  hands: 0,
  actSeconds: 25,
  resultsSeconds: 8,
};

/** Keeps the big blind affordable from the starting stack: nobody should be all in from the first blind. */
export function normalizePokerSettings(s: PokerSettings): PokerSettings {
  return { ...s, smallBlind: Math.max(1, Math.min(s.smallBlind, Math.floor(s.startingChips / 2))) };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const pokerClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('fold') }),
  z.object({ t: z.literal('check') }),
  z.object({ t: z.literal('call') }),
  /** Opens the betting on a street with no bet yet: `amount` chips (at least the big blind, or the whole stack). */
  z.object({ t: z.literal('bet'), amount: z.number().int().min(1).max(POKER_SETTINGS_LIMITS.startingChips.max * 24) }),
  /** Raises the street's bet to `to` in total (at least the last raise above the current bet, or the whole stack). */
  z.object({ t: z.literal('raise'), to: z.number().int().min(1).max(POKER_SETTINGS_LIMITS.startingChips.max * 24) }),
  z.object({ t: z.literal('allIn') }),
  /** Host only, during `results`: the next hand without waiting. */
  z.object({ t: z.literal('next') }),
  /** Host only: ends the game now; a hand in progress is void and every stake goes back. */
  z.object({ t: z.literal('endGame') }),
]);

export type PokerClientMessage = z.infer<typeof pokerClientMessageSchema>;

/** Poker sends nothing beyond snapshots. */
export type PokerServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type PokerPhase = 'acting' | 'results' | 'gameOver';
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';

/** A seat's part in the hand: not dealt in (`out`: busted or arrived mid-hand), in it and waiting, in it and acting, folded, or all in. */
export type PokerSeatStatus = 'waiting' | 'acting' | 'folded' | 'allIn' | 'out';

export type PokerActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'smallBlind' | 'bigBlind';

export interface PokerLastAction {
  kind: PokerActionKind;
  /** Chips the action put in the middle this street (the total bet after it for bet / raise / call / blinds). */
  amount: number;
}

/** The latest move at the table, kept across the street's close so the table can still show it. */
export interface PokerMove extends PokerLastAction {
  /** Counts the moves of the game: two equal moves in a row still differ. */
  seq: number;
  playerId: string;
  street: PokerStreet;
}

export interface PokerPlayerView {
  chips: number;
  /** Chips bet on the current street, 0 between streets. */
  bet: number;
  /** Chips committed to the pots this hand, the current street included. */
  committed: number;
  status: PokerSeatStatus;
  isDealer: boolean;
  isTurn: boolean;
  lastAction: PokerLastAction | null;
  /** No chips left: watching until the game ends. */
  busted: boolean;
}

export interface PokerPotView {
  amount: number;
  /** Players who can win it (folded players never can). */
  playerIds: string[];
}

export interface PokerActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips a call costs (capped by the stack: a short call is an all-in). */
  callAmount: number;
  /** A bet opens the betting (no bet on the street yet). */
  canBet: boolean;
  minBet: number;
  maxBet: number;
  canRaise: boolean;
  /** The smallest and largest totals a raise may go to. */
  minRaiseTo: number;
  maxRaiseTo: number;
  canAllIn: boolean;
}

export interface PokerRevealedHand {
  cards: Card[];
  category: HandCategory;
  name: string;
  /** The five cards that make the hand. */
  best: Card[];
}

export interface PokerPotResult {
  amount: number;
  /** Who shared it, with the chips each took (odd chips go to the first winner left of the dealer). */
  winners: Array<{ playerId: string; amount: number }>;
  /** The winning hand's name; null when the pot was uncontested. */
  handName: string | null;
}

export interface PokerResults {
  pots: PokerPotResult[];
  /** Contenders' hole cards and hands at a showdown; empty when everyone else folded. */
  revealed: Record<string, PokerRevealedHand>;
  /** The hand ended with everyone but one player folded: no cards shown. */
  uncontested: boolean;
  /** Net chips per player this hand (winnings minus what they put in). */
  net: Record<string, number>;
}

export interface PokerView {
  phase: PokerPhase;
  /** The street being bet, or the one the hand ended on; null before the first deal. */
  street: PokerStreet | null;
  /** 1-based hand number; 0 before the first deal. */
  hand: number;
  /** 0 when the game runs until one player has every chip. */
  totalHands: number;
  blinds: { small: number; big: number };
  dealerId: string | null;
  community: Card[];
  /** Every chip in the middle: the pots plus the bets of the current street. */
  pot: number;
  /** The main pot first, then the side pots, from the chips committed so far. */
  pots: PokerPotView[];
  /** The seats dealt into this hand, in seat order. */
  order: string[];
  /** Whose turn it is during `acting`. */
  turn: string | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while held between hands. */
  endsAt: number | null;
  /** True while the next hand waits for disconnected players. */
  paused: boolean;
  /** Every participant, keyed by player id. */
  players: Record<string, PokerPlayerView>;
  /** The viewer's own hole cards; empty for everyone else and for spectators. */
  myCards: Card[];
  /** What the viewer may do right now; all false unless it is their turn. */
  actions: PokerActions;
  /** The last completed hand, shown during `results` (and kept until the next deal). */
  results: PokerResults | null;
  /** The latest move anyone made (a blind, a check, a call...), null before the first. */
  lastMove: PokerMove | null;
}

export type PokerRoomState = RoomState<PokerView, PokerSettings>;
