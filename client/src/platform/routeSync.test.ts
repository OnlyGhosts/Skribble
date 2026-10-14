import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals, setLocation } from '../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('./store/usePlatformStore');
const { registerGames } = await import('./registry');
const { navigate, refreshRoute, useRouter } = await import('./router');
const { startRouteSync } = await import('./routeSync');
const { registryOf, resetStore, room, welcome } = await import('../test/fixtures');

const state = () => usePlatformStore.getState();
let stop: () => void = () => undefined;
let onLeave = vi.fn();

/** What the browser does on Back: the address bar moves first, then the app hears about it. */
function goBackTo(pathname: string): void {
  setLocation(pathname);
  refreshRoute();
}

/** Enters a room the way the socket and useUrlSync do: welcome, then the address bar mirrors the room. */
function enterRoom(gameId: 'skribble' | 'template' = 'skribble'): void {
  state().handleServerMessage(welcome('bob', room({ gameId })));
  navigate(`/${gameId}/ABCD`);
}

beforeEach(() => {
  resetStore();
  onLeave = vi.fn();
  registerGames(registryOf({ onLeave }));
  setLocation('/');
  refreshRoute();
  stop = startRouteSync();
});

afterEach(() => stop());

describe('leaving the room through the address bar', () => {
  it('the wordmark link (navigate to the front door) leaves the room and stays there', () => {
    enterRoom();
    expect(state().room).not.toBeNull();
    navigate('/');
    expect(state().room).toBeNull();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(useRouter.getState().route).toEqual({ kind: 'home', code: null, game: null });
  });

  it('Back out of a room lands on the page the user came from', () => {
    setLocation('/');
    refreshRoute();
    enterRoom('template'); // a party that started on the template game
    goBackTo('/');
    expect(state().room).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('mirroring the room into the address bar and a snapshot do not leave it', () => {
    enterRoom();
    navigate('/scribble/ABCD', { replace: true });
    navigate('/scribble/abcd', { replace: true });
    state().handleServerMessage({ t: 'room', room: room() });
    expect(state().room).not.toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('an explicit leave while the address bar names the room moves to the front door and leaves once', () => {
    enterRoom();
    state().resetRoom();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(state().room).toBeNull();
  });

  it('a slug change for the same room code is a game switch, never a leave', () => {
    enterRoom();
    // The host moved the party to another game: the snapshot carries the new game and the address bar follows.
    state().handleServerMessage({ t: 'room', room: room({ gameId: 'template' }) });
    navigate('/template/ABCD', { replace: true });
    expect(state().room?.gameId).toBe('template');
    expect(onLeave).not.toHaveBeenCalled();
    // An invite link for the other game of the same room is no reason to leave either.
    goBackTo('/spygame/ABCD');
    expect(state().room).not.toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('a room entered from a join link is left when Back leaves the link', () => {
    setLocation('/scribble/ABCD');
    refreshRoute();
    state().handleServerMessage(welcome('bob', room()));
    goBackTo('/');
    expect(state().room).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
});

describe('join errors stay on the page that raised them', () => {
  it('clears the error when the visitor moves to another page', () => {
    state().beginJoin({ t: 'join', code: 'ZZZZ', name: 'bob', avatar: { color: 0, emoji: 0 } });
    state().handleServerMessage({ t: 'error', code: 'ROOM_NOT_FOUND', message: 'nope' });
    expect(state().joinError?.code).toBe('ROOM_NOT_FOUND');
    navigate('/ABCD');
    navigate('/');
    expect(state().joinError).toBeNull();
  });
});
