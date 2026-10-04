import type { WelcomeMessage } from '../../../shared/platform/protocol.js';
import type { OutboundMessage } from '../drivers/types.js';
import { resolveRecipients as resolve, type Recipients } from '../game.js';
import type { PlatformRoomData } from './state.js';

export type { Recipients };

/** Side effects the driver executes after an action; the reducer itself only computes them. */
export type Effect =
  | { type: 'send'; to: Recipients; msg: OutboundMessage }
  /** The driver completes the welcome with the game's side-store bootstrap (`extra`), if any. */
  | { type: 'welcome'; playerId: string; msg: Omit<WelcomeMessage, 'extra'> }
  | { type: 'close'; playerId: string; code: number; reason: string }
  /** Empty the room's side store and stamp it (see GameSideStore). */
  | { type: 'side'; name: 'reset'; stamp: string }
  /** The room has been empty for its TTL: delete it. */
  | { type: 'destroy' };

export function resolveRecipients(data: PlatformRoomData, to: Recipients): string[] {
  return resolve(data.players, to);
}
