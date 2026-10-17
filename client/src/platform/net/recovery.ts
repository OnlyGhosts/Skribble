import { RESTORE_RETRY_MS } from '@shared/platform/constants';

/** How often a phone without a checkpoint asks again for a room another phone may be bringing back. */
export const REJOIN_RETRY_MS = 2_000;

export type RecoveryStep = { kind: 'restore'; checkpoint: string } | { kind: 'retry'; inMs: number } | { kind: 'giveUp' };

/**
 * What a phone does when its rejoin finds no room (a server restart lost it): send the checkpoint
 * it holds, once per connection; without one (or once that restore could not even be tried), ask
 * again quietly for RESTORE_RETRY_MS in case another phone brings the room back; then give up.
 * The wait counts on one connection only: while the server is down nobody can bring the room back.
 */
export class RoomRecovery {
  /** When the first rejoin on this connection found no room; null while nothing is being recovered. */
  private goneAt: number | null = null;
  /** A restore went out on the current connection: its answer ends the recovery. */
  private restoreSent = false;

  get active(): boolean {
    return this.goneAt !== null;
  }

  get restoring(): boolean {
    return this.restoreSent;
  }

  /** The rejoin found no room. `checkpoint` is what this phone holds for the seat. */
  roomGone(now: number, checkpoint: string | null): RecoveryStep {
    this.goneAt ??= now;
    if (checkpoint !== null && !this.restoreSent) {
      this.restoreSent = true;
      return { kind: 'restore', checkpoint };
    }
    if (now - this.goneAt < RESTORE_RETRY_MS) return { kind: 'retry', inMs: REJOIN_RETRY_MS };
    return { kind: 'giveUp' };
  }

  /**
   * The connection went: a restore sent on it may never have arrived, so the next one may send it
   * again, and the wait starts over once the server answers again.
   */
  connectionLost(): void {
    this.goneAt = null;
    this.restoreSent = false;
  }

  end(): void {
    this.goneAt = null;
    this.restoreSent = false;
  }
}
