import { describe, expect, it } from 'vitest';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { parsePreview } = await import('./useRoomPreview');

const wire = (gameId: unknown) => ({ exists: true, code: 'AB2K', gameId, players: 3, maxPlayers: 8, inProgress: true, joinable: true });

describe('parsePreview', () => {
  it('keeps a current game id and the counts', () => {
    expect(parsePreview(wire('scribble'))).toEqual({ exists: true, gameId: 'scribble', players: 3, maxPlayers: 8, inProgress: true, joinable: true });
    expect(parsePreview({ exists: false, code: 'AB2K', reason: 'ROOM_NOT_FOUND' })).toEqual({ exists: false });
  });

  it('reads a former game id from a server on the deploy before a rename as the current one', () => {
    // 'skribble' is Scribble's pre-rename id: a server not yet redeployed still sends it.
    expect(parsePreview(wire('skribble'))).toMatchObject({ exists: true, gameId: 'scribble' });
  });

  it('treats an unknown game id as no preview', () => {
    for (const id of ['chess', 'Skribble', '__proto__', 5, null]) expect(parsePreview(wire(id)), String(id)).toBeNull();
  });
});
