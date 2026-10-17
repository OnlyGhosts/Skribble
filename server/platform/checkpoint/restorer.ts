/**
 * Brings rooms back from the checkpoints phones send after a restart. Every checkpoint for a code
 * is a candidate while the restore collects them, and the newest wins; once the room is back,
 * later ones meet a live room and their phones simply rejoin.
 */
import { CHECKPOINT_MAX_AGE_MS } from '../../../shared/platform/constants.js';
import type { MaybePromise } from '../drivers/types.js';
import { nextDeadline } from '../engine/time.js';
import { loadStoredRoom } from '../storedRoom.js';
import type { PlatformRoomData } from '../engine/state.js';
import { viewFor } from '../engine/view.js';
import { KeyedRateLimiter } from '../rateLimiter.js';
import type { Clock } from '../transport.js';
import { CHECKPOINT_HOLDERS, checkpointHolders } from './checkpointer.js';
import { openCheckpoint } from './seal.js';

/**
 * A restore collects checkpoints for at least this long after the first one, and closes then once
 * a second phone has sent one too (or every phone the best one went to has).
 */
export const RESTORE_WINDOW_MS = 1000;
/**
 * The longest a restore waits for that second phone. The phones come back on their own reconnect
 * backoff (up to 8 s apart), and the first may hold an old copy: one from before it dropped, or
 * kept on purpose by a player kicked since.
 */
export const RESTORE_WINDOW_MAX_MS = 8000;
/** Authenticated restore attempts per room code; a room has at most a handful of phones holding one. */
export const RESTORE_RATE_LIMIT_COUNT = 20;
export const RESTORE_RATE_LIMIT_WINDOW_MS = 60_000;
/** Codes being restored at once, and codes with a rate-limit record. */
export const MAX_PENDING_RESTORES = 200;
const MAX_LIMITED_CODES = 5000;
/** Deleted codes remembered (for CHECKPOINT_MAX_AGE_MS each); the oldest are dropped beyond it. */
export const MAX_TOMBSTONES = 10_000;

export const RESTORE_REFUSED = 'That game could not be brought back.';

/**
 * `retry`: the refusal is about this phone's copy or the server's load, not about the seat or the
 * room, so another phone may still bring the room back and this one should keep asking quietly.
 */
export type Offered = { ok: true } | { ok: false; message: string; retry: boolean };

export interface RestorerOptions {
  /** Null when checkpoints are off: every restore is refused. */
  key: Buffer | null;
  clock: Clock;
  /** Builds the room from the winning checkpoint; false when it could not (the server is full). */
  rebuild(data: PlatformRoomData, issuedAt: number): boolean;
  isLive(code: string): boolean;
  log?: (msg: string) => void;
  windowMs?: number;
  maxWindowMs?: number;
}

interface Candidate {
  issuedAt: number;
  data: PlatformRoomData;
}

interface Pending {
  best: Candidate | null;
  /** The seats whose valid checkpoints are in. */
  offerers: Set<string>;
  openedAt: number;
  timers: Array<ReturnType<typeof setTimeout>>;
  /** Resolves with whether the room came back. */
  done: Promise<boolean>;
  settle(restored: boolean): void;
}

export class Restorer {
  private readonly pending = new Map<string, Pending>();
  /** Deleted room codes: checkpoints issued at or before the deletion are refused. */
  private readonly tombstones = new Map<string, number>();
  private readonly perCode = new KeyedRateLimiter(RESTORE_RATE_LIMIT_COUNT, RESTORE_RATE_LIMIT_WINDOW_MS, MAX_LIMITED_CODES);
  private readonly startedAt: number;

  constructor(private readonly options: RestorerOptions) {
    this.startedAt = options.clock.now();
  }

  /**
   * Whether a phone holding a checkpoint for `code` (whose room is not live) could still bring it
   * back: checkpoints are on, this process started recently enough for one issued before it to be
   * valid, and the code was not deleted here (a room that ended stays ended).
   */
  mayRestore(code: string): boolean {
    const now = this.options.clock.now();
    return this.options.key !== null && now - this.startedAt < CHECKPOINT_MAX_AGE_MS && this.tombstone(code, now) === null;
  }

  /**
   * A phone holding seat `token` offers `text` for `code`, whose room is not live. Resolves once the
   * room is back (the caller then rejoins the seat), or refuses. A checkpoint refused while another
   * phone's is bringing the room back waits for that instead: the rejoin then decides.
   */
  offer(code: string, token: string, text: string): MaybePromise<Offered> {
    const { key, clock } = this.options;
    const refuse = (why: string, retry: boolean): Offered => {
      this.options.log?.(`restore ${code}: refused (${why})`);
      return { ok: false, message: RESTORE_REFUSED, retry };
    };
    if (!key) return refuse('checkpoints are off', false);
    const now = clock.now();
    const unless = (why: string, retry: boolean): MaybePromise<Offered> => {
      const pending = this.pending.get(code);
      return pending ? pending.done.then((): Offered => ({ ok: true })) : refuse(why, retry);
    };
    if (!this.pending.has(code) && this.pending.size >= MAX_PENDING_RESTORES) return refuse('too many restores at once', true);
    const opened = openCheckpoint(key, text, { code, now });
    if (!opened.ok) return unless(opened.reason, true);
    // Counted only once authentic: garbage sent with the code must not use up the room's tries.
    if (!this.perCode.tryAcquire(code, now)) return unless('too many attempts', true);
    const deletedAt = this.tombstone(code, now);
    if (deletedAt !== null && opened.issuedAt <= deletedAt) return unless('the room was deleted', false);
    const data = loadStoredRoom(opened.value);
    if (!data || data.code !== code || !runs(data, now)) return unless('the room does not load', true);
    if (!data.players.some((p) => p.token === token) || data.kickedTokens.includes(token)) return unless('not a seat', false);
    if (this.options.isLive(code)) return { ok: true };

    const pending = this.pending.get(code) ?? this.open(code, now);
    pending.offerers.add(token);
    if (!pending.best || isNewer(opened.issuedAt, data, pending.best)) pending.best = { issuedAt: opened.issuedAt, data };
    if (now - pending.openedAt >= (this.options.windowMs ?? RESTORE_WINDOW_MS) && confirmed(pending)) this.close(code, pending);
    return pending.done.then((restored) => (restored || this.options.isLive(code) ? { ok: true } : refuse('the room could not be rebuilt', false)));
  }

  /** The room `code` was deleted at `at` (everyone left, it ended): its checkpoints must not bring it back. */
  remember(code: string, at: number): void {
    this.expireTombstones(at);
    this.tombstones.delete(code);
    this.tombstones.set(code, at);
    if (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.tombstones.keys().next();
      if (!oldest.done) this.tombstones.delete(oldest.value);
    }
  }

  stop(): void {
    for (const pending of this.pending.values()) {
      for (const timer of pending.timers) clearTimeout(timer);
      pending.settle(false);
    }
    this.pending.clear();
  }

  private open(code: string, now: number): Pending {
    let settle: (restored: boolean) => void = () => undefined;
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const pending: Pending = { best: null, offerers: new Set(), openedAt: now, timers: [], done, settle };
    pending.timers.push(
      setTimeout(() => {
        if (confirmed(pending)) this.close(code, pending);
      }, this.options.windowMs ?? RESTORE_WINDOW_MS),
      setTimeout(() => this.close(code, pending), this.options.maxWindowMs ?? RESTORE_WINDOW_MAX_MS),
    );
    this.pending.set(code, pending);
    return pending;
  }

  private close(code: string, pending: Pending): void {
    if (this.pending.get(code) !== pending) return;
    this.pending.delete(code);
    for (const timer of pending.timers) clearTimeout(timer);
    const best = pending.best;
    let restored = false;
    if (best && !this.options.isLive(code)) {
      try {
        restored = this.options.rebuild(best.data, best.issuedAt);
      } catch (err) {
        this.options.log?.(`restore ${code}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (restored) this.options.log?.(`restore ${code}: room is back (checkpoint from ${Math.round((this.options.clock.now() - best.issuedAt) / 1000)} s ago)`);
    }
    pending.settle(restored);
  }

  /** When `code` was deleted, if that was recent enough for one of its checkpoints to still be valid. */
  private tombstone(code: string, now: number): number | null {
    this.expireTombstones(now);
    return this.tombstones.get(code) ?? null;
  }

  private expireTombstones(now: number): void {
    for (const [code, at] of this.tombstones) {
      if (now - at <= CHECKPOINT_MAX_AGE_MS) break;
      this.tombstones.delete(code);
    }
  }
}

/**
 * The best checkpoint so far can be trusted to be the newest: a second phone has sent one too, or
 * every phone that checkpoint went to has. A lone first offer may be an old copy.
 */
function confirmed(pending: Pending): boolean {
  const best = pending.best;
  if (!best) return false;
  if (pending.offerers.size >= 2) return true;
  const tokens = new Map(best.data.players.map((p) => [p.id, p.token]));
  return checkpointHolders(best.data, CHECKPOINT_HOLDERS).every((id) => pending.offerers.has(tokens.get(id) ?? ''));
}

/** Newest wins: the later checkpoint, or of two issued in the same millisecond the later version of the room. */
function isNewer(issuedAt: number, data: PlatformRoomData, than: { issuedAt: number; data: PlatformRoomData }): boolean {
  return issuedAt > than.issuedAt || (issuedAt === than.issuedAt && data.version > than.data.version);
}

/** The room renders and schedules: a game state this deploy cannot run is refused rather than crashing a tick. */
function runs(data: PlatformRoomData, now: number): boolean {
  try {
    viewFor(data, null, now);
    for (const p of data.players) viewFor(data, p.id, now);
    nextDeadline(data);
    return true;
  } catch {
    return false;
  }
}
