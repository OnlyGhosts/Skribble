/**
 * Blackjack's server module: betting, dealing, the players' moves, the dealer and the payouts as a
 * pure reducer over BlackjackData. Chips are the score: every chip movement is a score effect.
 */
import {
  DEFAULT_BLACKJACK_SETTINGS,
  blackjackClientMessageSchema,
  blackjackSettingsSchema,
  normalizeBlackjackSettings,
  type BlackjackClientMessage,
  type BlackjackServerMessage,
  type BlackjackSettings,
  type BlackjackView,
} from '../../../shared/games/blackjack/protocol.js';
import { freshShoe, shuffle } from '../../../shared/games/blackjack/cards.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { actTimedOut, double, hit, split, stand } from './play.js';
import { beginRound, bet, betTimedOut, dealIfAllBet, next, nextHand, resumeIfHeld, seatPlayer, settleDue } from './round.js';
import { findPlayer, snapshot, type BlackjackData, type Ctx, type Gx } from './state.js';
import { viewFor } from './view.js';

type Result = GameResult<BlackjackData, BlackjackServerMessage>;

function start(ctx: Ctx): Result {
  // The seed is an empty results screen, so the first round is held like any other should nobody be connected.
  const seed: BlackjackData = {
    phase: { kind: 'results', endsAt: ctx.now, held: false, resumeAt: null },
    round: 0,
    seats: {},
    order: [],
    dealer: [],
    holeHidden: true,
    shoe: [],
    reshuffled: false,
    results: [],
  };
  return withDraft(seed, (data, effects) => {
    const gx: Gx = { ctx, data, effects };
    data.shoe = shuffle(freshShoe(ctx.settings.decks), ctx.rng);
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
        // game ending first never ranks someone who did not play.
        snapshot(gx);
        return resumeIfHeld(gx);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
      case 'playerReconnected':
        // Mid-round nothing changes: a bet or a move waits for its clock. Between rounds the hold is re-evaluated.
        if (findPlayer(ctx, event.playerId)) resumeIfHeld(gx);
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
    case 'next':
      return next(gx, playerId);
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
      if (!(inRound && dealIfAllBet(gx))) snapshot(gx);
      return;
    case 'acting':
      if (data.phase.playerId === playerId) return nextHand(gx);
      return snapshot(gx);
    case 'results':
      if (data.phase.held) return resumeIfHeld(gx);
      return snapshot(gx);
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
    case 'results':
      return data.phase.held ? settleDue(gx) : beginRound(gx);
    case 'gameOver':
      return;
  }
}

function nextDeadline(data: BlackjackData): number | null {
  switch (data.phase.kind) {
    case 'betting':
    case 'acting':
      return data.phase.endsAt;
    case 'results':
      return data.phase.held ? data.phase.resumeAt : data.phase.endsAt;
    case 'gameOver':
      return null;
  }
}

export const blackjackModule: GameServerModule<BlackjackSettings, BlackjackData, BlackjackView, BlackjackClientMessage, BlackjackServerMessage> = {
  meta: gameById('blackjack'),
  settings: defineSettings(blackjackSettingsSchema, DEFAULT_BLACKJACK_SETTINGS, normalizeBlackjackSettings),
  clientMessageSchema: blackjackClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  hostMessages: new Set(['next']),
};

export type { BlackjackData };
