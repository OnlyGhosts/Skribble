import { describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { canonicalPath, parseRoute, refreshRoute, routeCode, roomPath, useRouter } = await import('./router');
const { setLocation } = await import('../test/env');

describe('parseRoute', () => {
  it('maps the root to the front door without a code', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home', code: null, game: null });
    expect(routeCode(parseRoute('/'))).toBeNull();
  });

  it('sends a bare game slug (the old per-game landing page) to the redirect', () => {
    const route = parseRoute('/scribble');
    expect(route.kind === 'game' && route.game.id).toBe('skribble');
    expect(routeCode(route)).toBeNull();
    const hidden = parseRoute('/template/');
    expect(hidden.kind === 'game' && hidden.game.id).toBe('template');
  });

  it('opens the front door with the code of an invite link, normalising its case', () => {
    expect(parseRoute('/scribble/ab2k')).toEqual({ kind: 'home', code: 'AB2K', game: null });
    expect(parseRoute('/spygame/AB2K')).toEqual({ kind: 'home', code: 'AB2K', game: null });
  });

  it('treats a legacy bare code (path or ?room=) the same way', () => {
    expect(parseRoute('/AB2K')).toEqual({ kind: 'home', code: 'AB2K', game: null });
    expect(parseRoute('/ab2k')).toEqual({ kind: 'home', code: 'AB2K', game: null });
    expect(parseRoute('/', '?room=ab2k')).toEqual({ kind: 'home', code: 'AB2K', game: null });
    expect(parseRoute('/', '?room=ABIL')).toEqual({ kind: 'home', code: null, game: null });
  });

  it('lets ?game= pick the game Create starts on (hidden games included, for development and tests)', () => {
    const route = parseRoute('/', '?game=template');
    expect(route.kind === 'home' && route.game?.id).toBe('template');
    expect(parseRoute('/', '?game=nope')).toEqual({ kind: 'home', code: null, game: null });
  });

  it('rejects codes with look-alike letters and unknown paths', () => {
    expect(parseRoute('/ABIL').kind).toBe('unknown');
    expect(parseRoute('/nope').kind).toBe('unknown');
    expect(parseRoute('/scribble/nope').kind).toBe('unknown');
    expect(parseRoute('/scribble/AB2K/extra').kind).toBe('unknown');
  });

  it('builds the in-room path, which is also the invite link', () => {
    // The drawing game is shown as Scribble; its internal id stays 'skribble'.
    expect(roomPath('skribble', 'AB2K')).toBe('/scribble/AB2K');
    expect(roomPath('template', 'AB2K')).toBe('/template/AB2K');
  });
});

describe('links from before the Scribble rename', () => {
  it('rewrites the former slug to the current one and leaves every other path alone', () => {
    expect(canonicalPath('/skribble/AB2K')).toBe('/scribble/AB2K');
    expect(canonicalPath('/Skribble/ab2k')).toBe('/scribble/ab2k');
    expect(canonicalPath('/skribble')).toBe('/scribble');
    expect(canonicalPath('/scribble/AB2K')).toBe('/scribble/AB2K');
    expect(canonicalPath('/spygame/AB2K')).toBe('/spygame/AB2K');
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('/AB2K')).toBe('/AB2K');
  });

  it('parses an old invite link like the new one', () => {
    expect(parseRoute('/skribble/ab2k')).toEqual({ kind: 'home', code: 'AB2K', game: null });
    const bare = parseRoute('/skribble');
    expect(bare.kind === 'game' && bare.game.slug).toBe('scribble');
  });

  it('replaces the address bar (no new history entry) when an old link is opened', () => {
    setLocation('/skribble/AB2K');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    refreshRoute();
    expect(window.location.pathname).toBe('/scribble/AB2K');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(useRouter.getState().route).toEqual({ kind: 'home', code: 'AB2K', game: null });
  });
});
