import { describe, expect, it } from 'vitest';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { parseRoute, routeCode, roomPath } = await import('./router');

describe('parseRoute', () => {
  it('maps the root to the front door without a code', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home', code: null, game: null });
    expect(routeCode(parseRoute('/'))).toBeNull();
  });

  it('sends a bare game slug (the old per-game landing page) to the redirect', () => {
    const route = parseRoute('/skribble');
    expect(route.kind === 'game' && route.game.id).toBe('skribble');
    expect(routeCode(route)).toBeNull();
    const hidden = parseRoute('/template/');
    expect(hidden.kind === 'game' && hidden.game.id).toBe('template');
  });

  it('opens the front door with the code of an invite link, normalising its case', () => {
    expect(parseRoute('/skribble/ab2k')).toEqual({ kind: 'home', code: 'AB2K', game: null });
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
    expect(parseRoute('/skribble/nope').kind).toBe('unknown');
    expect(parseRoute('/skribble/AB2K/extra').kind).toBe('unknown');
  });

  it('builds the in-room path, which is also the invite link', () => {
    expect(roomPath('skribble', 'AB2K')).toBe('/skribble/AB2K');
    expect(roomPath('template', 'AB2K')).toBe('/template/AB2K');
  });
});
