import { RECONNECT_GRACE_MS } from '../../shared/constants';
import type { RoomData } from './state';

export type Deadline =
  | { kind: 'choose'; at: number }
  | { kind: 'hint'; at: number }
  | { kind: 'drawEnd'; at: number }
  | { kind: 'turnEnd'; at: number }
  | { kind: 'drawerGone'; at: number }
  | { kind: 'lowPlayers'; at: number }
  | { kind: 'allGuessed'; at: number }
  | { kind: 'reconnectExpiry'; at: number; playerId: string }
  | { kind: 'emptyRoom'; at: number };

/**
 * Every pending deadline, in tie-break order: the phase's own deadlines first, then the grace
 * periods, then seat expiries (join order), then the empty-room TTL. `nextDue` fires equal
 * timestamps in this order.
 */
export function pendingDeadlines(data: RoomData): Deadline[] {
  const out: Deadline[] = [];
  const { phase, turn, grace } = data;
  if (phase.kind === 'choosing') out.push({ kind: 'choose', at: phase.endsAt });
  if (phase.kind === 'drawing' && turn) {
    const nextHint = turn.revealAt[turn.revealed.length];
    if (nextHint !== undefined) out.push({ kind: 'hint', at: nextHint });
    out.push({ kind: 'drawEnd', at: turn.endsAt });
  }
  if (phase.kind === 'turnEnd' && !phase.held) out.push({ kind: 'turnEnd', at: phase.endsAt });
  if (grace.drawerGoneAt !== null) out.push({ kind: 'drawerGone', at: grace.drawerGoneAt });
  if (grace.lowPlayersAt !== null) out.push({ kind: 'lowPlayers', at: grace.lowPlayersAt });
  if (grace.allGuessedAt !== null) out.push({ kind: 'allGuessed', at: grace.allGuessedAt });
  for (const p of data.players) {
    if (!p.connected && p.disconnectedAt !== null) {
      out.push({ kind: 'reconnectExpiry', at: p.disconnectedAt + RECONNECT_GRACE_MS, playerId: p.id });
    }
  }
  if (grace.emptyRoomAt !== null) out.push({ kind: 'emptyRoom', at: grace.emptyRoomAt });
  return out;
}

/** The earliest pending deadline (first in tie-break order among equals), or null when nothing is scheduled. */
export function nextDue(data: RoomData): Deadline | null {
  let best: Deadline | null = null;
  for (const d of pendingDeadlines(data)) if (!best || d.at < best.at) best = d;
  return best;
}

/** Epoch ms at which the driver must tick next, or null when nothing is scheduled. */
export function nextDeadline(data: RoomData): number | null {
  return nextDue(data)?.at ?? null;
}
