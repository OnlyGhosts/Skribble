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
  setLocation('/skribble');
  refreshRoute();
  stop = startRouteSync();
});

afterEach(() => stop());

describe('leaving the room through the address bar', () => {
  it('the brand link (navigate to the library) leaves the room and stays on the library', () => {
    enterRoom();
    expect(state().room).not.toBeNull();
    navigate('/');
    expect(state().room).toBeNull();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(useRouter.getState().route).toEqual({ kind: 'library' });
  });

  it('Back out of a room lands on the page the user came from, not the game home', () => {
    setLocation('/');
    refreshRoute();
    enterRoom('template'); // a cross-game join from the library
    goBackTo('/');
    expect(state().room).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('mirroring the room into the address bar and a snapshot do not leave it', () => {
    enterRoom();
    navigate('/skribble/ABCD', { replace: true });
    navigate('/skribble/abcd', { replace: true });
    state().handleServerMessage({ t: 'room', room: room() });
    expect(state().room).not.toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('an explicit leave while the address bar names the room moves to the game home and leaves once', () => {
    enterRoom();
    state().resetRoom();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/skribble');
    expect(state().room).toBeNull();
  });

  it('a room entered from a join link is left when Back leaves the link', () => {
    setLocation('/skribble/ABCD');
    refreshRoute();
    state().handleServerMessage(welcome('bob', room()));
    goBackTo('/skribble');
    expect(state().room).toBeNull();
    expect(window.location.pathname).toBe('/skribble');
  });
});

describe('join errors stay on the page that raised them', () => {
  it('clears the error when the visitor moves to another page', () => {
    state().beginJoin({ t: 'join', code: 'ZZZZ', name: 'bob', avatar: { color: 0, emoji: 0 } });
    state().handleServerMessage({ t: 'error', code: 'ROOM_NOT_FOUND', message: 'nope' });
    expect(state().joinError?.code).toBe('ROOM_NOT_FOUND');
    navigate('/');
    navigate('/template');
    expect(state().joinError).toBeNull();
  });
});
