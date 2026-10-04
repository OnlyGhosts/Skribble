/** Deterministic helpers for engine tests: counter-based ids, rng () => 0, explicit clocks. */
import { expect } from 'vitest';
import type { Avatar } from '../../shared/avatar';
import type { Action, Ctx } from './actions';
import type { Effect } from './effects';
import { applyAction } from './reduce';
import { createRoomData, type RoomData } from './state';

export const START = new Date('2026-01-01T12:00:00Z').getTime();
export const AVATAR: Avatar = { color: 0, emoji: 0 };
/** Ten custom words so `customWordsOnly` is honoured; with rng () => 0 they are picked in this order. */
export const TEST_WORDS = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'guitar', 'hammer', 'island', 'jacket'];

/** Ids and tokens come from counters, so the same sequence of actions always yields the same state. */
export class Ids {
  private n = 0;
  readonly newId = (): string => `player-${++this.n}`;
  readonly newToken = (): string => `token-${this.n}`;
}

export function ctxAt(now: number, ids = new Ids(), rng: () => number = () => 0): Ctx {
  return { now, rng, newId: ids.newId, newToken: ids.newToken };
}

export interface Sim {
  data: RoomData;
  now: number;
  ids: Ids;
  effects: Effect[];
  /** Applies an action at the current time; returns the effects of that action. */
  apply(action: Action): Effect[];
  /** Advances the clock without ticking. */
  advance(ms: number): void;
  tick(): Effect[];
  playerId(name: string): string;
}

export function sim(code = 'ABCD', now = START, rng: () => number = () => 0): Sim {
  const ids = new Ids();
  const s: Sim = {
    data: createRoomData(code, now),
    now,
    ids,
    effects: [],
    apply(action) {
      const out = applyAction(s.data, action, ctxAt(s.now, ids, rng));
      expect(out.result.ok).toBe(true);
      s.data = out.data;
      s.effects.push(...out.effects);
      return out.effects;
    },
    advance(ms) {
      s.now += ms;
    },
    tick() {
      return s.apply({ type: 'tick' });
    },
    playerId(name) {
      const p = s.data.players.find((x) => x.name === name);
      if (!p) throw new Error(`no player ${name}`);
      return p.id;
    },
  };
  return s;
}

/** Seats `names` (the first one creates the room), applies deterministic settings and starts the game. */
export function startGame(s: Sim, names: string[], settings: Record<string, unknown> = {}): string[] {
  const ids = names.map((name, i) => {
    s.apply(i === 0 ? { type: 'create', name, avatar: AVATAR, connectionId: `conn-${name}` } : { type: 'join', name, avatar: AVATAR, connectionId: `conn-${name}` });
    return s.playerId(name);
  });
  const host = ids[0];
  s.apply({
    type: 'clientMessage',
    playerId: host,
    msg: { t: 'updateSettings', settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1, drawTime: 60, hints: 2, wordChoices: 3, ...settings } },
  });
  s.apply({ type: 'clientMessage', playerId: host, msg: { t: 'start' } });
  return ids;
}
