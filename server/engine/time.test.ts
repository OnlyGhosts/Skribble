import { describe, expect, it } from 'vitest';
import type { Action } from './actions.js';
import { applyAction } from './reduce.js';
import type { RoomData } from './state.js';
import { nextDeadline, pendingDeadlines } from './time.js';
import { AVATAR, Ids, START, ctxAt, sim, startGame, type Sim } from './testHarness.js';

/** True when a tick at `now` changes the state. */
function fires(data: RoomData, now: number): boolean {
  return applyAction(data, { type: 'tick' }, ctxAt(now, new Ids())).data !== data;
}

/** Binary-searches the first instant in (lo, hi] at which a tick does something; null if none. */
function firstFiring(data: RoomData, lo: number, hi: number): number | null {
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

    s.apply({ type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    expectAgreement(s); // first hint

    s.advance(25_000);
    s.tick();
    expectAgreement(s); // second hint

    s.apply({ type: 'connectionClosed', playerId: carol });
    expectAgreement(s); // Bob has not guessed, so no all-guessed grace: still the hint

    s.apply({ type: 'connectionClosed', playerId: alice });
    expectAgreement(s); // drawer-gone grace, 10 s, beats the hint at 40 s

    s.apply({ type: 'rejoin', token: 'token-1', connectionId: 'a2' });
    s.apply({ type: 'rejoin', token: 'token-3', connectionId: 'c2' });
    s.apply({ type: 'clientMessage', playerId: bob, msg: { t: 'chat', text: 'apple' } });
    expectAgreement(s); // drawing continues (Carol has not guessed); next: hint

    s.advance(40_000);
    s.tick();
    expectAgreement(s); // turnEnd -> next turn

    s.apply({ type: 'connectionClosed', playerId: bob });
    s.apply({ type: 'connectionClosed', playerId: carol });
    // Summary ends (held), low-player grace (lobby), both seats expire in one tick.
    const steps: string[] = [];
    while (s.data.players.length > 1) {
      expectAgreement(s);
      s.now = nextDeadline(s.data) ?? s.now;
      s.tick();
      steps.push(s.data.phase.kind);
    }
    expect(steps).toEqual(['turnEnd', 'lobby', 'lobby']);
    expectAgreement(s); // nothing left but the lobby: null

    s.apply({ type: 'leave', playerId: alice });
    expectAgreement(s); // empty-room TTL
  });

  it('lists a held turn boundary as having no deadline of its own', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 3 });
    s.apply({ type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    s.apply({ type: 'clientMessage', playerId: bob, msg: { t: 'chat', text: 'apple' } });
    expect(s.data.phase.kind).toBe('turnEnd');
    s.apply({ type: 'connectionClosed', playerId: bob });
    s.now = nextDeadline(s.data) ?? s.now; // the summary ends while Bob is in grace
    s.tick();
    expect(s.data.phase).toMatchObject({ kind: 'turnEnd', held: true });
    expect(pendingDeadlines(s.data).map((d) => d.kind)).toEqual(['lowPlayers', 'reconnectExpiry']);
    expectAgreement(s);

    const join: Action = { type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' };
    s.apply(join);
    expect(s.data.phase.kind).toBe('choosing');
    expectAgreement(s);
    expect(s.now).toBeGreaterThan(START);
  });
});
