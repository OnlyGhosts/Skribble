/**
 * Blackjack's server module: betting, dealing, the players' moves one hand at a time, the dealer
 * and the payouts as a pure reducer over BlackjackData, each settle showing its table for a fixed
 * pause before the next round's betting. Chips are the score: every chip movement is a score effect.
 */
import {
  DEFAULT_BLACKJACK_SETTINGS,
  blackjackClientMessageSchema,
  blackjackSettingsSchema,
  type BlackjackClientMessage,
  type BlackjackServerMessage,
  type BlackjackSettings,
  type BlackjackView,
} from '../../../shared/games/blackjack/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { bet, dealIfReady, dealNow, sitOut } from './betting.js';
import { nextHand } from './dealer.js';
import { double, hit, skip, split, stand, standAway } from './play.js';
import { beginRound, endGame, finishGame, resumeIfHeld, seatPlayer, seatWhileBetting, settleDue, snapshotOrResume } from './round.js';
import { findPlayer, type BlackjackData, type Ctx, type Gx } from './state.js';
import { viewFor } from './view.js';

type Result = GameResult<BlackjackData, BlackjackServerMessage>;

function start(ctx: Ctx): Result {
  // The seed phase is replaced by the first round's betting (or a hold) straight away.
  const seed: BlackjackData = {
    phase: { kind: 'betting' },
    round: 0,
    seats: {},
    order: [],
    dealer: [],
    holeHidden: true,
    lastRound: null,
    endRequested: false,
  };
  return withDraft(seed, (data, effects) => {
    const gx: Gx = { ctx, data, effects };
    for (const p of ctx.players) seatPlayer(gx, p.id);
    beginRound(gx);
  });
}

function handle(ctx: Ctx, data: BlackjackData, event: GameEvent<BlackjackClientMessage>): Result {
  if (data.phase.kind === 'gameOver') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        return;
      case 'playerJoined':
        // A newcomer takes a seat (and the starting stack) only when the next round starts, so a
        // game ending first never ranks someone who did not play; bets open with none down yet
        // seat them at once, as nothing has been played.
        if (seatWhileBetting(gx)) return;
        return snapshotOrResume(gx);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
      case 'playerReconnected':
        if (findPlayer(ctx, event.playerId)) onConnectionChange(gx, event.playerId);
        return;
      case 'tick':
        return onTick(gx);
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: BlackjackClientMessage): void {
  switch (msg.t) {
    case 'bet':
      return bet(gx, playerId, msg.amount);
    case 'hit':
      return hit(gx, playerId);
    case 'stand':
      return stand(gx, playerId);
    case 'double':
      return double(gx, playerId);
    case 'split':
      return split(gx, playerId);
    case 'sitOutHand':
      return sitOut(gx, playerId);
    case 'dealNow':
      return dealNow(gx, playerId);
    case 'skip':
      return skip(gx, playerId, msg);
    case 'endGame':
      return endGame(gx, playerId);
  }
}

/**
 * Nothing waits on a player who is away: the deal stops waiting for their bet (with no bet down
 * and nobody connected the table holds), and their hand in play stands at once. A reconnect only
 * matters to a hold; they play their next hand as usual.
 */
function onConnectionChange(gx: Gx, playerId: string): void {
  switch (gx.data.phase.kind) {
    case 'betting':
      // The platform sends the table out after a connection change anyway.
      dealIfReady(gx);
      return;
    case 'acting':
      if (!findPlayer(gx.ctx, playerId)?.connected) standAway(gx, playerId);
      return;
    case 'held':
      return resumeIfHeld(gx);
    case 'results':
    case 'ending':
    case 'gameOver':
      return;
  }
}

/** The seat is gone, hands and stake with it; whatever waited on them moves on. */
function onPlayerLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const inRound = data.order.includes(playerId);
  delete data.seats[playerId];
  data.order = data.order.filter((id) => id !== playerId);
  switch (data.phase.kind) {
    case 'betting':
      if (inRound && data.order.length === 0) {
        // Every seat in the round is gone: the round starts over for whoever is left (or the game ends).
        data.round -= 1;
        return beginRound(gx);
      }
      if (dealIfReady(gx)) return;
      return snapshotOrResume(gx);
    case 'acting':
      if (data.phase.playerId === playerId) return nextHand(gx);
      return snapshotOrResume(gx);
    case 'held':
    case 'results':
    case 'ending':
      return snapshotOrResume(gx);
    case 'gameOver':
      return;
  }
}

function onTick(gx: Gx): void {
  const { data, ctx } = gx;
  const due = nextDeadline(data);
  if (due === null || ctx.now < due) return;
  if (data.phase.kind === 'held') return settleDue(gx);
  if (data.phase.kind === 'results') return beginRound(gx);
  if (data.phase.kind === 'ending') return finishGame(gx);
}

/** Only a hold's settle and the results pauses run on a clock; the bets and the turns wait for the players. */
function nextDeadline(data: BlackjackData): number | null {
  switch (data.phase.kind) {
    case 'held':
      return data.phase.resumeAt;
    case 'results':
    case 'ending':
      return data.phase.endsAt;
    default:
      return null;
  }
}

export const blackjackModule: GameServerModule<BlackjackSettings, BlackjackData, BlackjackView, BlackjackClientMessage, BlackjackServerMessage> = {
  meta: gameById('blackjack'),
  settings: defineSettings(blackjackSettingsSchema, DEFAULT_BLACKJACK_SETTINGS),
  clientMessageSchema: blackjackClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  hostMessages: new Set(['endGame', 'dealNow', 'skip']),
};

export type { BlackjackData };
