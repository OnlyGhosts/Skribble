/** Blackjack's JSON-safe game state (the module's `D`), its working context and the queries over it. */
import { freshShoe, handTotal, isBust, isNatural, isPair, shuffle } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackActions, BlackjackServerMessage, BlackjackSettings, Card, HandResult, HandStatus } from '../../../shared/games/blackjack/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

export interface HandData {
  cards: Card[];
  bet: number;
  status: HandStatus;
  doubled: boolean;
  fromSplit: boolean;
}

export interface SeatData {
  /** Chips in hand; stakes leave it when bet and come back with the payout. The platform score mirrors it. */
  chips: number;
  /** The stake placed this round (the first hand's original bet); 0 until bet. */
  bet: number;
  hands: HandData[];
  /** Fewer chips than the minimum bet: out of the game, watching. */
  bustedOut: boolean;
}

export type PhaseData =
  | { kind: 'betting'; endsAt: number }
  | { kind: 'acting'; playerId: string; handIndex: number; endsAt: number }
  | {
      kind: 'results';
      endsAt: number;
      /** True while the next round waits for disconnected players (endsAt no longer fires). */
      held: boolean;
      /** While held with somebody back: when the next round starts (the settle). */
      resumeAt: number | null;
    }
  | { kind: 'gameOver' };

export interface BlackjackData {
  phase: PhaseData;
  /** 1-based current round; 0 before the first one is dealt. */
  round: number;
  /** Every participant who ever sat down, keyed by player id. */
  seats: Record<string, SeatData>;
  /** The seats in this round, in join order. */
  order: string[];
  /** The dealer's cards: up card, hole card, then draws. */
  dealer: Card[];
  holeHidden: boolean;
  /** Cards still in the shoe; the next card is the last one. */
  shoe: Card[];
  /** The shoe was rebuilt at the start of this round. */
  reshuffled: boolean;
  /** The settled hands of the last completed round. */
  results: HandResult[];
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
 * Participants still in the game, in join order: everyone seated with chips for at least the
 * minimum bet, plus a newcomer without a seat yet (dealt in when the next round starts).
 */
export function activePlayers(ctx: Pick<Ctx, 'players'>, data: BlackjackData): PlatformPlayer[] {
  return ctx.players.filter((p) => !data.seats[p.id]?.bustedOut);
}

export function isHeld(data: BlackjackData): boolean {
  return data.phase.kind === 'results' && data.phase.held;
}

/** The hand in play, when `playerId` is acting on it. */
export function actingHand(data: BlackjackData, playerId: string): HandData | undefined {
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return undefined;
  return data.seats[playerId]?.hands[data.phase.handIndex];
}

/** What the acting player may do with the hand in play. */
export function actionsFor(data: BlackjackData, settings: BlackjackSettings, playerId: string): BlackjackActions {
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat || hand.status !== 'acting') return { canHit: false, canStand: false, canDouble: false, canSplit: false };
  const twoCards = hand.cards.length === 2;
  const affordable = seat.chips >= hand.bet;
  return {
    canHit: true,
    canStand: true,
    canDouble: settings.allowDouble && twoCards && affordable,
    canSplit: settings.allowSplit && twoCards && !hand.fromSplit && seat.hands.length === 1 && isPair(hand.cards) && affordable,
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

/** The dealer's cards and every hand on the table. */
export function cardsInPlay(data: BlackjackData): Card[] {
  return [...data.dealer, ...Object.values(data.seats).flatMap((seat) => seat.hands.flatMap((hand) => hand.cards))];
}

/**
 * A fresh shoe less the cards on the table (one copy each, so a mid-hand rebuild never deals a
 * card twice), shuffled with the injected rng and announced.
 */
export function rebuildShoe(gx: Gx, reason: string): void {
  const inPlay = new Map<string, number>();
  for (const card of cardsInPlay(gx.data)) inPlay.set(card.rank + card.suit, (inPlay.get(card.rank + card.suit) ?? 0) + 1);
  const fresh = freshShoe(gx.ctx.settings.decks).filter((card) => {
    const left = inPlay.get(card.rank + card.suit) ?? 0;
    if (left === 0) return true;
    inPlay.set(card.rank + card.suit, left - 1);
    return false;
  });
  gx.data.shoe = shuffle(fresh, gx.ctx.rng);
  gx.data.reshuffled = true;
  systemMessage(gx, `${reason} — the shoe is reshuffled.`);
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
