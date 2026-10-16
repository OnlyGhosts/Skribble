/** Presence: a dropped socket reaches the game only after AWAY_NOTICE_MS, a silent one shows idle, and resent messages apply once. */
import { describe, expect, it } from 'vitest';
import { AWAY_NOTICE_MS } from '../../../shared/platform/constants.js';
import type { RoomState } from '../../../shared/platform/protocol.js';
import { platformPlayers } from './players.js';
import { pendingDeadlines } from './time.js';
import { chatTexts, sim, startGame, type Sim } from './testHarness.js';
import { viewFor } from './view.js';

const shown = (s: Sim, id: string) => viewFor(s.data, null, s.now).players.find((p) => p.id === id);
const forGame = (s: Sim, id: string) => platformPlayers(s.data).find((p) => p.id === id);
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const snapshots = (effects: ReturnType<Sim['apply']>): RoomState[] =>
  effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'room' ? [(e.msg as { room: RoomState }).room] : []));

describe('a dropped socket during a game', () => {
  it('shows the player away at once but lets the game count them as connected until AWAY_NOTICE_MS has passed', () => {
    const s = sim('template');
    const [, bob] = startGame(s, ['Alice', 'Bob']);
    const dropped = s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    expect(shown(s, bob)?.connected).toBe(false);
    expect(snapshots(dropped).every((r) => r.players.find((p) => p.id === bob)?.connected === false)).toBe(true);
    expect(forGame(s, bob)?.connected).toBe(true);
    expect(pendingDeadlines(s.data)).toContainEqual({ kind: 'awayNotice', at: s.now + AWAY_NOTICE_MS, playerId: bob });

    s.advance(AWAY_NOTICE_MS - 1);
    s.tick();
    expect(forGame(s, bob)?.connected).toBe(true);
    s.advance(1);
    const noticed = s.tick();
    expect(forGame(s, bob)?.connected).toBe(false);
    expect(pendingDeadlines(s.data).some((d) => d.kind === 'awayNotice')).toBe(false);
    // Everyone gets the table the game now plays without them.
    expect(snapshots(noticed).length).toBeGreaterThan(0);
  });

  it('is a non-event for the game when the player is back within AWAY_NOTICE_MS', () => {
    const s = sim('template');
    const [, bob] = startGame(s, ['Alice', 'Bob']);
    const before = s.data.game;
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    s.advance(AWAY_NOTICE_MS / 2);
    s.apply({ type: 'rejoin', token: token(s, bob), connectionId: 'conn-Bob-2' });
    expect(shown(s, bob)?.connected).toBe(true);
    expect(forGame(s, bob)?.connected).toBe(true);
    expect(pendingDeadlines(s.data).some((d) => d.kind === 'awayNotice')).toBe(false);
    s.advance(AWAY_NOTICE_MS);
    s.tick();
    expect(s.data.game).toEqual(before);
  });

  it('sets no notice in the lobby: there is no game to tell', () => {
    const s = sim('template');
    s.apply({ type: 'create', gameId: 'template', name: 'Alice', avatar: { color: 0, emoji: 0 }, connectionId: 'conn-Alice' });
    s.apply({ type: 'join', name: 'Bob', avatar: { color: 0, emoji: 0 }, connectionId: 'conn-Bob' });
    const bob = s.playerId('Bob');
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    expect(pendingDeadlines(s.data).map((d) => d.kind)).toEqual(['reconnectExpiry']);
  });
});

describe('an idle connection', () => {
  it('shows the player idle to everyone and to the game, and clears it when they speak or drop', () => {
    const s = sim('template');
    const [, bob] = startGame(s, ['Alice', 'Bob']);
    const effects = s.apply({ type: 'activity', playerId: bob, connectionId: 'conn-Bob', idle: true });
    expect(snapshots(effects).length).toBeGreaterThan(0);
    expect(shown(s, bob)?.idle).toBe(true);
    expect(forGame(s, bob)?.idle).toBe(true);
    // A connection that no longer holds the seat says nothing about it.
    s.apply({ type: 'activity', playerId: bob, connectionId: 'conn-old', idle: false });
    expect(shown(s, bob)?.idle).toBe(true);
    s.apply({ type: 'activity', playerId: bob, connectionId: 'conn-Bob', idle: false });
    expect(shown(s, bob)?.idle).toBe(false);
    s.apply({ type: 'activity', playerId: bob, connectionId: 'conn-Bob', idle: true });
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    expect(shown(s, bob)?.idle).toBe(false);
  });
});

describe('client sequence numbers', () => {
  it('apply each numbered message once and leave unnumbered ones alone', () => {
    const s = sim('template');
    s.apply({ type: 'create', gameId: 'template', name: 'Alice', avatar: { color: 0, emoji: 0 }, connectionId: 'conn-Alice' });
    const alice = s.playerId('Alice');
    const say = (text: string, seq?: number) => chatTexts(s.apply({ type: 'platformMessage', playerId: alice, msg: { t: 'chat', text }, seq }));
    expect(say('a', 1)).toEqual(['a']);
    expect(say('a', 1)).toEqual([]);
    expect(say('plain')).toEqual(['plain']);
    expect(say('b', 4)).toEqual(['b']);
    expect(say('late', 3)).toEqual([]);
    expect(s.data.players[0].lastSeq).toBe(4);
  });
});
