/**
 * The pure platform engine: `applyAction(data, action, ctx)` computes the next room state and the
 * effects a driver must execute. It never mutates its input and is deterministic given `ctx`.
 * Game rules come from the room's game module (see delegate.ts).
 */
import type { PlatformRoomMessage } from '../drivers/types.js';
import type { Action, ActionResult, Ctx } from './actions.js';
import { chat } from './chat.js';
import { runGame } from './delegate.js';
import type { Effect } from './effects.js';
import { returnToLobby, start, updateProfile, updateSettings } from './lobby.js';
import { deepEqual } from '../json.js';
import { fail, type Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { findPlayer } from './players.js';
import { connectionClosed, create, expireSeat, join, kick, leave, rejoin, voteKick } from './seats.js';
import type { PlatformRoomData } from './state.js';
import { gameDeadline, nextDue, type Deadline } from './time.js';

export interface ApplyResult {
  /** The input object itself when nothing changed, so drivers can skip the write. */
  data: PlatformRoomData;
  effects: Effect[];
  result: ActionResult;
}

const OK: ActionResult = { ok: true, playerId: null };

export function applyAction(data: PlatformRoomData, action: Action, ctx: Ctx): ApplyResult {
  const cx: Cx = { data: structuredClone(data), effects: [], ctx, now: ctx.now };
  const result = dispatch(cx, action);
  if (deepEqual(cx.data, data)) return { data, effects: cx.effects, result };
  cx.data.version = data.version + 1;
  cx.data.updatedAt = ctx.now;
  return { data: cx.data, effects: cx.effects, result };
}

function dispatch(cx: Cx, action: Action): ActionResult {
  switch (action.type) {
    case 'create':
      return create(cx, action.gameId, action.name, action.avatar, action.connectionId);
    case 'join':
      return join(cx, action.name, action.avatar, action.connectionId);
    case 'rejoin':
      return rejoin(cx, action.token, action.connectionId);
    case 'connectionClosed':
      connectionClosed(cx, action.playerId, action.connectionId);
      return OK;
    case 'leave':
      leave(cx, action.playerId);
      return OK;
    case 'platformMessage':
      if (findPlayer(cx.data, action.playerId)) handlePlatformMessage(cx, action.playerId, action.msg);
      return OK;
    case 'gameMessage':
      if (findPlayer(cx.data, action.playerId)) handleGameMessage(cx, action.playerId, action.msg);
      return OK;
    case 'tick':
      tick(cx);
      return OK;
  }
}

function handlePlatformMessage(cx: Cx, playerId: string, msg: PlatformRoomMessage): void {
  switch (msg.t) {
    case 'updateSettings':
      return updateSettings(cx, playerId, msg.settings);
    case 'updateProfile':
      return updateProfile(cx, playerId, msg.name, msg.avatar);
    case 'start':
      return start(cx, playerId);
    case 'chat':
      return chat(cx, playerId, msg.text);
    case 'kick':
      return kick(cx, playerId, msg.playerId);
    case 'voteKick':
      return voteKick(cx, playerId, msg.playerId);
    case 'returnToLobby':
      return returnToLobby(cx, playerId);
  }
}

function handleGameMessage(cx: Cx, playerId: string, raw: unknown): void {
  const parsed = moduleFor(cx.data.gameId).clientMessageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    return fail(cx, playerId, 'INVALID_MESSAGE', `${issue?.message ?? 'Invalid message'}${where}`);
  }
  if (cx.data.phase !== 'playing') return fail(cx, playerId, 'NOT_ALLOWED', 'The game is not running.');
  runGame(cx, { type: 'message', playerId, msg: parsed.data });
}

/** Fires every deadline that is due, oldest first, each at the time it was due. */
function tick(cx: Cx): void {
  for (;;) {
    const due = nextDue(cx.data);
    if (!due || due.at > cx.ctx.now) return;
    cx.now = due.at;
    fire(cx, due);
  }
}

// Every handler removes or pushes back the deadline it handles, so the tick loop terminates.
function fire(cx: Cx, due: Deadline): void {
  const { data } = cx;
  switch (due.kind) {
    case 'game': {
      runGame(cx, { type: 'tick' });
      const next = gameDeadline(data);
      if (next !== null && next <= due.at) throw new Error(`${data.gameId}: tick left its deadline at ${next} unresolved`);
      return;
    }
    case 'reconnectExpiry':
      return expireSeat(cx, due.playerId);
    case 'emptyRoom':
      data.grace.emptyRoomAt = null;
      cx.effects.push({ type: 'destroy' });
      return;
  }
}
