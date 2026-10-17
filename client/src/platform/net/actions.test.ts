import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals, installFakeStorage } from '../../test/env';

installBrowserGlobals();
installFakeStorage();

const { socket } = await import('./socket');
const { countMeIn, joinRoom, sendJoin } = await import('./actions');
const { usePlatformStore } = await import('../store/usePlatformStore');
const { saveSeat } = await import('../lib/storage');

afterEach(() => vi.restoreAllMocks());

describe('Count me in', () => {
  it('comes back in and readies in one tap, in that order on the one socket', () => {
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    countMeIn(false);
    expect(send.mock.calls.map(([msg]) => msg)).toEqual([
      { t: 'sitOut', sitOut: false },
      { t: 'ready', ready: true },
    ]);
  });

  it('only brings the host back in: pressing Start readies them', () => {
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    countMeIn(true);
    expect(send.mock.calls.map(([msg]) => msg)).toEqual([{ t: 'sitOut', sitOut: false }]);
  });
});

describe('joining by code', () => {
  const join = { t: 'join', code: 'ab cd', name: 'Bob', avatar: { color: 0, emoji: 0 } } as const;

  it('goes back into the seat this phone holds in that room', () => {
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'p1', savedAt: Date.now() });
    const resume = vi.spyOn(socket, 'resumeOrJoin').mockReturnValue(true);
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    sendJoin(join);
    expect(resume).toHaveBeenCalledWith({ code: 'ABCD', token: 'tok-1' }, join);
    expect(send).not.toHaveBeenCalled();
  });

  it('joins plainly a room this phone holds no seat in', () => {
    const resume = vi.spyOn(socket, 'resumeOrJoin');
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    sendJoin({ ...join, code: 'WXYZ' });
    expect(resume).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ ...join, code: 'WXYZ' });
  });
});

describe('a typed code while the server restarts', () => {
  afterEach(() => vi.useRealTimers());

  it('does not time the join out while its seat may be on its way back, and does once that is settled', () => {
    vi.useFakeTimers();
    saveSeat({ code: 'ABCD', token: 'tok-1', playerId: 'p1', savedAt: Date.now() });
    vi.spyOn(socket, 'isOpen').mockReturnValue(true);
    vi.spyOn(socket, 'resumeOrJoin').mockReturnValue(true);
    joinRoom('ABCD', 'Bob', { color: 0, emoji: 0 });
    // The server said a restart may have lost the room: the phone asks again quietly for a while.
    usePlatformStore.getState().setConnection('restarting');
    vi.advanceTimersByTime(60_000);
    expect(usePlatformStore.getState()).toMatchObject({ joinPending: true, joinError: null });
    usePlatformStore.getState().setConnection('connected');
    vi.advanceTimersByTime(10_000);
    expect(usePlatformStore.getState()).toMatchObject({ joinPending: false, joinError: { code: 'TIMEOUT' } });
  });
});
