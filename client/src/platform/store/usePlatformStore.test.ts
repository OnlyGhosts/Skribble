import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('./usePlatformStore');
const { registerGames } = await import('../registry');
const { chatLine, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const state = () => usePlatformStore.getState();

beforeEach(() => {
  resetStore();
  setLocation('/');
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

describe('leaving a room', () => {
  it('lands on the game home of the room that was left and tells the game module', () => {
    const onLeave = vi.fn();
    registerGames(registryOf({ onLeave }));
    setLocation('/skribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    state().resetRoom();
    expect(window.location.pathname).toBe('/skribble');
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(state().room).toBeNull();
    expect(state().playerId).toBeNull();
  });

  it('leaves the address bar alone when it no longer names the room (Back out of a room)', () => {
    setLocation('/skribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    // The browser already moved to the previous entry (the library) before the app learnt about it.
    setLocation('/');
    state().resetRoom();
    expect(window.location.pathname).toBe('/');
    expect(state().room).toBeNull();

    setLocation('/skribble/ABCD');
    state().handleServerMessage(welcome('bob', room({ gameId: 'template' })));
    setLocation('/skribble');
    state().resetRoom();
    expect(window.location.pathname).toBe('/skribble');
  });

  it('keeps the join link when the seat expired but the room may still exist', () => {
    setLocation('/skribble/ABCD');
    state().handleServerMessage(welcome('bob', room()));
    state().handleServerMessage({ t: 'error', code: 'REJOIN_FAILED', message: 'expired' });
    expect(window.location.pathname).toBe('/skribble/ABCD');
    expect(state().room).toBeNull();
    expect(state().toasts.map((t) => t.text)).toEqual([expect.stringMatching(/rejoin/i)]);
  });

  it('tells a removed player so, and an expired seat so, instead of guessing that the room closed', () => {
    setLocation('/skribble/ABCD');
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
    expect(state().toasts.at(-1)?.text).toBe("Couldn't rejoin your previous seat — the room may have closed.");
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
    state().handleServerMessage({ t: 'error', code: 'NOT_ALLOWED', message: 'nope' });
    expect(state().toasts.map((t) => t.kind)).toEqual(['error']);
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
