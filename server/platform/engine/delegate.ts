/** Runs the room's game module and folds its effects into the platform's state and effect list. */
import { isWireMessage, type WireMessage } from '../../../shared/platform/protocol.js';
import type { GameCtx, GameEffect, GameEvent, GameResult } from '../game.js';
import { broadcastSnapshot, fail, pushChat, snapshotTo, systemMessage, type Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { findPlayer, platformPlayers } from './players.js';
import { finishGame, resetToLobby } from './lobby.js';

export function gameCtx(cx: Cx): GameCtx<unknown> {
  return {
    now: cx.now,
    rng: cx.ctx.rng,
    newId: cx.ctx.newId,
    settings: cx.data.settings,
    players: platformPlayers(cx.data),
    hostId: cx.data.hostId,
  };
}

/** Hands an event to the running game; a no-op outside 'playing'. Returns true when the game consumed a chat line. */
export function runGame(cx: Cx, event: GameEvent<unknown>): boolean {
  if (cx.data.phase !== 'playing' || cx.data.game === null) return false;
  const game = moduleFor(cx.data.gameId);
  return applyGameResult(cx, game.handle(gameCtx(cx), cx.data.game, event)).chatHandled;
}

export interface Applied {
  chatHandled: boolean;
  snapshotted: boolean;
}

/** Stores the game's next state and executes its effects in order (snapshots are rendered where they sit). */
export function applyGameResult(cx: Cx, result: GameResult<unknown, unknown>): Applied {
  cx.data.game = result.data;
  const applied: Applied = { chatHandled: false, snapshotted: false };
  for (const effect of result.effects) {
    if (cx.data.phase === 'lobby') break; // an 'abort' ends the game; nothing after it applies
    applyEffect(cx, effect, applied);
  }
  return applied;
}

function applyEffect(cx: Cx, effect: GameEffect<unknown>, applied: Applied): void {
  switch (effect.type) {
    case 'send':
      cx.effects.push({ type: 'send', to: effect.to, msg: toWire(effect.msg) });
      return;
    case 'snapshot':
      applied.snapshotted = true;
      if (effect.to === 'all') broadcastSnapshot(cx);
      else snapshotTo(cx, effect.to);
      return;
    case 'chat': {
      const from = effect.playerId !== undefined ? { id: effect.playerId, name: effect.name ?? findPlayer(cx.data, effect.playerId)?.name ?? '' } : undefined;
      pushChat(cx, effect.kind, effect.text, effect.to, from);
      return;
    }
    case 'chatHandled':
      applied.chatHandled = true;
      return;
    case 'error':
      fail(cx, effect.playerId, effect.code, effect.message);
      return;
    case 'score': {
      const player = findPlayer(cx.data, effect.playerId);
      if (player) player.score += effect.delta;
      return;
    }
    case 'gameOver':
      if (cx.data.phase === 'playing') finishGame(cx);
      return;
    case 'abort':
      systemMessage(cx, effect.reason);
      resetToLobby(cx);
      return;
    case 'waiting':
      cx.data.waiting = effect.missing === null ? null : [...effect.missing];
      return;
    case 'side':
      cx.effects.push({ type: 'side', name: effect.name, stamp: effect.payload?.stamp ?? '' });
      return;
  }
}

/** Game server messages are JSON objects with a string `t`; anything else is a module bug. */
function toWire(msg: unknown): WireMessage {
  if (isWireMessage(msg)) return msg;
  throw new Error('game message must be an object with a string `t`');
}
