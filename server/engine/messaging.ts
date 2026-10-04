/** The reducer's working context and the helpers that emit effects. */
import { CHAT_HISTORY_LENGTH } from '../../shared/constants';
import type { ChatKind, ChatMessage, ErrorCode, ServerMessage } from '../../shared/protocol';
import type { Ctx } from './actions';
import type { Effect } from './effects';
import { connectedPlayers, findPlayer } from './players';
import type { PhaseData, PlayerData, RoomData } from './state';
import { viewFor, welcomeFor } from './view';

export interface Cx {
  /** A private copy of the input the reducer mutates freely. */
  data: RoomData;
  effects: Effect[];
  ctx: Ctx;
  /**
   * The time game logic runs at: ctx.now, or the deadline being processed while a tick catches
   * up, so chained deadlines (turn end -> next turn) stay anchored to when they were due.
   */
  now: number;
}

const PUBLIC_CHAT_KINDS: ReadonlySet<ChatKind> = new Set(['chat', 'correct', 'system', 'hint']);

/** Delivers to one player if they are connected. */
export function sendTo(cx: Cx, playerId: string, msg: ServerMessage): void {
  const p = findPlayer(cx.data, playerId);
  if (p?.connected) cx.effects.push({ type: 'send', to: [playerId], msg });
}

export function broadcast(cx: Cx, msg: ServerMessage, except?: string): void {
  cx.effects.push({ type: 'send', to: except === undefined ? 'all' : { except: [except] }, msg });
}

/** Snapshots are rendered now, not when the driver runs the effects: later steps of the same action may change the state again. */
export function broadcastSnapshot(cx: Cx, except?: string): void {
  for (const p of connectedPlayers(cx.data)) {
    if (p.id !== except) cx.effects.push({ type: 'send', to: [p.id], msg: { t: 'room', room: viewFor(cx.data, p.id, cx.ctx.now) } });
  }
}

export function sendWelcome(cx: Cx, playerId: string): void {
  const msg = welcomeFor(cx.data, playerId, cx.ctx.now);
  if (msg) cx.effects.push({ type: 'welcome', playerId, msg });
}

export function fail(cx: Cx, playerId: string, code: ErrorCode, message: string): void {
  sendTo(cx, playerId, { t: 'error', code, message });
}

export function requireHost(cx: Cx, playerId: string): boolean {
  if (playerId === cx.data.hostId) return true;
  fail(cx, playerId, 'NOT_ALLOWED', 'Only the host can do that.');
  return false;
}

export function requirePhase(cx: Cx, playerId: string, kind: PhaseData['kind'], message: string): boolean {
  if (cx.data.phase.kind === kind) return true;
  fail(cx, playerId, 'NOT_ALLOWED', message);
  return false;
}

/**
 * Creates a chat message. Public kinds are stored for late joiners; `recipients` defaults to
 * everyone connected.
 */
export function pushChat(cx: Cx, kind: ChatKind, text: string, from?: PlayerData, recipients?: PlayerData[], except?: string): void {
  const message: ChatMessage = { id: cx.data.nextChatId++, kind, text, ts: cx.now };
  if (from) {
    message.playerId = from.id;
    message.name = from.name;
  }
  if (PUBLIC_CHAT_KINDS.has(kind)) {
    cx.data.chat.push(message);
    if (cx.data.chat.length > CHAT_HISTORY_LENGTH) cx.data.chat = cx.data.chat.slice(-CHAT_HISTORY_LENGTH);
  }
  if (recipients) {
    const ids = recipients.filter((p) => p.connected && p.id !== except).map((p) => p.id);
    if (ids.length > 0) cx.effects.push({ type: 'send', to: ids, msg: { t: 'chat', message } });
  } else {
    broadcast(cx, { t: 'chat', message }, except);
  }
}

export function systemMessage(cx: Cx, text: string, except?: string): void {
  pushChat(cx, 'system', text, undefined, undefined, except);
}

/** A message only the recipient sees; never stored in the history. */
export function sendPrivate(cx: Cx, playerId: string, kind: 'system' | 'close', text: string): void {
  const message: ChatMessage = { id: cx.data.nextChatId++, kind, text, ts: cx.now };
  sendTo(cx, playerId, { t: 'chat', message });
}
