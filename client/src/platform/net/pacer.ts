import {
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
  GAME_MESSAGE_RATE_LIMIT_PER_SECOND,
  PLATFORM_RATE_LIMIT_COUNT,
  PLATFORM_RATE_LIMIT_WINDOW_MS,
} from '@shared/platform/constants';
import { isPlatformMessageType, type WireMessage } from '@shared/platform/protocol';

/** The server's per-socket limits, one per kind of room message (server/platform/connection.ts). */
export type Lane = 'chat' | 'platform' | 'game';

const LIMITS: Record<Lane, { count: number; windowMs: number }> = {
  chat: { count: CHAT_RATE_LIMIT_COUNT, windowMs: CHAT_RATE_LIMIT_WINDOW_MS },
  platform: { count: PLATFORM_RATE_LIMIT_COUNT, windowMs: PLATFORM_RATE_LIMIT_WINDOW_MS },
  game: { count: GAME_MESSAGE_RATE_LIMIT_PER_SECOND, windowMs: 1000 },
};

/** Added to every window: frames sent evenly can still arrive bunched up after a slow stretch of the network. */
export const PACE_MARGIN_MS = 250;

export function laneOf(msg: WireMessage): Lane {
  if (msg.t === 'chat') return 'chat';
  return isPlatformMessageType(msg.t) ? 'platform' : 'game';
}

/**
 * What this socket has sent, against the server's limits: the messages kept back during an
 * outage go out again no faster than the server takes them, since a frame over a limit is
 * refused or dropped, and the room would then skip it for good (it applies numbers in order).
 */
export class SendPacer {
  private readonly sent: Record<Lane, number[]> = { chat: [], platform: [], game: [] };

  record(lane: Lane, now: number): void {
    this.sent[lane].push(now);
  }

  /** How long until one more message of `lane` fits under its limit; 0 means now. */
  waitFor(lane: Lane, now: number): number {
    const { count, windowMs } = LIMITS[lane];
    const span = windowMs + PACE_MARGIN_MS;
    const hits = this.sent[lane];
    while (hits.length > 0 && hits[0] <= now - span) hits.shift();
    if (hits.length < count) return 0;
    return hits[hits.length - count] + span - now;
  }
}
