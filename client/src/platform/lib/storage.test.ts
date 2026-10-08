import { beforeEach, describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS } from '@shared/platform/constants';
import type { StoredSession } from '@shared/platform/protocol';
import { installBrowserGlobals, installFakeStorage } from '../../test/env';

installBrowserGlobals();

const { local, session } = installFakeStorage();

const { clearSeat, isSeatFresh, loadSeat, loadSession, saveSeat, saveSession, seatToResume, SEAT_KEY_PREFIX } = await import('./storage');

const NOW = 1_700_000_000_000;
const sessionFor = (code: string, token = `tok-${code}`): StoredSession => ({ code, gameId: 'skribble', token, playerId: 'p1' });

beforeEach(() => {
  local.clear();
  session.clear();
});

describe('seat storage', () => {
  it('stores one entry per room code in localStorage and reads it back', () => {
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'p1', savedAt: NOW });
    saveSeat({ code: 'WXYZ', token: 'tok-2', playerId: 'p2', savedAt: NOW });
    expect(local.keys().sort()).toEqual([`${SEAT_KEY_PREFIX}ABCD`, `${SEAT_KEY_PREFIX}WXYZ`]);
    expect(loadSeat('ABCD')).toEqual({ code: 'ABCD', token: 'tok-1', playerId: 'p1', savedAt: NOW });
    clearSeat('ABCD');
    expect(loadSeat('ABCD')).toBeNull();
    expect(loadSeat('WXYZ')?.token).toBe('tok-2');
  });

  it('ignores malformed entries', () => {
    local.setItem(`${SEAT_KEY_PREFIX}ABCD`, '{"token":"x"}');
    expect(loadSeat('ABCD')).toBeNull();
    local.setItem(`${SEAT_KEY_PREFIX}ABCD`, 'not json');
    expect(loadSeat('ABCD')).toBeNull();
    expect(loadSeat('NOPE')).toBeNull();
  });

  it('treats a seat as fresh within the reconnect grace only', () => {
    const seat = { code: 'ABCD', token: 't', playerId: 'p', savedAt: NOW };
    expect(isSeatFresh(seat, NOW + RECONNECT_GRACE_MS - 1)).toBe(true);
    expect(isSeatFresh(seat, NOW + RECONNECT_GRACE_MS)).toBe(false);
    expect(isSeatFresh(seat, NOW - 5000)).toBe(true);
  });
});

describe('seatToResume', () => {
  it('prefers the session seat when it names the room on the address bar', () => {
    saveSeat({ code: 'ABCD', token: 'local-tok', playerId: 'p1', savedAt: NOW });
    expect(seatToResume('ABCD', sessionFor('ABCD', 'session-tok'), NOW)).toEqual({ code: 'ABCD', token: 'session-tok' });
  });

  it('falls back to a fresh localStorage seat for that code when the tab was discarded', () => {
    saveSeat({ code: 'ABCD', token: 'local-tok', playerId: 'p1', savedAt: NOW - 60_000 });
    expect(seatToResume('ABCD', null, NOW)).toEqual({ code: 'ABCD', token: 'local-tok' });
    // A session for another room does not count for this one.
    expect(seatToResume('ABCD', sessionFor('WXYZ'), NOW)).toEqual({ code: 'ABCD', token: 'local-tok' });
  });

  it('shows the join form for a stale seat, a different room or no code', () => {
    saveSeat({ code: 'ABCD', token: 'local-tok', playerId: 'p1', savedAt: NOW - RECONNECT_GRACE_MS });
    expect(seatToResume('ABCD', null, NOW)).toBeNull();
    expect(seatToResume('WXYZ', null, NOW)).toBeNull();
    expect(seatToResume(null, sessionFor('ABCD'), NOW)).toBeNull();
  });

  it('keeps the session round-trip intact next to the seat entries', () => {
    saveSession(sessionFor('ABCD'));
    expect(loadSession()).toEqual(sessionFor('ABCD'));
    expect(local.length).toBe(0);
  });
});
