/**
 * Battleships' server module: placing, shooting, dice moves, elimination and holds as a pure
 * reducer over BattleshipsData. Boards are secret state; view.ts decides who sees what.
 */
import {
  DEFAULT_BATTLESHIPS_SETTINGS,
  battleshipsClientMessageSchema,
  battleshipsSettingsSchema,
  type BattleshipsClientMessage,
  type BattleshipsServerMessage,
  type BattleshipsSettings,
  type BattleshipsView,
} from '../../../shared/games/battleships/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { announceStart, autoPlace, finishPlacing, initialData, place, placeReady, seatJoiner } from './placing.js';
import { aliveSides, connectedAliveSides, findPlayer, isShooter, sideOf, snapshot, type BattleshipsData, type Ctx, type Gx } from './state.js';
import { beginTurn, endMove, fire, fireTimedOut, memberLeft, move, resumeIfHeld, settleDue, shooterAway, skipMove } from './turns.js';
import { viewFor } from './view.js';

type Result = GameResult<BattleshipsData, BattleshipsServerMessage>;

function start(ctx: Ctx): Result {
  return withDraft(initialData(ctx), (data, effects) => announceStart({ ctx, data, effects }));
}

function handle(ctx: Ctx, data: BattleshipsData, event: GameEvent<BattleshipsClientMessage>): Result {
  if (data.phase.kind === 'gameOver') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        return;
      case 'playerJoined':
        return onPlayerJoined(gx, event.playerId);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
        if (findPlayer(ctx, event.playerId)) onPlayerDisconnected(gx, event.playerId);
        return;
      case 'playerReconnected':
        if (findPlayer(ctx, event.playerId)) resumeIfHeld(gx);
        return;
      case 'tick':
        return onTick(gx);
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: BattleshipsClientMessage): void {
  switch (msg.t) {
    case 'place':
      return place(gx, playerId, msg.ships);
    case 'placeReady':
      return placeReady(gx, playerId);
    case 'autoPlace':
      return autoPlace(gx, playerId);
    case 'fire':
      return fire(gx, playerId, msg.targetId, msg.x, msg.y);
    case 'move':
      return move(gx, playerId, msg.shipId, msg.direction);
    case 'skipMove':
      return skipMove(gx, playerId);
  }
}

function onPlayerJoined(gx: Gx, playerId: string): void {
  const player = findPlayer(gx.ctx, playerId);
  if (player) seatJoiner(gx, player);
  snapshot(gx);
  resumeIfHeld(gx);
}

/** The seat is gone: the fleet with it in solo; then whatever the departure unblocks (a placing wait, a turn, a hold, the win). */
function onPlayerLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const wasShooter = isShooter(data, playerId);
  memberLeft(gx, playerId);
  if (gx.effects.some((e) => e.type === 'abort')) return;
  if (data.phase.kind === 'placing') {
    if (aliveSides(data).every((s) => s.ready)) return finishPlacing(gx);
    return snapshot(gx);
  }
  if (aliveSides(data).length < 2 || wasShooter) return beginTurn(gx);
  if (data.phase.kind === 'held') return resumeIfHeld(gx);
  snapshot(gx);
}

/**
 * The shooter is skipped; a side left with nobody connected holds the game at once. A move
 * window is never interrupted for somebody else's drop: the slide the roll granted runs its
 * course (it is the shooter's own board), and the turn boundary after it holds.
 */
function onPlayerDisconnected(gx: Gx, playerId: string): void {
  const { ctx, data } = gx;
  if (!sideOf(data, playerId)) return;
  if (isShooter(data, playerId)) return shooterAway(gx, playerId);
  if (data.phase.kind === 'turn' && connectedAliveSides(ctx, data).length < 2) return beginTurn(gx);
  if (data.phase.kind === 'held') resumeIfHeld(gx);
}

function onTick(gx: Gx): void {
  const { ctx, data } = gx;
  const due = nextDeadline(data);
  if (due === null || ctx.now < due) return;
  switch (data.phase.kind) {
    case 'placing':
      return finishPlacing(gx);
    case 'turn':
      return fireTimedOut(gx);
    case 'moving':
      return endMove(gx);
    case 'held':
      return settleDue(gx);
    case 'gameOver':
      return;
  }
}

function nextDeadline(data: BattleshipsData): number | null {
  switch (data.phase.kind) {
    case 'placing':
    case 'turn':
    case 'moving':
      return data.phase.endsAt;
    case 'held':
      return data.phase.resumeAt;
    case 'gameOver':
      return null;
  }
}

export const battleshipsModule: GameServerModule<BattleshipsSettings, BattleshipsData, BattleshipsView, BattleshipsClientMessage, BattleshipsServerMessage> = {
  meta: gameById('battleships'),
  settings: defineSettings(battleshipsSettingsSchema, DEFAULT_BATTLESHIPS_SETTINGS),
  clientMessageSchema: battleshipsClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
};

export type { BattleshipsData };
