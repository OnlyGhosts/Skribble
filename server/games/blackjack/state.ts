/** Blackjack's JSON-safe game state (the module's `D`), its working context and the queries over it. */
import { drawCard, handTotal, isBust, isNatural, isPair } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackActions, BlackjackControls, BlackjackServerMessage, BlackjackSettings, Card, HandOutcome, HandStatus } from '../../../shared/games/blackjack/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

export interface HandData {
  cards: Card[];
  bet: number;
  status: HandStatus;
  doubled: boolean;
  fromSplit: boolean;
  /** Made by splitting aces: no hit, no double; only a second ace may be split again. */
  splitAces: boolean;
}

export interface SettledHand extends HandData {
  outcome: HandOutcome;
  /** Chips returned to the player: 0 on a loss, the stake on a push, the stake plus the winnings otherwise. */
  payout: number;
}

/** A settled round's table, kept on show until the next deal. */
export interface LastRoundData {
  round: number;
  order: string[];
  dealer: Card[];
  hands: Record<string, SettledHand[]>;
  /** Settled at the peek: the dealer had blackjack. */
  peeked: boolean;
  revealEndsAt: number;
}

export interface SeatData {
  /** Chips in hand; stakes leave it when bet and come back with the payout. The platform score mirrors it. */
  chips: number;
  /** The stake placed this round (the first hand's original bet); 0 until bet. */
  bet: number;
  hands: HandData[];
  /** No chips left: out of the game, watching. */
  bustedOut: boolean;
  /** Chose to sit this round's hand out while the bets were open (absent in rooms stored before it existed). */
  sittingOut?: boolean;
}

/** Betting and acting have no clock (rooms stored with one keep an `endsAt` nothing reads). */
export type PhaseData =
  | { kind: 'betting' }
  | { kind: 'acting'; playerId: string; handIndex: number }
  /** The settled table stays on show until endsAt (the dealer's reveal); then the next round's bets open. */
  | { kind: 'results'; endsAt: number }
  /** The next round waits for a player still in the game to reconnect; resumeAt is the settle once one is back. */
  | { kind: 'held'; resumeAt: number | null }
  /** The final table stays on show until endsAt, then the podium. */
  | { kind: 'ending'; endsAt: number }
  | { kind: 'gameOver' };

export interface BlackjackData {
  phase: PhaseData;
  /** 1-based current round; 0 before the first one is dealt. */
  round: number;
  /** Every participant who ever sat down, keyed by player id. */
  seats: Record<string, SeatData>;
  /** The seats in this round, in join order. */
  order: string[];
  /** The dealer's cards this round: up card, hole card, then draws. Empty from the settle to the deal. */
  dealer: Card[];
  holeHidden: boolean;
  lastRound: LastRoundData | null;
  /** The host ended the game: it ends once the hand in play settles. */
  endRequested: boolean;
}

export type Ctx = GameCtx<BlackjackSettings>;
export type Effect = GameEffect<BlackjackServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: BlackjackData;
  effects: Effect[];
}

export const MIN_PLAYERS = gameById('blackjack').minPlayers;

export function findPlayer(ctx: Pick<Ctx, 'players'>, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

/** A player's name; the host may be watching rather than playing (Skip, Deal now). */
export function nameOf(ctx: Pick<Ctx, 'players' | 'spectators'>, id: string): string {
  return findPlayer(ctx, id)?.name ?? ctx.spectators.find((p) => p.id === id)?.name ?? 'Someone';
}

/**
 * Participants still in the game, in join order: everyone seated with chips left. Every
 * participant is seated at the start; one without a seat (a room stored when newcomers were still
 * dealt in at the next round) only watches.
 */
export function activePlayers(ctx: Pick<Ctx, 'players'>, data: BlackjackData): PlatformPlayer[] {
  return ctx.players.filter((p) => data.seats[p.id] !== undefined && !data.seats[p.id].bustedOut);
}

/** Participants still in the game who are connected: the next round needs one. */
export function connectedActive(ctx: Pick<Ctx, 'players'>, data: BlackjackData): PlatformPlayer[] {
  return activePlayers(ctx, data).filter((p) => p.connected);
}

export function isConnected(ctx: Pick<Ctx, 'players'>, id: string): boolean {
  return findPlayer(ctx, id)?.connected === true;
}

/** Whether any stake is down while the bets are open. */
export function anyBetDown(data: BlackjackData): boolean {
  return data.order.some((id) => data.seats[id].bet > 0);
}

/**
 * The seats the deal waits for while the bets are open: in the round, connected, no stake down and
 * not sitting out. A disconnected seat never holds the table up.
 */
export function waitingFor(ctx: Pick<Ctx, 'players'>, data: BlackjackData): string[] {
  if (data.phase.kind !== 'betting') return [];
  return data.order.filter((id) => data.seats[id].bet === 0 && !data.seats[id].sittingOut && isConnected(ctx, id));
}

/** The hand in play, when `playerId` is acting on it. */
export function actingHand(data: BlackjackData, playerId: string): HandData | undefined {
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return undefined;
  return data.seats[playerId]?.hands[data.phase.handIndex];
}

const NO_ACTIONS: BlackjackActions = { canHit: false, canStand: false, canDouble: false, canSplit: false };

/** A pair may be split, again and again with no cap, while the seat has the chips for another stake. */
export function canSplitHand(seat: SeatData, hand: HandData): boolean {
  return hand.cards.length === 2 && isPair(hand.cards) && seat.chips >= hand.bet;
}

/** What the acting player may do with the hand in play. */
export function actionsFor(data: BlackjackData, playerId: string): BlackjackActions {
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat || hand.status !== 'acting') return { ...NO_ACTIONS };
  return {
    canHit: !hand.splitAces,
    canStand: true,
    canDouble: !hand.splitAces && hand.cards.length === 2 && seat.chips >= hand.bet,
    canSplit: canSplitHand(seat, hand),
  };
}

/** Whether `playerId` may sit this hand out: betting, in the round, chips left, no stake down, not out already. */
export function canSitOut(data: BlackjackData, playerId: string): boolean {
  const seat = data.seats[playerId];
  return data.phase.kind === 'betting' && seat !== undefined && data.order.includes(playerId) && seat.chips > 0 && seat.bet === 0 && !seat.sittingOut;
}

/**
 * The host deals and skips. When the host is the one holding the table up (connected but idle with
 * no bet down, or on their own turn) every other player gets the same control, so an idle host
 * never stalls a table that has no clocks.
 */
function hostIsWaitedOn(ctx: Pick<Ctx, 'players' | 'hostId'>, data: BlackjackData): boolean {
  if (data.phase.kind === 'betting') return waitingFor(ctx, data).includes(ctx.hostId);
  return data.phase.kind === 'acting' && data.phase.playerId === ctx.hostId;
}

/** Whether `viewerId` may deal now: during betting with a bet down, the host (or anyone, while the table waits on the host). */
export function canDealNow(ctx: Pick<Ctx, 'players' | 'hostId'>, data: BlackjackData, viewerId: string): boolean {
  if (data.phase.kind !== 'betting' || !anyBetDown(data) || viewerId === '') return false;
  return viewerId === ctx.hostId || (findPlayer(ctx, viewerId) !== undefined && hostIsWaitedOn(ctx, data));
}

/** Whether `viewerId` may stand the hand in play: someone else's turn, and the host (or anyone, on the host's own turn). */
export function canSkip(ctx: Pick<Ctx, 'players' | 'hostId'>, data: BlackjackData, viewerId: string): boolean {
  if (data.phase.kind !== 'acting' || data.phase.playerId === viewerId || viewerId === '') return false;
  return viewerId === ctx.hostId || (findPlayer(ctx, viewerId) !== undefined && hostIsWaitedOn(ctx, data));
}

/** The viewer's table controls: sitting out, Deal now and Skip. */
export function controlsFor(ctx: Pick<Ctx, 'players' | 'hostId'>, data: BlackjackData, viewerId: string): BlackjackControls {
  return {
    canSitOut: canSitOut(data, viewerId),
    canDealNow: canDealNow(ctx, data, viewerId),
    canSkip: canSkip(ctx, data, viewerId),
  };
}

export function systemMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text });
}

/** A line every client shows as a toast: an event the table does not show otherwise. */
export function noticeMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'notice', text });
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
  if (seat.chips + delta < 0) throw new Error(`blackjack: ${playerId} cannot pay ${-delta} chips`);
  seat.chips += delta;
  gx.effects.push({ type: 'score', playerId, delta });
}

/** The next card from the endless deck: drawn on its own from the 52 with the injected rng. */
export function draw(gx: Gx): Card {
  return drawCard(gx.ctx.rng);
}

/** Keys of the shoe that rooms stored before the endless deck still carry; nothing reads them. */
const LEGACY_SHOE_KEYS = ['shoe', 'shoeSize', 'reshuffled'] as const;

/** Drops a stored room's old shoe (up to hundreds of cards) so it is not carried round after round. */
export function dropLegacyShoe(data: BlackjackData): void {
  for (const key of LEGACY_SHOE_KEYS) if (key in data) Reflect.deleteProperty(data, key);
}

/** The status a freshly dealt or hit hand settles into on its own: a natural, a bust, or 21 (nothing to gain by hitting). */
export function settledStatus(hand: HandData): HandStatus | null {
  if (isNatural(hand.cards, hand.fromSplit)) return 'blackjack';
  if (isBust(hand.cards)) return 'bust';
  if (handTotal(hand.cards).total === 21) return 'stood';
  return null;
}

/** A hand coming into play that needs no decision: a natural or 21, or split aces that cannot be split again. */
export function autoStatus(seat: SeatData, hand: HandData): HandStatus | null {
  const settled = settledStatus(hand);
  if (settled) return settled;
  if (hand.splitAces && !canSplitHand(seat, hand)) return 'stood';
  return null;
}
