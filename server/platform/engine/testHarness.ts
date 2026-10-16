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
  apply(action: Action, ctx?: Partial<Ctx>): Effect[];
  /**
   * The player's socket drops for good: the running game hears of it at once, as it would
   * AWAY_NOTICE_MS later, without the clock moving. A blink is `apply({ type: 'connectionClosed' })`.
   */
  drop(playerId: string, connectionId?: string): Effect[];
  /** Shorthand for a platform message from `playerId`. */
  platform(playerId: string, msg: PlatformRoomMessage): Effect[];
  /** Shorthand for a game message from `playerId`. */
  game(playerId: string, msg: unknown): Effect[];
  /** Advances the clock without ticking. */
  advance(ms: number): void;
  tick(): Effect[];
  playerId(name: string): string;
}

export function sim(gameId: GameId = 'scribble', code = 'ABCD', now = START, rng: () => number = () => 0): Sim {
  const ids = new Ids();
  const s: Sim = {
    data: createRoomData(code, gameId, now),
    now,
    ids,
    effects: [],
    apply(action, ctx) {
      const out = applyAction(s.data, action, { ...ctxAt(s.now, ids, rng), ...ctx });
      expect(out.result.ok).toBe(true);
      s.data = out.data;
      s.effects.push(...out.effects);
      return out.effects;
    },
    drop(playerId, connectionId) {
      return s.apply({ type: 'connectionClosed', playerId, connectionId }, { awayNoticeMs: 0 });
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

/** Every listed player readies up for the next game (the host is ready by pressing start, but readying them too is harmless). */
export function readyUp(s: Sim, ids: string[]): void {
  for (const id of ids) s.platform(id, { t: 'ready', ready: true });
}

/**
 * Seats `names` (the first one creates the room; filler players are added up to the game's
 * minPlayers), applies the game's deterministic test settings, readies everyone and starts the game.
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
  readyUp(s, ids.slice(1));
  s.platform(host, { t: 'start' });
  return ids;
}

/** The last game's standings as `{ playerId, score, rank }` (the names and avatars left out); null while there are none. */
export function standings(s: Sim): Array<{ playerId: string; score: number; rank: number }> | null {
  return s.data.results?.entries.map(({ playerId, score, rank }) => ({ playerId, score, rank })) ?? null;
}

/** The host's End game (a platform message). */
export function endGame(s: Sim, hostId: string): Effect[] {
  return s.platform(hostId, { t: 'endGame' });
}

/** The error messages a set of effects carries, in order. */
export function errorsOf(effects: Effect[]): string[] {
  return effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'error' ? [(e.msg as { message: string }).message] : []));
}

/** The chat texts a set of effects carries, in order. */
export function chatTexts(effects: Effect[]): string[] {
  return effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'chat' ? [(e.msg as { message: { text: string } }).message.text] : []));
}

/** The notices (lines every client toasts) a set of effects carries, in order. */
export function noticeTexts(effects: Effect[]): string[] {
  return effects.flatMap((e) => {
    if (e.type !== 'send' || e.msg.t !== 'chat') return [];
    const { message } = e.msg as { message: { kind: string; text: string } };
    return message.kind === 'notice' ? [message.text] : [];
  });
}
