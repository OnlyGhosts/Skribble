import { describe, expect, it } from 'vitest';
import { RESTORE_RETRY_MS } from '@shared/platform/constants';
import { REJOIN_RETRY_MS, RoomRecovery } from './recovery';

describe('RoomRecovery', () => {
  it('sends the checkpoint once per connection, then waits quietly until RESTORE_RETRY_MS', () => {
    const recovery = new RoomRecovery();
    expect(recovery.active).toBe(false);
    expect(recovery.roomGone(0, 'cp')).toEqual({ kind: 'restore', checkpoint: 'cp' });
    expect(recovery.restoring).toBe(true);
    expect(recovery.roomGone(1000, 'cp')).toEqual({ kind: 'retry', inMs: REJOIN_RETRY_MS });
    expect(recovery.roomGone(RESTORE_RETRY_MS - 1, 'cp').kind).toBe('retry');
    expect(recovery.roomGone(RESTORE_RETRY_MS, 'cp')).toEqual({ kind: 'giveUp' });
  });

  it('waits the same without a checkpoint, and starts over after it ends', () => {
    const recovery = new RoomRecovery();
    expect(recovery.roomGone(0, null)).toEqual({ kind: 'retry', inMs: REJOIN_RETRY_MS });
    expect(recovery.active).toBe(true);
    expect(recovery.roomGone(RESTORE_RETRY_MS, null)).toEqual({ kind: 'giveUp' });
    recovery.end();
    expect(recovery.active).toBe(false);
    expect(recovery.roomGone(RESTORE_RETRY_MS * 2, null).kind).toBe('retry');
  });

  it('does not count time the server was down: the wait starts over on the next connection', () => {
    const recovery = new RoomRecovery();
    // A shutting-down server (or one that died again) answered once, then went away for a while.
    expect(recovery.roomGone(0, 'cp').kind).toBe('restore');
    recovery.connectionLost();
    expect(recovery.active).toBe(false);
    const back = RESTORE_RETRY_MS * 3;
    expect(recovery.roomGone(back, 'cp')).toEqual({ kind: 'restore', checkpoint: 'cp' });
    expect(recovery.roomGone(back + RESTORE_RETRY_MS - 1, 'cp').kind).toBe('retry');
    expect(recovery.roomGone(back + RESTORE_RETRY_MS, 'cp').kind).toBe('giveUp');
  });
});
