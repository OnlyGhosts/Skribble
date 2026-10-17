import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameResults } from '@shared/platform/protocol';
import { installBrowserGlobals, installFakeStorage, setLocation } from '../../test/env';

installBrowserGlobals();
const storage = installFakeStorage();

const { ERROR_TOAST_MS, TOAST_MS, usePlatformStore } = await import('./usePlatformStore');
const { loadResultsSeen, loadResultsShown } = await import('../lib/storage');
const { registerGames } = await import('../registry');
const { chatLine, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const state = () => usePlatformStore.getState();

beforeEach(() => {
  resetStore();
  setLocation('/');
});

describe('the results popup across a reload', () => {
  const results: GameResults = { id: 'r1', gameId: 'scribble', reason: 'host', entries: [{ playerId: 'host', name: 'Host', avatar: { color: 0, emoji: 0 }, score: 3, rank: 1 }] };
  const lobby = room({ phase: 'lobby', results });
  /** A reloaded tab: no room in memory, only what this tab's sessionStorage kept. */
  const reload = () => usePlatformStore.setState({ room: null, playerId: null, results: null, resultsSeen: loadResultsSeen(), resultsShown: loadResultsShown() });

  beforeEach(() => storage.session.clear());

  it('comes back for someone who only watched the game, until they close it', () => {
    state().handleServerMessage(welcome('dave', room({ phase: 'playing' })));
    state().handleServerMessage({ t: 'room', room: lobby });
    expect(state().results?.id).toBe('r1');
    reload();
    state().handleServerMessage(welcome('dave', lobby));
    expect(state().results?.id).toBe('r1');
    state().closeResults();
    reload();
    state().handleServerMessage(welcome('dave', lobby));
    expect(state().results).toBeNull();
  });

  it('is not brought back to a newcomer, nor after leaving the room', () => {
    reload();
    state().handleServerMessage(welcome('newt', lobby));
    expect(state().results).toBeNull();
    state().handleServerMessage(welcome('dave', room({ phase: 'playing' })));
    state().handleServerMessage({ t: 'room', room: lobby });
    state().resetRoom();
    reload();
    state().handleServerMessage(welcome('dave', lobby));
    expect(state().results).toBeNull();
  });
});

describe('messages after leaving', () => {
  it('ignores room and chat messages while not in a room', () => {
    state().handleServerMessage(welcome('bob', room()));
    state().resetRoom();
    state().handleServerMessage({ t: 'room', room: room() });
    state().handleServerMessage({ t: 'chat', message: chatLine(1) });
    expect(state().room).toBeNull();
    expect(state().chat).toEqual([]);
  });

  it('still enters a room through welcome', () => {
    state().handleServerMessage(welcome('bob', room()));
    expect(state().room?.code).toBe('ABCD');
    state().handleServerMessage({ t: 'chat', message: chatLine(1) });
    expect(state().chat).toHaveLength(1);
  });
});

describe('notices', () => {
  it('pops a notice line up as a toast, since there is no chat to read it in; other lines and a welcome\'s history never do', () => {
    state().handleServerMessage({ ...welcome('bob', room()), chat: [chatLine(1, 'notice', 'Old news')] });
    expect(state().toasts).toEqual([]);
    state().handleServerMessage({ t: 'chat', message: chatLine(2, 'system', 'Ann joined') });
    state().handleServerMessage({ t: 'chat', message: chatLine(3, 'notice', 'Ann voted to kick Bo (1/2)') });
    expect(state().toasts.map((t) => [t.kind, t.text])).toEqual([['info', 'Ann voted to kick Bo (1/2)']]);
  });
});

describe('leaving a room', () => {
  it('lands on the front door after leaving and tells the game module', () => {
    const onLeave = vi.fn();
    registerGames(registryOf({ onLeave }));
    setLocation('/scribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    state().resetRoom();
    expect(window.location.pathname).toBe('/');
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(state().room).toBeNull();
    expect(state().playerId).toBeNull();
  });

  it('leaves the address bar alone when it no longer names the room (Back out of a room)', () => {
    setLocation('/scribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    // The browser already moved to the previous entry (the front door) before the app learnt about it.
    setLocation('/');
    state().resetRoom();
    expect(window.location.pathname).toBe('/');
    expect(state().room).toBeNull();

    setLocation('/scribble/ABCD');
    state().handleServerMessage(welcome('bob', room({ gameId: 'template' })));
    setLocation('/WXYZ');
    state().resetRoom();
    expect(window.location.pathname).toBe('/WXYZ');
  });

  it('keeps the join link when the seat expired but the room may still exist', () => {
    setLocation('/scribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: 'expired' });
    expect(window.location.pathname).toBe('/scribble/ABCD');
    expect(state().room).toBeNull();
    expect(state().toasts.map((t) => t.text)).toEqual([expect.stringMatching(/rejoin/i)]);
  });

  it('tells a removed player so, and an expired seat so, instead of guessing that the room closed', () => {
    setLocation('/scribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    expect(state().room).toBeNull();
    expect(state().toasts.map((t) => t.text)).toEqual(["Couldn't rejoin your previous seat. You were removed from this room."]);
    expect(state().toasts[0]?.text).not.toMatch(/closed/);

    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' });
    expect(state().toasts.at(-1)?.text).toBe("Couldn't rejoin your previous seat. Your seat in this room has expired.");

    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: 'This room no longer exists.' });
    expect(state().toasts.at(-1)?.text).toBe("Couldn't rejoin your previous seat. This room no longer exists.");

    // No reason given: the generic line.
    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: '' });
    expect(state().toasts.at(-1)?.text).toBe("Couldn't rejoin your previous seat. The room may have closed.");
  });

  it('a kick clears the room with a toast', () => {
    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'kicked', reason: 'host decision' });
    expect(state().room).toBeNull();
    expect(state().toasts.map((t) => t.text)).toEqual(['You were removed from the room: host decision']);
  });
});

describe('join errors', () => {
  it('turns a join-related error into the join form error, other errors into toasts', () => {
    state().beginJoin({ t: 'join', code: 'ABCD', name: 'bob', avatar: { color: 0, emoji: 0 } });
    state().handleServerMessage({ t: 'error', code: 'ROOM_FULL', message: 'full' });
    expect(state().joinPending).toBe(false);
    expect(state().joinError?.code).toBe('ROOM_FULL');
    // A refused move says the server's own few words, as a passing note.
    state().handleServerMessage({ t: 'error', code: 'NOT_ALLOWED', message: 'It is not your turn.' });
    expect(state().toasts.map((t) => [t.kind, t.text])).toEqual([['info', 'It is not your turn.']]);
    state().handleServerMessage({ t: 'error', code: 'INTERNAL', message: 'boom' });
    expect(state().toasts.map((t) => t.kind)).toEqual(['info', 'error']);
  });
});

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes every toast by itself, an error a little later than a note', () => {
    state().addToast('info', 'A note');
    state().addToast('error', 'Something broke');
    vi.advanceTimersByTime(TOAST_MS);
    expect(state().toasts.map((t) => t.text)).toEqual(['Something broke']);
    vi.advanceTimersByTime(ERROR_TOAST_MS - TOAST_MS);
    expect(state().toasts).toEqual([]);
  });

  it('shows the same line once, kept up a little longer by each repeat', () => {
    state().addToast('info', 'It is not your turn.');
    vi.advanceTimersByTime(TOAST_MS - 1000);
    state().addToast('info', 'It is not your turn.');
    expect(state().toasts).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(state().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(state().toasts).toEqual([]);
  });

  it('keeps at most four on show', () => {
    for (let i = 0; i < 6; i++) state().addToast('error', `Error ${i}`);
    expect(state().toasts.map((t) => t.text)).toEqual(['Error 2', 'Error 3', 'Error 4', 'Error 5']);
  });
});

describe('clock offset', () => {
  it('seeds from snapshots until a pong gives a corrected value, then sticks to pongs', () => {
    const now = Date.now();
    state().handleServerMessage(welcome('bob', room({ serverTime: now + 4000 })));
    expect(state().clockOffset).toBeCloseTo(4000, -2);
    state().setClockOffset(1200);
    state().handleServerMessage({ t: 'room', room: room({ serverTime: now + 4000 }) });
    expect(state().clockOffset).toBe(1200);
    state().handleServerMessage(welcome('bob', room({ serverTime: now + 4000 })));
    expect(state().clockOffset).toBe(1200);
  });
});

describe('game clocks during a server restart', () => {
  afterEach(() => vi.useRealTimers());

  it('hold at the moment the restart began and run again once the server is back', async () => {
    const { remainingMs } = await import('../lib/useCountdown');
    vi.useFakeTimers();
    const endsAt = Date.now() + 30_000;
    vi.advanceTimersByTime(5000);
    state().setConnection('restarting');
    const heldAt = state().clocksHeldAt;
    expect(heldAt).toBe(Date.now());
    // The outage drags on: the clock still shows what it showed when the restart began.
    vi.advanceTimersByTime(20_000);
    state().setConnection('restarting');
    expect(state().clocksHeldAt).toBe(heldAt);
    expect(remainingMs(endsAt, 0, state().clocksHeldAt ?? Date.now())).toBe(25_000);
    state().setConnection('connected');
    expect(state().clocksHeldAt).toBeNull();
    state().setConnection('reconnecting');
    expect(state().clocksHeldAt).toBeNull();
  });
});
