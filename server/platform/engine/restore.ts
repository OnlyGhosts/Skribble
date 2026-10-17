/**
 * Rebuilding a room from a checkpoint after a server restart, as a pure function: the clocks move
 * on by the downtime, the game is told (its side store is empty), and every seat starts
 * disconnected, as if all the phones had dropped at once.
 */
import type { Ctx } from './actions.js';
import { applyGameResult, gameCtx } from './delegate.js';
import type { Effect } from './effects.js';
import type { Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { applyAction } from './reduce.js';
import type { PlatformRoomData } from './state.js';

/**
 * A number in a game's state this close to the checkpoint's time is an epoch-ms time. Everything
 * else a game keeps (chips, scores, counters, durations such as a paused clock's remaining ms)
 * is many orders of magnitude away from it.
 */
export const EPOCH_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** A copy of `value` with every epoch time near `around` moved by `delta`. */
export function shiftEpochTimes<T>(value: T, around: number, delta: number): T {
  return shift(value, around, delta) as T;
}

function shift(value: unknown, around: number, delta: number): unknown {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value - around) <= EPOCH_WINDOW_MS ? value + delta : value;
  if (Array.isArray(value)) return value.map((v: unknown) => shift(v, around, delta));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, around, delta)]));
  }
  return value;
}

export interface Restored {
  data: PlatformRoomData;
  /** What the driver still runs: side-store resets (nobody is connected to send anything to). */
  effects: Effect[];
}

/** The room in `stored`, as issued at `issuedAt`, brought back at `ctx.now`. */
export function restoreRoomData(stored: PlatformRoomData, issuedAt: number, ctx: Ctx): Restored {
  const delta = Math.max(0, ctx.now - issuedAt);
  const later = (t: number | null | undefined): number | null => (t === null || t === undefined ? null : t + delta);
  const copy = structuredClone(stored);
  let data: PlatformRoomData = {
    ...copy,
    players: copy.players.map((p) => ({ ...p, connectedAt: p.connectedAt + delta, disconnectedAt: later(p.disconnectedAt), awayNoticeAt: later(p.awayNoticeAt) })),
    waitingUntil: later(copy.waitingUntil),
    grace: { emptyRoomAt: later(copy.grace.emptyRoomAt) },
    game: copy.game === null ? null : shiftEpochTimes(copy.game, issuedAt, delta),
  };
  const effects: Effect[] = [];

  const game = moduleFor(data.gameId);
  if (data.phase === 'playing' && data.game !== null && game.restored) {
    const cx: Cx = { data, effects, ctx, now: ctx.now };
    applyGameResult(cx, game.restored(gameCtx(cx), data.game));
  }

  // The host goes last: with nobody connected by then, nobody stands in for them.
  const connected = data.players.filter((p) => p.connected);
  const order = [...connected.filter((p) => p.id !== data.hostId), ...connected.filter((p) => p.id === data.hostId)];
  for (const p of order) {
    const out = applyAction(data, { type: 'connectionClosed', playerId: p.id }, ctx);
    data = out.data;
    effects.push(...out.effects);
  }
  return { data, effects: effects.filter((e) => e.type === 'side') };
}
