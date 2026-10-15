/** Blackjack's JSON-safe game state (the module's `D`), its working context and the queries over it. */
import { MAX_HANDS, freshShoe, handTotal, isBust, isNatural, isPair, shoeDecks, shuffle } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackActions, BlackjackServerMessage, BlackjackSettings, Card, HandOutcome, HandStatus } from '../../../shared/games/blackjack/protocol.js';
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
}

export type PhaseData =
  /** endsAt is null once the clock ran out with no bet at all: the table waits for the first one. */
  | { kind: 'betting'; endsAt: number | null }
  | { kind: 'acting'; playerId: string; handIndex: number; endsAt: number }
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
  /** Cards still in the shoe; the next card is the last one. */
  shoe: Card[];
  /** Cards in the shoe when it was built; absent in rooms stored before the shoe grew with the table. */
  shoeSize?: number;
  /** The shoe was rebuilt at the start of this round. */
  reshuffled: boolean;
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

export function nameOf(ctx: Pick<Ctx, 'players'>, id: string): string {
  return findPlayer(ctx, id)?.name ?? 'Someone';
}

/**
 * Participants still in the game, in join order: everyone seated with chips left, plus a
 * newcomer without a seat yet (dealt in when the next round starts).
 */
export function activePlayers(ctx: Pick<Ctx, 'players'>, data: BlackjackData): PlatformPlayer[] {
  return ctx.players.filter((p) => !data.seats[p.id]?.bustedOut);
}

/** Participants still in the game who are connected: the next round needs one. */
export function connectedActive(ctx: Pick<Ctx, 'players'>, data: BlackjackData): PlatformPlayer[] {
  return activePlayers(ctx, data).filter((p) => p.connected);
}

/** The hand in play, when `playerId` is acting on it. */
export function actingHand(data: BlackjackData, playerId: string): HandData | undefined {
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return undefined;
  return data.seats[playerId]?.hands[data.phase.handIndex];
}

const NO_ACTIONS: BlackjackActions = { canHit: false, canStand: false, canDouble: false, canSplit: false };

/** A pair may be split while the seat has fewer than MAX_HANDS hands and the chips for another stake. */
export function canSplitHand(settings: BlackjackSettings, seat: SeatData, hand: HandData): boolean {
  return settings.allowSplit && hand.cards.length === 2 && isPair(hand.cards) && seat.hands.length < MAX_HANDS && seat.chips >= hand.bet;
}

/** What the acting player may do with the hand in play. */
export function actionsFor(data: BlackjackData, settings: BlackjackSettings, playerId: string): BlackjackActions {
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat || hand.status !== 'acting') return { ...NO_ACTIONS };
  return {
    canHit: !hand.splitAces,
    canStand: true,
    canDouble: settings.allowDouble && !hand.splitAces && hand.cards.length === 2 && seat.chips >= hand.bet,
    canSplit: canSplitHand(settings, seat, hand),
  };
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
  if (seat.chips + delta < 0) throw new Error(`blackjack: ${playerId} cannot pay ${-delta} chips`);
  seat.chips += delta;
  gx.effects.push({ type: 'score', playerId, delta });
}

/** The dealer's cards and every hand on the table (a settled round's cards are back in the discards). */
export function cardsInPlay(data: BlackjackData): Card[] {
  return [...data.dealer, ...Object.values(data.seats).flatMap((seat) => seat.hands.flatMap((hand) => hand.cards))];
}

/** Cards in the shoe as it was built (rooms stored before shoeSize was kept had the setting's decks). */
export function shoeSizeOf(data: BlackjackData, settings: BlackjackSettings): number {
  return data.shoeSize ?? settings.decks * 52;
}

/** A shuffled shoe sized for `seats` seats, with its size recorded. */
export function newShoe(gx: Gx, seats: number): void {
  const decks = shoeDecks(gx.ctx.settings.decks, seats);
  gx.data.shoe = shuffle(freshShoe(decks), gx.ctx.rng);
  gx.data.shoeSize = decks * 52;
}

/**
 * A fresh shoe sized for the seats in this round, less the cards on the table (one copy each, so
 * a mid-hand rebuild never deals a card twice), shuffled with the injected rng and announced.
 */
export function rebuildShoe(gx: Gx, reason: string): void {
  const inPlay = new Map<string, number>();
  for (const card of cardsInPlay(gx.data)) inPlay.set(card.rank + card.suit, (inPlay.get(card.rank + card.suit) ?? 0) + 1);
  const decks = shoeDecks(gx.ctx.settings.decks, Math.max(1, gx.data.order.length));
  const fresh = freshShoe(decks).filter((card) => {
    const left = inPlay.get(card.rank + card.suit) ?? 0;
    if (left === 0) return true;
    inPlay.set(card.rank + card.suit, left - 1);
    return false;
  });
  gx.data.shoe = shuffle(fresh, gx.ctx.rng);
  gx.data.shoeSize = decks * 52;
  gx.data.reshuffled = true;
  systemMessage(gx, `${reason}. The shoe is reshuffled.`);
}

/** The next card from the shoe; an empty shoe is rebuilt first. */
export function draw(gx: Gx): Card {
  if (gx.data.shoe.length === 0) rebuildShoe(gx, 'The shoe ran out');
  const card = gx.data.shoe.pop();
  if (!card) throw new Error('blackjack: empty shoe after a rebuild');
  return card;
}

/** The status a freshly dealt or hit hand settles into on its own: a natural, a bust, or 21 (nothing to gain by hitting). */
export function settledStatus(hand: HandData): HandStatus | null {
  if (isNatural(hand.cards, hand.fromSplit)) return 'blackjack';
  if (isBust(hand.cards)) return 'bust';
  if (handTotal(hand.cards).total === 21) return 'stood';
  return null;
}

/** A hand coming into play that needs no decision: a natural or 21, or split aces that cannot be split again. */
export function autoStatus(settings: BlackjackSettings, seat: SeatData, hand: HandData): HandStatus | null {
  const settled = settledStatus(hand);
  if (settled) return settled;
  if (hand.splitAces && !canSplitHand(settings, seat, hand)) return 'stood';
  return null;
}
