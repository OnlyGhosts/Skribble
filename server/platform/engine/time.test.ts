import { describe, expect, it } from 'vitest';
import type { ScribbleData } from '../../games/scribble/state.js';
import type { Action } from './actions.js';
import { applyAction } from './reduce.js';
import type { PlatformRoomData } from './state.js';
import { nextDeadline, pendingDeadlines } from './time.js';
import { AVATAR, Ids, START, ctxAt, sim, startGame, type Sim } from './testHarness.js';

/** True when a tick at `now` changes the state. */
function fires(data: PlatformRoomData, now: number): boolean {
  return applyAction(data, { type: 'tick' }, ctxAt(now, new Ids())).data !== data;
}

/** Binary-searches the first instant in (lo, hi] at which a tick does something; null if none. */
function firstFiring(data: PlatformRoomData, lo: number, hi: number): number | null {
  if (!fires(data, hi)) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fires(data, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const HORIZON = 24 * 60 * 60_000;

function expectAgreement(s: Sim): void {
  const predicted = nextDeadline(s.data);
  const observed = firstFiring(s.data, s.now, s.now + HORIZON);
  expect(observed).toBe(predicted);
  if (predicted !== null) {
    expect(fires(s.data, predicted - 1)).toBe(false);
    expect(fires(s.data, predicted)).toBe(true);
  }
}

describe('nextDeadline', () => {
  it('names exactly the instant at which the next tick has an effect, scenario after scenario', () => {
    const s = sim();
    expect(nextDeadline(s.data)).toBeNull();
    expect(firstFiring(s.data, s.now, s.now + HORIZON)).toBeNull();

    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hints: 2 });
    expectAgreement(s); // choose timeout

    s.game(alice, { t: 'chooseWord', index: 0 });
    expectAgreement(s); // first hint

    // The 80 s turn reveals its two hints at 26.7 s and 53.3 s.
    s.advance(30_000);
    s.tick();
    expectAgreement(s); // second hint

    s.drop(carol);
    expectAgreement(s); // Bob has not guessed, so no all-guessed grace: still the hint

    s.drop(alice);
    expectAgreement(s); // drawer-gone grace, 20 s, beats the hint at 53.3 s

    s.apply({ type: 'rejoin', token: 'token-1', connectionId: 'a2' });
    s.apply({ type: 'rejoin', token: 'token-3', connectionId: 'c2' });
    s.platform(bob, { t: 'chat', text: 'apple' });
    expectAgreement(s); // drawing continues (Carol has not guessed); next: hint

    s.advance(55_000);
    s.tick();
    expectAgreement(s); // turnEnd -> next turn

    s.drop(bob);
    s.drop(carol);
    // Summary ends (held); then both seats expire in one tick: the first leaves two seats (still held), the second abandons the game.
    const steps: string[] = [];
    while (s.data.players.length > 1) {
      expectAgreement(s);
      s.now = nextDeadline(s.data) ?? s.now;
      s.tick();
      steps.push(s.data.game ? (s.data.game as ScribbleData).phase.kind : s.data.phase);
    }
    expect(steps).toEqual(['turnEnd', 'lobby']);
    expectAgreement(s); // nothing left but the lobby: null

    s.apply({ type: 'leave', playerId: alice });
    expectAgreement(s); // empty-room TTL
  });

  it('lists a held turn boundary as having no deadline of its own', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 3 });
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.platform(bob, { t: 'chat', text: 'apple' });
    expect((s.data.game as ScribbleData).phase.kind).toBe('turnEnd');
    s.drop(bob);
    s.now = nextDeadline(s.data) ?? s.now; // the summary ends while Bob is in grace
    s.tick();
    expect((s.data.game as ScribbleData).phase).toMatchObject({ kind: 'turnEnd', held: true });
    expect(pendingDeadlines(s.data).map((d) => d.kind)).toEqual(['reconnectExpiry']);
    expectAgreement(s);

    // A newcomer only watches, so the hold goes on; Bob coming back ends it.
    const join: Action = { type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' };
    s.apply(join);
    expect((s.data.game as ScribbleData).phase).toMatchObject({ kind: 'turnEnd', held: true });
    expectAgreement(s);
    s.apply({ type: 'rejoin', token: s.data.players.find((p) => p.id === bob)?.token ?? '', connectionId: 'b2' });
    expect((s.data.game as ScribbleData).phase.kind).toBe('choosing');
    expectAgreement(s);
    expect(s.now).toBeGreaterThan(START);
  });

  it('agrees for a Click Race too', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 20 });
    expectAgreement(s); // the race deadline
    s.drop(bob);
    expectAgreement(s); // a disconnect schedules nothing before the race (the seat expiry is far later)
    s.apply({ type: 'rejoin', token: 'token-2', connectionId: 'b2' });
    expectAgreement(s); // still the race deadline
    s.game(alice, { t: 'click' });
    s.now = nextDeadline(s.data) ?? s.now;
    s.tick();
    expect(s.data.phase).toBe('lobby');
    expectAgreement(s); // nothing scheduled in the lobby after it
  });
});
