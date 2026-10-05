/** Deterministic helpers for engine tests: counter-based ids, rng () => 0, explicit clocks. */
import { expect } from 'vitest';
import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import { GAME_TEST_FIXTURES, TEST_WORDS, enoughNames } from '../../games/testFixtures.js';
import type { PlatformRoomMessage } from '../drivers/types.js';
import type { Action, Ctx } from './actions.js';
import type { Effect } from './effects.js';
import { applyAction } from './reduce.js';
import { createRoomData, type PlatformRoomData } from './state.js';

export const START = new Date('2026-01-01T12:00:00Z').getTime();
export const AVATAR: Avatar = { color: 0, emoji: 0 };
export { TEST_WORDS };

/** Ids and tokens come from counters, so the same sequence of actions always yields the same state. */
export class Ids {
  private n = 0;
  readonly newId = (): string => `id-${++this.n}`;
  readonly newToken = (): string => `token-${this.n}`;
}

export function ctxAt(now: number, ids = new Ids(), rng: () => number = () => 0): Ctx {
  return { now, rng, newId: ids.newId, newToken: ids.newToken };
}

export interface Sim {
  data: PlatformRoomData;
  now: number;
  ids: Ids;
  effects: Effect[];
  /** Applies an action at the current time; returns the effects of that action. */
  apply(action: Action): Effect[];
  /** Shorthand for a platform message from `playerId`. */
  platform(playerId: string, msg: PlatformRoomMessage): Effect[];
  /** Shorthand for a game message from `playerId`. */
  game(playerId: string, msg: unknown): Effect[];
  /** Advances the clock without ticking. */
  advance(ms: number): void;
  tick(): Effect[];
  playerId(name: string): string;
}

export function sim(gameId: GameId = 'skribble', code = 'ABCD', now = START, rng: () => number = () => 0): Sim {
  const ids = new Ids();
  const s: Sim = {
    data: createRoomData(code, gameId, now),
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
    platform(playerId, msg) {
      return s.apply({ type: 'platformMessage', playerId, msg });
    },
    game(playerId, msg) {
      return s.apply({ type: 'gameMessage', playerId, msg });
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

/**
 * Seats `names` (the first one creates the room; filler players are added up to the game's
 * minPlayers), applies the game's deterministic test settings and starts the game.
 */
export function startGame(s: Sim, names: string[], settings: Record<string, unknown> = {}): string[] {
  const ids = enoughNames(s.data.gameId, names).map((name, i) => {
    s.apply(
      i === 0
        ? { type: 'create', gameId: s.data.gameId, name, avatar: AVATAR, connectionId: `conn-${name}` }
        : { type: 'join', name, avatar: AVATAR, connectionId: `conn-${name}` },
    );
    return s.playerId(name);
  });
  const host = ids[0];
  s.platform(host, { t: 'updateSettings', settings: { ...GAME_TEST_FIXTURES[s.data.gameId].settings, ...settings } });
  s.platform(host, { t: 'start' });
  return ids;
}

/** The chat texts a set of effects carries, in order. */
export function chatTexts(effects: Effect[]): string[] {
  return effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'chat' ? [(e.msg as { message: { text: string } }).message.text] : []));
}
