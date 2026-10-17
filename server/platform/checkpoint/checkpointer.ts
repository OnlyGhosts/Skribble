/**
 * Hands a few phones of every room a sealed copy of it (a checkpoint), so that any one of them can
 * bring the room back after the server restarts. One per process, fed by the rooms' changes.
 */
import { CHECKPOINT_MAX_CHARS } from '../../../shared/platform/constants.js';
import { moduleFor } from '../engine/module.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { Clock, Transport } from '../transport.js';
import { sealCheckpoint } from './seal.js';

/** A room's checkpoint goes out at most this often, the last change always included. */
export const CHECKPOINT_INTERVAL_MS = 3000;
/** Phones per room holding the newest checkpoint: the host and the five who joined first. Any one of them restores the room. */
export const CHECKPOINT_HOLDERS = 6;
/**
 * A room that stays the same (a quiet lobby, a long think) is sealed again this often, so the
 * phones' copy never ages past CHECKPOINT_MAX_AGE_MS while they still have the page open.
 */
export const CHECKPOINT_REFRESH_MS = 10 * 60_000;

export interface CheckpointRoom {
  readonly code: string;
  readonly state: PlatformRoomData;
}

export interface CheckpointerOptions {
  key: Buffer;
  transport: Pick<Transport, 'send'>;
  clock: Clock;
  log?: (msg: string) => void;
}

type Timer = ReturnType<typeof setTimeout>;

interface Lane {
  room: CheckpointRoom;
  timer: Timer | null;
  /** Seals the room again once it has been quiet for CHECKPOINT_REFRESH_MS. */
  refresh: Timer | null;
  sentAt: number;
  /**
   * Every phone that holds one of this room's checkpoints: each new one reaches them all, or they
   * are told to drop theirs, so no phone keeps an old copy that could roll the room back.
   */
  holders: Set<string>;
  warnedTooLarge: boolean;
}

/**
 * The phones that get a room's checkpoint: connected seated players, the host first, then the
 * players in the running game before those watching it, then by join order. The order does not
 * move when a phone reconnects, so a brief drop does not hand the checkpoints to someone else for
 * good. Every seat has its own token, so a watcher restores as well as a player.
 */
export function checkpointHolders(data: PlatformRoomData, max: number): string[] {
  const rank = (p: PlatformRoomData['players'][number]): number => (p.id === data.hostId ? 0 : p.participating ? 1 : 2);
  return data.players
    .filter((p) => p.connected)
    .sort((a, b) => rank(a) - rank(b) || a.joinOrder - b.joinOrder)
    .slice(0, max)
    .map((p) => p.id);
}

/** What a checkpoint carries: the stored room, less the connection ids (a restore starts every seat disconnected). */
export function checkpointOf(data: PlatformRoomData): PlatformRoomData {
  return { ...data, players: data.players.map((p) => ({ ...p, connectionId: null })) };
}

/** A change worth a checkpoint at once: a game starting or ending, a new round or turn, a seat gone, a new host. */
export function isMilestone(before: PlatformRoomData, after: PlatformRoomData): boolean {
  if (before.phase !== after.phase || before.hostId !== after.hostId || after.players.length < before.players.length) return true;
  if (before.gameId !== after.gameId || before.game === null || after.game === null) return false;
  const milestone = moduleFor(after.gameId).milestone;
  return milestone !== undefined && milestone(before.game) !== milestone(after.game);
}

export class Checkpointer {
  private readonly lanes = new Map<string, Lane>();

  constructor(private readonly options: CheckpointerOptions) {}

  /** The room changed from `before`: send its checkpoint now, or once the interval since the last one is up. */
  changed(room: CheckpointRoom, before: PlatformRoomData): void {
    const lane = this.lane(room);
    if (isMilestone(before, room.state)) return this.send(lane, checkpointHolders(room.state, CHECKPOINT_HOLDERS));
    if (lane.timer !== null) return;
    const delay = Math.max(0, lane.sentAt + CHECKPOINT_INTERVAL_MS - this.options.clock.now());
    lane.timer = setTimeout(() => {
      lane.timer = null;
      this.send(lane, checkpointHolders(lane.room.state, CHECKPOINT_HOLDERS));
    }, delay);
  }

  /** Before a restart: every connected phone that ever held a checkpoint gets a fresh one. */
  flushAll(): void {
    for (const lane of this.lanes.values()) {
      const connected = new Set(lane.room.state.players.filter((p) => p.connected).map((p) => p.id));
      const ids = new Set([...[...lane.holders].filter((id) => connected.has(id)), ...checkpointHolders(lane.room.state, CHECKPOINT_HOLDERS)]);
      this.send(lane, [...ids]);
    }
  }

  /** The room is gone: nothing more is sent for it. */
  forget(code: string): void {
    const lane = this.lanes.get(code);
    if (lane) this.clearTimers(lane);
    this.lanes.delete(code);
  }

  stop(): void {
    for (const code of [...this.lanes.keys()]) this.forget(code);
  }

  private lane(room: CheckpointRoom): Lane {
    let lane = this.lanes.get(room.code);
    if (!lane || lane.room !== room) {
      if (lane) this.clearTimers(lane);
      lane = { room, timer: null, refresh: null, sentAt: -Infinity, holders: new Set(), warnedTooLarge: false };
      this.lanes.set(room.code, lane);
    }
    return lane;
  }

  private clearTimers(lane: Lane): void {
    if (lane.timer !== null) clearTimeout(lane.timer);
    if (lane.refresh !== null) clearTimeout(lane.refresh);
    lane.timer = null;
    lane.refresh = null;
  }

  private send(lane: Lane, to: string[]): void {
    this.clearTimers(lane);
    if (to.length === 0) return;
    lane.refresh = setTimeout(() => {
      lane.refresh = null;
      this.send(lane, checkpointHolders(lane.room.state, CHECKPOINT_HOLDERS));
    }, CHECKPOINT_REFRESH_MS);
    const now = this.options.clock.now();
    const checkpoint = sealCheckpoint(this.options.key, lane.room.code, now, checkpointOf(lane.room.state));
    if (checkpoint.length > CHECKPOINT_MAX_CHARS) {
      if (!lane.warnedTooLarge) this.options.log?.(`room ${lane.room.code}: checkpoint of ${checkpoint.length} characters is too large to send`);
      lane.warnedTooLarge = true;
      return;
    }
    lane.sentAt = now;
    this.dropStale(lane, new Set(to));
    for (const id of to) {
      lane.holders.add(id);
      this.options.transport.send(id, { t: 'checkpoint', checkpoint });
    }
  }

  /**
   * Holders left out of this send: a connected one is told to drop its copy, which is about to be
   * out of date; a disconnected one cannot be told and hears it once it is back (or is gone).
   */
  private dropStale(lane: Lane, to: ReadonlySet<string>): void {
    for (const id of lane.holders) {
      if (to.has(id)) continue;
      const player = lane.room.state.players.find((p) => p.id === id);
      if (player && !player.connected) continue;
      lane.holders.delete(id);
      if (player) this.options.transport.send(id, { t: 'checkpoint', checkpoint: null });
    }
  }
}
