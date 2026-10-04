/**
 * The pure game engine: `applyAction(data, action, ctx)` computes the next RoomData and the
 * effects a driver must execute. It never mutates its input and is deterministic given `ctx`.
 */
import type { Action, ActionResult, Ctx, EngineMessage } from './actions.js';
import { chat } from './chat.js';
import type { Effect } from './effects.js';
import { rate, returnToLobby, start, updateProfile, updateSettings } from './lobby.js';
import type { Cx } from './messaging.js';
import { everyoneGuessed, findPlayer } from './players.js';
import { connectionClosed, create, expireSeat, join, kick, leave, rejoin, voteKick } from './seats.js';
import type { RoomData } from './state.js';
import { nextDue, type Deadline } from './time.js';
import { beginNextTurn, chooseTimedOut, chooseWord, endTurn, ensureEnoughPlayers, resumeHeldTurn, revealHint, systemMessageForDrawerGone } from './turns.js';

export interface ApplyResult {
  /** The input object itself when nothing changed, so drivers can skip the write. */
  data: RoomData;
  effects: Effect[];
  result: ActionResult;
}

const OK: ActionResult = { ok: true, playerId: null };

export function applyAction(data: RoomData, action: Action, ctx: Ctx): ApplyResult {
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
      return create(cx, action.name, action.avatar, action.connectionId);
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
    case 'clientMessage':
      if (findPlayer(cx.data, action.playerId)) handleMessage(cx, action.playerId, action.msg);
      return OK;
    case 'tick':
      tick(cx);
      return OK;
  }
}

function handleMessage(cx: Cx, playerId: string, msg: EngineMessage): void {
  switch (msg.t) {
    case 'updateSettings':
      return updateSettings(cx, playerId, msg.settings);
    case 'updateProfile':
      return updateProfile(cx, playerId, msg.name, msg.avatar);
    case 'start':
      return start(cx, playerId);
    case 'chooseWord':
      return chooseWord(cx, playerId, msg.index);
    case 'chat':
      return chat(cx, playerId, msg.text);
    case 'kick':
      return kick(cx, playerId, msg.playerId);
    case 'voteKick':
      return voteKick(cx, playerId, msg.playerId);
    case 'rate':
      return rate(cx, playerId, msg.value);
    case 'returnToLobby':
      return returnToLobby(cx, playerId);
  }
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
    case 'choose':
      return chooseTimedOut(cx);
    case 'hint':
      return revealHint(cx);
    case 'drawEnd':
      return endTurn(cx, 'timeUp');
    case 'turnEnd':
      return beginNextTurn(cx);
    case 'drawerGone':
      data.grace.drawerGoneAt = null;
      systemMessageForDrawerGone(cx);
      return endTurn(cx, 'drawerLeft');
    case 'lowPlayers':
      data.grace.lowPlayersAt = null;
      if (!ensureEnoughPlayers(cx)) resumeHeldTurn(cx);
      return;
    case 'allGuessed':
      data.grace.allGuessedAt = null;
      if (data.phase.kind === 'drawing' && everyoneGuessed(data)) endTurn(cx, 'allGuessed');
      return;
    case 'reconnectExpiry':
      return expireSeat(cx, due.playerId);
    case 'emptyRoom':
      data.grace.emptyRoomAt = null;
      cx.effects.push({ type: 'destroy' });
      return;
  }
}

/** Structural equality over JSON-safe values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of ka) if (!(k in rb) || !deepEqual(ra[k], rb[k])) return false;
  return true;
}
