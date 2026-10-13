/** The party rules through the pure engine: the game context a module receives, game switches, and rooms stored before the party fields existed. */
import { describe, expect, it } from 'vitest';
import { GAME_IDS, gameById } from '../../../shared/platform/games.js';
import { GAMES } from '../../games/index.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { gameCtx } from './delegate.js';
import { applyAction } from './reduce.js';
import type { PlatformPlayerData, PlatformRoomData } from './state.js';
import { AVATAR, Ids, chatTexts, ctxAt, readyUp, sim, startGame } from './testHarness.js';

describe.each(GAME_IDS)('party (%s)', (gameId) => {
  it('hands the game its participants as players and the rest as spectators', () => {
    const s = sim(gameId);
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    // A fourth player who joined before the start without readying up, and a fifth who joined during the game.
    const ctx = gameCtx({ data: s.data, effects: [], ctx: ctxAt(s.now), now: s.now });
    expect(ctx.players.map((p) => p.id)).toEqual(s.data.players.map((p) => p.id));
    expect(ctx.spectators).toEqual([]);
    expect(ctx.settings).toMatchObject({ allowMidGameJoin: true, contentMode: 'family' });

    s.apply({ type: 'platformMessage', playerId: alice, msg: { t: 'returnToLobby' } });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    s.apply({ type: 'platformMessage', playerId: dave, msg: { t: 'sitOut', sitOut: true } });
    // The game ended on its own clock: bring it back to the lobby first.
    s.now += 60 * 60_000;
    s.tick();
    if (s.data.phase === 'ended') s.platform(alice, { t: 'returnToLobby' });
    readyUp(s, s.data.players.map((p) => p.id).filter((id) => id !== dave));
    s.platform(alice, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    const after = gameCtx({ data: s.data, effects: [], ctx: ctxAt(s.now), now: s.now });
    expect(after.players.map((p) => p.id)).not.toContain(dave);
    expect(after.players.map((p) => p.id)).toContain(bob);
    expect(after.spectators).toEqual([{ id: dave, name: 'Dave', connected: true }]);
    s.apply({ type: 'connectionClosed', playerId: dave });
    expect(gameCtx({ data: s.data, effects: [], ctx: ctxAt(s.now), now: s.now }).spectators).toEqual([{ id: dave, name: 'Dave', connected: false }]);
  });

  it('switches the game through the reducer, keeping the platform settings and resetting the game settings', () => {
    const s = sim(gameId);
    s.apply({ type: 'create', gameId, name: 'Alice', avatar: AVATAR, connectionId: 'a' });
    const alice = s.playerId('Alice');
    s.platform(alice, { t: 'updateSettings', settings: { contentMode: 'cheeky', ...GAME_TEST_FIXTURES[gameId].settings } });
    const other = GAME_IDS.find((id) => id !== gameId);
    if (!other) throw new Error('need two games');
    const effects = s.platform(alice, { t: 'selectGame', gameId: other });
    expect(s.data.gameId).toBe(other);
    expect(s.data.settings).toEqual({ allowMidGameJoin: true, contentMode: 'cheeky', ...(GAMES[other].settings.defaults as Record<string, unknown>) });
    expect(chatTexts(effects)).toEqual([`Host switched the party to ${gameById(other).name}`]);
    // A game with a side store leaves nothing behind for the next game.
    expect(effects.some((e) => e.type === 'side')).toBe(GAMES[gameId].createSideStore !== undefined);
  });
});

describe('rooms stored before the party fields existed', () => {
  it('load with ready, sit-out and participating filled in, and keep their retired settings keys harmlessly', () => {
    const s = sim('quipgame');
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const legacy = structuredClone(s.data) as PlatformRoomData & { settings: Record<string, unknown> };
    legacy.settings = { ...legacy.settings, cheeky: true, maxPlayers: 8 };
    for (const p of legacy.players as Array<Partial<PlatformPlayerData>>) {
      delete p.ready;
      delete p.sittingOut;
      delete p.participating;
    }
    // A running game: every seat is in it.
    const ticked = applyAction(legacy, { type: 'tick' }, ctxAt(s.now, new Ids()));
    expect(ticked.data.players.every((p) => p.ready === false && p.sittingOut === false && p.participating === true)).toBe(true);
    expect(ticked.data.settings).toMatchObject({ cheeky: true, maxPlayers: 8, contentMode: 'family' });
    // Snapshots render the flags; the game keeps running on the same prompts.
    const chat = applyAction(ticked.data, { type: 'platformMessage', playerId: alice, msg: { t: 'chat', text: 'hi' } }, ctxAt(s.now, new Ids()));
    expect(chat.data.phase).toBe('playing');

    // A legacy lobby: nobody is in a game.
    const lobby = structuredClone(legacy);
    lobby.phase = 'lobby';
    lobby.game = null;
    const loaded = applyAction(lobby, { type: 'tick' }, ctxAt(s.now, new Ids()));
    expect(loaded.data.players.every((p) => p.participating === false)).toBe(true);
  });
});
