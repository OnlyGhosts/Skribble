/** The party rules through the pure engine: the game context a module receives, game switches, and rooms stored before the party fields existed. */
import { describe, expect, it } from 'vitest';
import { GAME_IDS, gameById } from '../../../shared/platform/games.js';
import { GAMES } from '../../games/index.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { gameCtx } from './delegate.js';
import { applyAction } from './reduce.js';
import { upgradeRoomData, type PlatformPlayerData, type PlatformRoomData, type RoomSettingsData } from './state.js';
import { AVATAR, Ids, chatTexts, ctxAt, errorsOf, readyUp, sim, startGame, type Sim } from './testHarness.js';
import { previewOf, viewFor } from './view.js';

/** Seats `names` (the first creates the room) and applies the game's test settings without starting. */
function seat(s: Sim, names: string[]): string[] {
  const ids = names.map((name, i) => {
    s.apply(i === 0 ? { type: 'create', gameId: s.data.gameId, name, avatar: AVATAR, connectionId: `conn-${name}` } : { type: 'join', name, avatar: AVATAR, connectionId: `conn-${name}` });
    return s.playerId(name);
  });
  s.platform(ids[0], { t: 'updateSettings', settings: GAME_TEST_FIXTURES[s.data.gameId].settings });
  return ids;
}

function gamePhase(s: Sim): string {
  return (s.data.game as { phase: string | { kind: string } }).phase.toString();
}

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
    // The game ended on its own clock (or by the host, where the clock never ends it): bring it back to the lobby first.
    s.now += 60 * 60_000;
    s.tick();
    const end = GAME_TEST_FIXTURES[gameId].hostEnd;
    if (end && s.data.phase === 'playing') s.game(alice, end);
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
    s.platform(alice, { t: 'updateSettings', settings: { contentMode: 'unhinged', ...GAME_TEST_FIXTURES[gameId].settings } });
    const other = GAME_IDS.find((id) => id !== gameId);
    if (!other) throw new Error('need two games');
    const effects = s.platform(alice, { t: 'selectGame', gameId: other });
    expect(s.data.gameId).toBe(other);
    expect(s.data.settings).toEqual({ allowMidGameJoin: true, contentMode: 'unhinged', ...(GAMES[other].settings.defaults as Record<string, unknown>) });
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

describe.each(GAME_IDS)('rooms stored before content modes existed (%s)', (gameId) => {
  it('read as a family room: a legacy lobby starts and a legacy game plays on to its end', () => {
    const s = sim(gameId);
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const legacySettings: Record<string, unknown> = { ...s.data.settings, maxPlayers: 8 };
    delete legacySettings.contentMode;
    const legacy: PlatformRoomData = { ...structuredClone(s.data), settings: legacySettings as RoomSettingsData };

    // Mid-game: the next round (or the game's end) comes without a content lookup failing.
    const played = applyAction(legacy, { type: 'tick' }, ctxAt(s.now + 60 * 60_000, new Ids()));
    expect(played.data.settings).toMatchObject({ contentMode: 'family', maxPlayers: 8 });
    expect(['playing', 'ended']).toContain(played.data.phase);
    expect(viewFor(played.data, alice, s.now).settings.contentMode).toBe('family');

    // A legacy lobby with everyone readied up starts.
    const lobby = structuredClone(legacy);
    lobby.phase = 'lobby';
    lobby.game = null;
    lobby.podium = null;
    for (const p of lobby.players) {
      p.participating = false;
      p.ready = true;
    }
    const started = applyAction(lobby, { type: 'platformMessage', playerId: alice, msg: { t: 'start' } }, ctxAt(s.now, new Ids()));
    expect(started.data.phase).toBe('playing');
    expect(started.data.settings.contentMode).toBe('family');
    const later = applyAction(started.data, { type: 'tick' }, ctxAt(s.now + 60 * 60_000, new Ids()));
    expect(['playing', 'ended']).toContain(later.data.phase);
  });
});

describe.each(GAME_IDS)('rooms stored while Cheeky was a content mode (%s)', (gameId) => {
  it("play as a family room: the snapshot, a running game and a fresh start all read 'family'", () => {
    const s = sim(gameId);
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const legacy: PlatformRoomData = { ...structuredClone(s.data), settings: { ...s.data.settings, contentMode: 'cheeky' } as unknown as RoomSettingsData };

    // A snapshot rendered straight from storage never hands the client a mode it does not know.
    expect(viewFor(legacy, alice, s.now).settings.contentMode).toBe('family');
    const played = applyAction(legacy, { type: 'tick' }, ctxAt(s.now + 60 * 60_000, new Ids()));
    expect(played.data.settings.contentMode).toBe('family');
    expect(['playing', 'ended']).toContain(played.data.phase);

    const lobby = structuredClone(legacy);
    lobby.phase = 'lobby';
    lobby.game = null;
    lobby.podium = null;
    for (const p of lobby.players) {
      p.participating = false;
      p.ready = true;
    }
    const started = applyAction(lobby, { type: 'platformMessage', playerId: alice, msg: { t: 'start' } }, ctxAt(s.now, new Ids()));
    expect(started.data.phase).toBe('playing');
    expect(started.data.settings.contentMode).toBe('family');
  });

  it('keep an Unhinged room unhinged', () => {
    const s = sim(gameId);
    startGame(s, ['Alice', 'Bob', 'Carol'], { contentMode: 'unhinged' });
    expect(upgradeRoomData(s.data)).toBe(s.data);
  });
});

describe.each(GAME_IDS)('rooms stored before one of the game settings existed (%s)', (gameId) => {
  it('load with that setting at its default and the rest as stored, and the game plays on', () => {
    const s = sim(gameId);
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(upgradeRoomData(s.data)).toBe(s.data);
    const defaults = GAMES[gameId].settings.defaults as Record<string, unknown>;
    for (const key of Object.keys(defaults)) {
      const settings: Record<string, unknown> = { ...s.data.settings };
      delete settings[key];
      const legacy: PlatformRoomData = { ...structuredClone(s.data), settings: settings as RoomSettingsData };
      const restored = { ...s.data.settings, [key]: defaults[key] };
      expect(viewFor(legacy, alice, s.now).settings, key).toEqual(restored);
      const played = applyAction(legacy, { type: 'tick' }, ctxAt(s.now + 60 * 60_000, new Ids()));
      expect(played.data.settings, key).toEqual(restored);
      expect(['playing', 'ended'], key).toContain(played.data.phase);
    }
  });
});

describe('a host who sits the game out', () => {
  it('still ends a Spy Game from the reveal, while their other moves stay refused', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = seat(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.platform(alice, { t: 'sitOut', sitOut: true });
    readyUp(s, [bob, carol, dave]);
    s.platform(alice, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    expect(s.data.players.find((p) => p.id === alice)?.participating).toBe(false);
    expect(errorsOf(s.game(alice, { t: 'accuse', playerId: bob }))).toEqual(['You are sitting this game out.']);

    s.advance(3 * 60_000);
    s.tick();
    expect(gamePhase(s)).toBe('reveal');
    expect(errorsOf(s.game(bob, { t: 'endGame' }))).toEqual(['Only the host can end the game.']);
    expect(chatTexts(s.game(alice, { t: 'endGame' }))).toContain('The host ended the game. Back to the lobby.');
    expect(s.data.phase).toBe('lobby');
  });

  it('still skips a Quip Game result, while their other moves stay refused', () => {
    const s = sim('quipgame');
    const [alice, bob, carol, dave] = seat(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.platform(alice, { t: 'sitOut', sitOut: true });
    readyUp(s, [bob, carol, dave]);
    s.platform(alice, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    expect(errorsOf(s.game(alice, { t: 'answer', promptId: 'r1-p0', text: 'banana' }))).toEqual(['You are sitting this game out.']);
    // The skip reaches the module, which has nothing to skip yet.
    expect(errorsOf(s.game(alice, { t: 'next' }))).toEqual(['There is no result to skip.']);

    s.advance(30_000);
    s.tick();
    s.advance(10_000);
    s.tick();
    expect(gamePhase(s)).toBe('result');
    const before = structuredClone(s.data.game);
    expect(errorsOf(s.game(bob, { t: 'next' }))).toEqual(['Only the host can skip ahead.']);
    expect(errorsOf(s.game(alice, { t: 'next' }))).toEqual([]);
    expect(s.data.game).not.toEqual(before);
  });
});

describe('start seating', () => {
  it('seats a readied player whose socket is down at that moment; they come back as a participant', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = seat(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    readyUp(s, [bob, carol, dave]);
    s.apply({ type: 'connectionClosed', playerId: carol });
    const effects = s.platform(alice, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    expect(s.data.players.find((p) => p.id === carol)).toMatchObject({ participating: true, connected: false });
    expect(chatTexts(effects)).not.toContain('Carol sits this one out');
    const token = s.data.players.find((p) => p.id === carol)?.token ?? '';
    s.apply({ type: 'rejoin', token, connectionId: 'conn-Carol-2' });
    const ctx = gameCtx({ data: s.data, effects: [], ctx: ctxAt(s.now), now: s.now });
    expect(ctx.players.map((p) => p.id)).toEqual([alice, bob, carol, dave]);
    expect(ctx.spectators).toEqual([]);
  });

  it('never starts into a hold, and a refused start leaves no mark on the host', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = seat(s, ['Alice', 'Bob', 'Carol']);
    readyUp(s, [bob, carol]);
    s.apply({ type: 'connectionClosed', playerId: carol });
    const refused = s.platform(alice, { t: 'start' });
    expect(errorsOf(refused)).toEqual(['You need at least 3 players ready to start.']);
    expect(s.data.phase).toBe('lobby');
    expect(s.data.players.find((p) => p.id === alice)?.ready).toBe(false);
  });
});

describe('the hold counts participants only', () => {
  it('reports the connected participants against the seats needed, spectators aside', () => {
    const s = sim('skribble');
    const [alice, bob, carol, dave] = seat(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.platform(carol, { t: 'sitOut', sitOut: true });
    s.platform(dave, { t: 'sitOut', sitOut: true });
    readyUp(s, [bob]);
    s.platform(alice, { t: 'start' });
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.platform(bob, { t: 'chat', text: 'apple' });
    s.apply({ type: 'connectionClosed', playerId: bob });
    s.advance(60_000);
    s.tick();
    expect(viewFor(s.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 2, connected: 1 });
  });
});

describe('joining between games', () => {
  it('lets a newcomer in on the podium even with mid-game joins off, but not while the game runs', () => {
    const s = sim('template');
    const [alice] = seat(s, ['Alice']);
    s.platform(alice, { t: 'updateSettings', settings: { allowMidGameJoin: false, targetClicks: 10 } });
    s.platform(alice, { t: 'start' });
    const during = applyAction(s.data, { type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' }, ctxAt(s.now, new Ids()));
    expect(during.result).toMatchObject({ ok: false, code: 'GAME_IN_PROGRESS' });
    expect(previewOf(s.data)).toMatchObject({ inProgress: true, joinable: false });

    for (let i = 0; i < 10; i++) s.game(alice, { t: 'click' });
    expect(s.data.phase).toBe('ended');
    expect(previewOf(s.data)).toMatchObject({ inProgress: true, joinable: true });
    const podium = structuredClone(s.data.podium);
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' });
    expect(s.data.players.find((p) => p.name === 'Bob')).toMatchObject({ participating: false, ready: false });
    expect(s.data).toMatchObject({ phase: 'ended', podium });
  });
});
