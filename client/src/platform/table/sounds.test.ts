import { describe, expect, it } from 'vitest';
import type { SoundSchedule } from '../lib/sound';
import { scheduleTimelineSounds } from './sounds';
import { snapTimeline, type Timeline } from './timeline';

function recorder() {
  const calls: { at: number; play: () => void }[] = [];
  const schedule: SoundSchedule = { at: (at, play) => calls.push({ at, play }), clear: () => calls.splice(0) };
  return { schedule, calls };
}

function plan(id: number, extra: Partial<Timeline<null>> = {}): Timeline<null> {
  return { ...snapTimeline<null>(id, 0), ...extra };
}

describe('scheduleTimelineSounds', () => {
  it('times a sound to every card, flip, departure and chip flight of a new table', () => {
    const { schedule, calls } = recorder();
    const heard: string[] = [];
    const next = plan(2, {
      arrivals: { a: 100, b: 250 },
      flips: { b: 400 },
      departures: { c: 50 },
      flights: [{ id: '0:x', from: 'seat:p', to: 'bet:p', amount: 5, at: 120, ms: 300 }],
    });
    scheduleTimelineSounds(schedule, plan(1, { arrivals: { a: 100 } }), next, {
      arrival: (k) => heard.push(`deal ${k}`),
      flip: (k) => heard.push(`flip ${k}`),
      departure: (k) => heard.push(`toss ${k}`),
      flight: (f) => heard.push(`chips ${f.to}`),
    });
    expect(calls.map((c) => c.at).sort((x, y) => x - y)).toEqual([50, 100, 120, 250, 400]);
    calls.forEach((c) => c.play());
    expect(heard.sort()).toEqual(['chips bet:p', 'deal a', 'deal b', 'flip b', 'toss c']);
  });

  it('on the same table, only what the new plan added', () => {
    const { schedule, calls } = recorder();
    const prev = plan(3, { arrivals: { a: 100 }, flights: [{ id: '0:x', from: 'a', to: 'b', amount: 1, at: 0, ms: 1 }] });
    const next = plan(3, { arrivals: { a: 100, b: 900 }, flights: prev.flights });
    scheduleTimelineSounds(schedule, prev, next, { arrival: () => undefined, flight: () => undefined });
    expect(calls.map((c) => c.at)).toEqual([900]);
  });

  it('plays nothing for a snap or an unchanged plan', () => {
    const { schedule, calls } = recorder();
    const prev = plan(4, { arrivals: { a: 100 } });
    scheduleTimelineSounds(schedule, prev, snapTimeline<null>(5, 0), { arrival: () => undefined });
    scheduleTimelineSounds(schedule, prev, prev, { arrival: () => undefined });
    expect(calls).toEqual([]);
  });
});
