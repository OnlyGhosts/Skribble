import type { ServerMessage, ServerMessageOf } from '../../shared/protocol.js';
import type { RoomData } from './state.js';

/** 'all' and `except` mean the players connected once the action has been applied. */
export type Recipients = string[] | 'all' | { except: string[] };

/** Side effects the driver executes after an action; the reducer itself only computes them. */
export type Effect =
  | { type: 'send'; to: Recipients; msg: ServerMessage }
  /** The driver completes the welcome with the canvas history as it stands at this point in the effect list. */
  | { type: 'welcome'; playerId: string; msg: Omit<ServerMessageOf<'welcome'>, 'canvas'> }
  | { type: 'close'; playerId: string; code: number; reason: string }
  /** The canvas was reset (turn start, lobby reset): clear the store and tell every connected player. */
  | { type: 'canvas'; op: 'clear' }
  /** The room has been empty for its TTL: delete it. */
  | { type: 'destroy' };

export function resolveRecipients(data: RoomData, to: Recipients): string[] {
  if (Array.isArray(to)) return to;
  const excluded = to === 'all' ? [] : to.except;
  return data.players.filter((p) => p.connected && !excluded.includes(p.id)).map((p) => p.id);
}
