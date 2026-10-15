/**
 * Blackjack's server module: betting, dealing, the players' moves one hand at a time, the dealer
 * and the payouts as a pure reducer over BlackjackData, each settle going straight into the next
 * round's betting. Chips are the score: every chip movement is a score effect.
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
import { bet, betTimedOut, dealIfAllBet } from './betting.js';
import { nextHand } from './dealer.js';
import { actTimedOut, double, hit, split, stand } from './play.js';
import { beginRound, endGame, finishGame, onConnectionChange, seatPlayer, seatWhileWaiting, settleDue, snapshotOrResume, waitingForFirstBet } from './round.js';
import { findPlayer, newShoe, type BlackjackData, type Ctx, type Gx } from './state.js';
import { viewFor } from './view.js';

type Result = GameResult<BlackjackData, BlackjackServerMessage>;

function start(ctx: Ctx): Result {
  // The seed phase is replaced by the first round's betting (or a hold) straight away.
  const seed: BlackjackData = {
    phase: { kind: 'betting', endsAt: ctx.now },
    round: 0,
    seats: {},
    order: [],
    dealer: [],
    holeHidden: true,
    shoe: [],
    reshuffled: false,
    lastRound: null,
    endRequested: false,
  };
  return withDraft(seed, (data, effects) => {
    const gx: Gx = { ctx, data, effects };
    newShoe(gx, ctx.players.length);
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
        // game ending first never ranks someone who did not play; a table waiting for its first
        // bet seats them at once, as nothing has been dealt.
        if (seatWhileWaiting(gx)) return;
        return snapshotOrResume(gx);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
      case 'playerReconnected':
        // Mid-round nothing changes: a bet or a move waits for its clock. Between rounds the hold is re-evaluated.
        if (findPlayer(ctx, event.playerId)) onConnectionChange(gx);
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
    case 'endGame':
      return endGame(gx, playerId);
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
      if (inRound && dealIfAllBet(gx)) return;
      if (waitingForFirstBet(gx)) {
        // A table waiting for a first bet that nobody is left to place starts the round over (or ends).
        if (data.order.length > 0) return onConnectionChange(gx, true);
        data.round -= 1;
        return beginRound(gx);
      }
      return snapshotOrResume(gx);
    case 'acting':
      if (data.phase.playerId === playerId) return nextHand(gx);
      return snapshotOrResume(gx);
    case 'held':
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
  switch (data.phase.kind) {
    case 'betting':
      return betTimedOut(gx);
    case 'acting':
      return actTimedOut(gx);
    case 'held':
      return settleDue(gx);
    case 'ending':
      return finishGame(gx);
    case 'gameOver':
      return;
  }
}

function nextDeadline(data: BlackjackData): number | null {
  switch (data.phase.kind) {
    case 'betting':
    case 'acting':
    case 'ending':
      return data.phase.endsAt;
    case 'held':
      return data.phase.resumeAt;
    case 'gameOver':
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
  hostMessages: new Set(['endGame']),
};

export type { BlackjackData };
