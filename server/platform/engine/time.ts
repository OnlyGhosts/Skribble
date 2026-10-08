import { RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { moduleFor } from './module.js';
import type { PlatformRoomData } from './state.js';

export type Deadline =
  | { kind: 'game'; at: number }
  | { kind: 'reconnectExpiry'; at: number; playerId: string }
  | { kind: 'emptyRoom'; at: number };

/**
 * Every pending deadline, in tie-break order: the game's own deadline first, then seat expiries
 * (join order, RECONNECT_GRACE_MS after the disconnect), then the empty-room TTL. `nextDue` fires
 * equal timestamps in this order. A game holding for disconnected players schedules nothing of
 * its own, so only the seat expiries remain pending then.
 */
export function pendingDeadlines(data: PlatformRoomData): Deadline[] {
  const out: Deadline[] = [];
  const gameAt = gameDeadline(data);
  if (gameAt !== null) out.push({ kind: 'game', at: gameAt });
  for (const p of data.players) {
    if (!p.connected && p.disconnectedAt !== null) {
      out.push({ kind: 'reconnectExpiry', at: p.disconnectedAt + RECONNECT_GRACE_MS, playerId: p.id });
    }
  }
  if (data.grace.emptyRoomAt !== null) out.push({ kind: 'emptyRoom', at: data.grace.emptyRoomAt });
  return out;
}

/** The game's next deadline while it is running. */
export function gameDeadline(data: PlatformRoomData): number | null {
  if (data.phase !== 'playing' || data.game === null) return null;
  return moduleFor(data.gameId).nextDeadline(data.game);
}

/** The earliest pending deadline (first in tie-break order among equals), or null when nothing is scheduled. */
export function nextDue(data: PlatformRoomData): Deadline | null {
  let best: Deadline | null = null;
  for (const d of pendingDeadlines(data)) if (!best || d.at < best.at) best = d;
  return best;
}

/** Epoch ms at which the driver must tick next, or null when nothing is scheduled. */
export function nextDeadline(data: PlatformRoomData): number | null {
  return nextDue(data)?.at ?? null;
}
