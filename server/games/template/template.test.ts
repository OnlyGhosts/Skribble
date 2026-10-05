/** Click Race through the pure engine: the template every new game's tests can copy. */
import { describe, expect, it } from 'vitest';
import type { TemplateView } from '../../../shared/games/template/protocol.js';
import type { PlatformServerMessageOf } from '../../../shared/platform/protocol.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, sim, startGame } from '../../platform/engine/testHarness.js';
import { templateModule, type TemplateData } from './module.js';

const view = (s: { data: Parameters<typeof viewFor>[0]; now: number }, viewer: string | null = null): TemplateView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as TemplateView;
};

const snapshots = (effects: Effect[]): number => effects.filter((e) => e.type === 'send' && e.msg.t === 'room').length;

describe('Click Race', () => {
  it('starts everyone at zero with a deadline and snapshots the room', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 30, targetClicks: 10 });
    expect(s.data.phase).toBe('playing');
    expect(s.data.game).toEqual({ clicks: { [alice]: 0, [bob]: 0 }, endsAt: START + 30_000, winnerId: null, over: false });
    expect(view(s)).toEqual({ clicks: { [alice]: 0, [bob]: 0 }, endsAt: START + 30_000, winnerId: null });
    expect(nextDeadline(s.data)).toBe(START + 30_000);
    const last = s.effects.filter((e): e is Extract<Effect, { type: 'send' }> => e.type === 'send' && e.msg.t === 'room').at(-1);
    expect((last?.msg as PlatformServerMessageOf<'room'>).room.game).toEqual(view(s));
  });

  it('counts clicks per player and tells everyone', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    const effects = s.game(alice, { t: 'click' });
    expect(snapshots(effects)).toBe(2);
    s.game(alice, { t: 'click' });
    s.game(bob, { t: 'click' });
    expect(view(s).clicks).toEqual({ [alice]: 2, [bob]: 1 });
    expect(s.data.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('ends the race when someone reaches the target: +100 for the winner, +clicks for everyone else', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    for (let i = 0; i < 4; i++) s.game(bob, { t: 'click' });
    for (let i = 0; i < 9; i++) s.game(alice, { t: 'click' });
    expect(s.data.phase).toBe('playing');
    const effects = s.game(alice, { t: 'click' });
    expect(s.data.phase).toBe('ended');
    expect(view(s)).toMatchObject({ winnerId: alice, clicks: { [alice]: 10, [bob]: 4 } });
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 100, rank: 1 },
      { playerId: bob, score: 4, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 100 points.']);
    expect(nextDeadline(s.data)).toBeNull();
    // Clicks after the finish are refused by the platform: the game is not running.
    const late = s.game(bob, { t: 'click' });
    expect(late).toEqual([{ type: 'send', to: [bob], msg: { t: 'error', code: 'NOT_ALLOWED', message: 'The game is not running.' } }]);
  });

  it('ends at the time limit with everyone scoring their clicks', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 15, targetClicks: 100 });
    for (let i = 0; i < 5; i++) s.game(bob, { t: 'click' });
    s.now += 15_000;
    s.tick();
    expect(s.data.phase).toBe('ended');
    expect(view(s).winnerId).toBeNull();
    expect(s.data.podium).toEqual([
      { playerId: bob, score: 5, rank: 1 },
      { playerId: alice, score: 0, rank: 2 },
    ]);
  });

  it('seats mid-game joiners at zero clicks', () => {
    const s = sim('template');
    const [alice] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    s.game(alice, { t: 'click' });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s).clicks[carol]).toBe(0);
    s.game(carol, { t: 'click' });
    expect(view(s).clicks).toMatchObject({ [alice]: 1, [carol]: 1 });
    // Leaving mid-race keeps the others going; the leaver's clicks stay in the tally for the view.
    s.apply({ type: 'leave', playerId: carol });
    expect(s.data.phase).toBe('playing');
  });

  it('is a pure module: the same object comes back when nothing changed', () => {
    const data: TemplateData = { clicks: { a: 1 }, endsAt: 1000, winnerId: null, over: false };
    const ctx = { now: 500, rng: () => 0, newId: () => 'x', settings: templateModule.settings.defaults, players: [{ id: 'a', name: 'A', joinOrder: 0, connected: true, score: 0 }], hostId: 'a' };
    expect(templateModule.handle(ctx, data, { type: 'tick' }).data).toBe(data);
    expect(templateModule.handle(ctx, data, { type: 'chat', playerId: 'a', text: 'hi' }).data).toBe(data);
    const clicked = templateModule.handle(ctx, data, { type: 'message', playerId: 'a', msg: { t: 'click' } });
    expect(clicked.data).not.toBe(data);
    expect(data.clicks.a).toBe(1);
    expect(templateModule.view(data, 'a', { ...ctx })).toEqual({ clicks: { a: 1 }, endsAt: 1000, winnerId: null });
  });
});
