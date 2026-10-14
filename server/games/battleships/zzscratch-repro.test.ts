import { describe, expect, it } from 'vitest';
import { startGame } from '../../platform/engine/testHarness.js';
import { placeAll, rollOf, steerable, view } from './testHarness.js';
import type { Effect } from '../../platform/engine/effects.js';

function roomSends(effects: Effect[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of effects) {
    if (e.type === 'send' && (e.msg as { t: string }).t === 'room' && Array.isArray(e.to)) {
      for (const id of e.to) out[id] = (out[id] ?? 0) + 1;
    }
  }
  return out;
}

describe('repro', () => {
  it('plan snapshots go to opponents', () => {
    const { s, set } = steerable();
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams', moveOrFire: true });
    set(rollOf(4));
    placeAll(s, [alice, bob]);
    const teamOf = (id: string) => view(s, id).myBoard?.sideId;
    console.log('teams', { alice: teamOf(alice), bob: teamOf(bob), carol: teamOf(carol), dave: teamOf(dave) });
    console.log('turn', view(s, alice).turn);
    const bobBefore = JSON.stringify(view(s, bob));
    const plans = [
      { shipId: 's0', move: null },
      { shipId: 's0', move: { kind: 'shift', direction: 'down', steps: 1 } },
      { shipId: 's0', move: { kind: 'shift', direction: 'down', steps: 2 } },
    ];
    for (const plan of plans) {
      const eff = s.game(alice, { t: 'plan', plan });
      const sends = roomSends(eff);
      console.log('plan', JSON.stringify(plan.move), 'room sends:', JSON.stringify({ alice: sends[alice] ?? 0, bob: sends[bob] ?? 0, carol: sends[carol] ?? 0, dave: sends[dave] ?? 0 }));
      const bobMsg = eff.find((e) => e.type === 'send' && Array.isArray(e.to) && e.to[0] === bob);
      console.log('bob view identical to before?', bobMsg && bobMsg.type === 'send' ? JSON.stringify((bobMsg.msg as { room: { game: unknown } }).room.game) === bobBefore : 'none');
    }
    expect(true).toBe(true);
  });
});
