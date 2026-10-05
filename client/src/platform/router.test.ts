import { describe, expect, it } from 'vitest';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { parseRoute, routeCode, roomPath, gamePath } = await import('./router');

describe('parseRoute', () => {
  it('maps the root to the library and a game slug to its home', () => {
    expect(parseRoute('/')).toEqual({ kind: 'library' });
    const home = parseRoute('/skribble');
    expect(home.kind === 'game' && home.game.id).toBe('skribble');
    expect(routeCode(home)).toBeNull();
    const hidden = parseRoute('/template/');
    expect(hidden.kind === 'game' && hidden.game.id).toBe('template');
  });

  it('reads a room code after the slug, normalising its case', () => {
    const route = parseRoute('/skribble/ab2k');
    expect(route.kind).toBe('game');
    expect(routeCode(route)).toBe('AB2K');
  });

  it('treats a bare code (path or ?room=) as a legacy link to resolve', () => {
    expect(parseRoute('/AB2K')).toEqual({ kind: 'code', code: 'AB2K' });
    expect(parseRoute('/', '?room=ab2k')).toEqual({ kind: 'code', code: 'AB2K' });
  });

  it('rejects codes with look-alike letters and unknown paths', () => {
    expect(parseRoute('/ABIL').kind).toBe('unknown');
    expect(parseRoute('/nope').kind).toBe('unknown');
    expect(parseRoute('/skribble/nope').kind).toBe('unknown');
    expect(parseRoute('/skribble/AB2K/extra').kind).toBe('unknown');
  });

  it('builds the paths the app navigates to', () => {
    expect(gamePath('skribble')).toBe('/skribble');
    expect(roomPath('template', 'AB2K')).toBe('/template/AB2K');
  });
});
