/**
 * The card table's sounds: the shared files (cards, chips, knocks) and the bridge that plays a
 * sound for every moment a newly planned timeline adds, at the moment the table shows it.
 */
import type { SoundSchedule } from '../lib/sound';
import type { Flight, Timeline } from './timeline';

export const TABLE_FILES = {
  deal: ['table/deal-1', 'table/deal-2', 'table/deal-3'],
  flip: 'table/flip',
  place: ['table/place-1', 'table/place-2'],
  toss: 'table/toss',
  shuffle: 'table/shuffle',
  chipLay: ['table/chip-lay-1', 'table/chip-lay-2'],
  chips: ['table/chips-1', 'table/chips-2'],
  collect: 'table/collect',
  pushAll: 'table/push-all',
  knock: 'table/knock',
  thud: 'table/thud',
} as const;

/** What each kind of moment sounds like; leave one out for silence. Each runs at its moment. */
export interface TimelineSounds {
  arrival?(key: string): void;
  /**
   * The least time, in ms, from the last card sound to this card's: a card closer than that lands
   * without one (a big table's quick deal is a riffle, not a roar). None by default.
   */
  arrivalGapMs?(key: string): number;
  flip?(key: string): void;
  departure?(key: string): void;
  flight?(flight: Flight): void;
}

function fresh(next: Record<string, number>, prev: Record<string, number>, same: boolean): [string, number][] {
  return Object.entries(next).filter(([key, at]) => !same || prev[key] !== at);
}

/**
 * Schedules a sound for every moment `next` plans that `prev` had not: a plan of the same table
 * carries the earlier moments over, and those already have theirs. A snap plans nothing.
 */
export function scheduleTimelineSounds<T>(schedule: SoundSchedule, prev: Timeline<T>, next: Timeline<T>, sounds: TimelineSounds): void {
  if (next === prev) return;
  const same = next.id !== null && next.id === prev.id;
  const { arrival, arrivalGapMs, flip, departure, flight } = sounds;
  if (arrival) {
    let last = -Infinity;
    for (const [key, at] of fresh(next.arrivals, prev.arrivals, same).sort((a, b) => a[1] - b[1])) {
      if (arrivalGapMs && at - last < arrivalGapMs(key)) continue;
      last = at;
      schedule.at(at, () => arrival(key));
    }
  }
  if (flip) for (const [key, at] of fresh(next.flips, prev.flips, same)) schedule.at(at, () => flip(key));
  if (departure) for (const [key, at] of fresh(next.departures, prev.departures, same)) schedule.at(at, () => departure(key));
  if (flight) {
    const known = new Set(same ? prev.flights.map((f) => f.id) : []);
    for (const f of next.flights) if (!known.has(f.id)) schedule.at(f.at, () => flight(f));
  }
}
