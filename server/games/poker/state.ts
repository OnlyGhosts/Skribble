/** Poker's JSON-safe game state (the module's `D`), its working context and the queries over it. */
import type { Card } from '../../../shared/platform/cards.js';
import type { PokerLastAction, PokerMove, PokerResults, PokerServerMessage, PokerSettings, PokerStreet } from '../../../shared/games/poker/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

/** A seat's part in the current hand: dealt in (`in`), folded, all in, or not dealt in at all (`out`: no chips, or arrived mid-hand). */
export type SeatStatus = 'in' | 'folded' | 'allIn' | 'out';

export interface SeatData {
  /** Chips in the stack; bets leave it and winnings come back. The platform score mirrors it. */
  chips: number;
  /** Chips bet on the current street. */
  bet: number;
  /** Chips moved to the pots on the earlier streets of this hand. */
  committed: number;
  /** The hole cards (private). */
  cards: Card[];
  status: SeatStatus;
  lastAction: PokerLastAction | null;
  /** Left the room mid-hand: the seat is folded and its chips stay in the pot until the hand ends. */
  gone: boolean;
}

export type PhaseData =
  | { kind: 'acting'; endsAt: number }
  | {
      kind: 'results';
      endsAt: number;
      /** True while the next hand waits for disconnected players (endsAt no longer fires). */
      held: boolean;
      /** While held with somebody back: when the next hand starts (the settle). */
      resumeAt: number | null;
    }
  | { kind: 'gameOver' };

export interface PokerData {
  phase: PhaseData;
  /** 1-based hand number; 0 before the first deal. */
  hand: number;
  /** The current small blind (the big blind is twice it); doubles with blindsIncreaseEvery. */
  smallBlind: number;
  /** Every participant who ever sat down, keyed by player id. */
  seats: Record<string, SeatData>;
  /** The seats dealt into this hand, in seat (join) order. */
  order: string[];
  dealerId: string | null;
  /** The join order of the last dealer, so the button moves on whoever is seated next hand. */
  dealerOrder: number | null;
  street: PokerStreet | null;
  community: Card[];
  /** Cards still to deal; the next card is the last one. */
  deck: Card[];
  /** The highest bet on the current street. */
  highest: number;
  /** The size of the last full raise this street (the big blind before any). */
  minRaise: number;
  /** Players still to act this street, in order; the first is the turn. */
  toAct: string[];
  /**
   * The highest bet each seat last answered on this street (checked, called, bet or raised to).
   * A seat may raise again only once the bet has gone up a full raise since: a short all in
   * makes those who already acted call or fold.
   */
  answered: Record<string, number>;
  /** A seat with chips left the game since the last deal: a table that drops below two stacks that way aborts. */
  stackLeft: boolean;
  /** The last completed hand, kept until the next deal. */
  results: PokerResults | null;
  /** Somebody made a move of their own this hand (not a timeout): a table nobody plays at closes after IDLE_HANDS_LIMIT hands. */
  acted: boolean;
  /** Completed hands in a row in which every move was a timeout. */
  idleHands: number;
  /** The latest move at the table (optional: rooms stored before it existed have none). */
  lastMove?: PokerMove | null;
}

export type Ctx = GameCtx<PokerSettings>;
export type Effect = GameEffect<PokerServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: PokerData;
  effects: Effect[];
}

export const MIN_PLAYERS = gameById('poker').minPlayers;
/** Hands in a row with nothing but timeouts before the game ends on its own. */
export const IDLE_HANDS_LIMIT = 3;

export function findPlayer(ctx: Pick<Ctx, 'players'>, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

export function nameOf(ctx: Pick<Ctx, 'players'>, id: string): string {
  return findPlayer(ctx, id)?.name ?? 'Someone';
}

export function bigBlind(data: PokerData): number {
  return data.smallBlind * 2;
}

/** Seats of the hand still able to act: dealt in, not folded, not all in. */
export function seatsIn(data: PokerData): string[] {
  return data.order.filter((id) => data.seats[id]?.status === 'in');
}

/** Seats of the hand still holding cards: in or all in. */
export function contenders(data: PokerData): string[] {
  return data.order.filter((id) => data.seats[id]?.status === 'in' || data.seats[id]?.status === 'allIn');
}

/** Whose turn it is, during `acting`. */
export function turnOf(data: PokerData): string | null {
  return data.phase.kind === 'acting' ? (data.toAct[0] ?? null) : null;
}

/** The hand's seats from the one after `index` around the table and back to it. */
export function ringAfter(data: PokerData, index: number): string[] {
  const n = data.order.length;
  return Array.from({ length: n }, (_, k) => data.order[(index + 1 + k) % n]);
}

/**
 * Removes a departed player's seat, and with it their place in the hand's order, so nothing reads
 * a seat that is gone. Notes when they walked away with chips.
 */
export function removeSeat(data: PokerData, id: string): void {
  const seat = data.seats[id];
  if (!seat) return;
  if (seat.chips > 0) data.stackLeft = true;
  delete data.seats[id];
  data.order = data.order.filter((x) => x !== id);
  data.toAct = data.toAct.filter((x) => x !== id);
}

/** The street has nobody left to bet against: no one to act, or the only seat able to act already matches the bet. */
export function streetIdle(data: PokerData): boolean {
  if (data.toAct.length === 0) return true;
  return seatsIn(data).length <= 1 && data.toAct.length === 1 && (data.seats[data.toAct[0]]?.bet ?? 0) >= data.highest;
}

/** Every chip in the middle: the pots so far plus the bets of the current street. */
export function potTotal(data: PokerData): number {
  return data.order.reduce((sum, id) => sum + (data.seats[id]?.bet ?? 0) + (data.seats[id]?.committed ?? 0), 0);
}

/**
 * Participants with a stack to play the next hand: seated with chips, or a newcomer who takes
 * the starting stack when the next hand starts.
 */
export function stackedPlayers(ctx: Pick<Ctx, 'players' | 'settings'>, data: PokerData): PlatformPlayer[] {
  return ctx.players.filter((p) => (data.seats[p.id]?.chips ?? ctx.settings.startingChips) > 0);
}

export function isHeld(data: PokerData): boolean {
  return data.phase.kind === 'results' && data.phase.held;
}

export function systemMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text });
}

export function snapshot(gx: Gx): void {
  gx.effects.push({ type: 'snapshot', to: 'all' });
}

export function fail(gx: Gx, playerId: string, message: string): void {
  gx.effects.push({ type: 'error', playerId, code: 'NOT_ALLOWED', message });
}

/** Moves chips in or out of a seat; the platform score follows so it always equals the chips. */
export function adjustChips(gx: Gx, playerId: string, delta: number): void {
  const seat = gx.data.seats[playerId];
  if (!seat || delta === 0) return;
  if (seat.chips + delta < 0) throw new Error(`poker: ${playerId} cannot pay ${-delta} chips`);
  seat.chips += delta;
  // A seat whose player left keeps no score; the platform no longer knows them.
  if (findPlayer(gx.ctx, playerId)) gx.effects.push({ type: 'score', playerId, delta });
}

/** Notes a seat's move: its last action this street, and the table's latest move. */
export function noteMove(gx: Gx, playerId: string, action: PokerLastAction): void {
  const { data } = gx;
  data.seats[playerId].lastAction = action;
  data.lastMove = { ...action, seq: (data.lastMove?.seq ?? 0) + 1, playerId, street: data.street ?? 'preflop' };
}

/** The next card off the deck. */
export function draw(gx: Gx): Card {
  const card = gx.data.deck.pop();
  if (!card) throw new Error('poker: the deck ran out');
  return card;
}
