/**
 * The real server, killed mid-game and started again with the same key: every game's phones come
 * back to the same seats, scores, chips and turn, and play on to the end. Once with SIGKILL (only
 * the last checkpoint sent survives) and once with SIGTERM, a deploy (a fresh one goes out first).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_RESTARTING, type RoomState } from '../../../shared/platform/protocol.js';
import type { PlatformRoomData } from '../engine/state.js';
import { viewFor } from '../engine/view.js';
import { Phone, ServerProcess, freePort, sleep, until, type Exit } from './restartHarness.js';
import {
  blackjackAfterSplit,
  blackjackMidBets,
  blackjackMidResults,
  pokerMidHand,
  quipMidVoting,
  quipMidWriting,
  scribbleMidDrawing,
  spyMidQuestions,
  spyMidVote,
  templateMidRace,
  type Scenario,
} from './restartScenarios.js';
import { openCheckpoint } from './seal.js';

const KEY = randomBytes(32);
/** How long the server stays down: long enough that a clock not moved on would show it. */
const DOWNTIME_MS = 3000;
/** Time a deadline may lose to the reconnects themselves. */
const SLACK_MS = 1500;
const DAY_MS = 24 * 60 * 60_000;

const SCENARIOS = [
  'Scribble mid-drawing',
  'Spy mid-questions',
  'Spy mid-vote',
  'Quip mid-writing',
  'Quip mid-voting',
  'Blackjack mid-bets',
  'Blackjack mid-turn after a split',
  'Blackjack mid-results',
  'Poker mid-hand',
  'Click Race mid-race',
];

/** A value with every epoch time replaced, for comparing rooms across a restart. */
function untimed(value: unknown, around: number): unknown {
  if (typeof value === 'number') return Math.abs(value - around) < DAY_MS ? 'time' : value;
  if (Array.isArray(value)) return value.map((v: unknown) => untimed(v, around));
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, untimed(v, around)]));
  return value;
}

function comparable(room: RoomState, around: number): unknown {
  return untimed({ ...room, serverTime: 0 }, around);
}

/** Every deadline still ahead at `killAt` in `before`, with the same field in `after`. */
function deadlines(before: unknown, after: unknown, killAt: number, path = ''): Array<{ path: string; before: number; after: number }> {
  if (typeof before === 'number' && typeof after === 'number') return before > killAt && before - killAt < DAY_MS ? [{ path, before, after }] : [];
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(b).flatMap((k) => deadlines(b[k], a[k], killAt, `${path}.${k}`));
}

/** The host's latest checkpoint shows the room exactly as the host's phone does. */
function checkpointIsCurrent(s: Scenario): boolean {
  const host = s.phones[0];
  const room = host.room;
  if (!room || host.checkpoint === null) return false;
  const opened = openCheckpoint(KEY, host.checkpoint, { code: room.code, now: Date.now() });
  if (!opened.ok) return false;
  const view = viewFor(opened.value as PlatformRoomData, host.playerId, room.serverTime);
  return JSON.stringify(comparable(view, room.serverTime)) === JSON.stringify(comparable(room, room.serverTime));
}

describe.each(['SIGKILL', 'SIGTERM'] as const)('the server %s mid-game', (signal) => {
  const servers: { random: ServerProcess | null; zero: ServerProcess | null } = { random: null, zero: null };
  const scenarios = new Map<string, Scenario>();
  const before = new Map<Phone, RoomState>();
  const exits: Exit[] = [];
  let killAt = 0;
  let restoredAt = 0;

  beforeAll(async () => {
    const random = new ServerProcess(await freePort(), KEY.toString('base64'));
    const zero = new ServerProcess(await freePort(), KEY.toString('base64'), true);
    servers.random = random;
    servers.zero = zero;
    await Promise.all([random.start(), zero.start()]);

    const setUp = await Promise.all([
      scribbleMidDrawing(random.url),
      spyMidQuestions(random.url),
      spyMidVote(random.url),
      quipMidWriting(random.url),
      quipMidVoting(random.url),
      blackjackMidBets(random.url),
      blackjackAfterSplit(zero.url),
      pokerMidHand(random.url),
      templateMidRace(random.url),
    ]);
    for (const s of setUp) scenarios.set(s.name, s);
    const bets = setUp[5];
    if (signal === 'SIGKILL') {
      // A hard kill keeps only what was sent: let the last changes reach the phones first.
      await until('current checkpoints', () => setUp.every(checkpointIsCurrent), 15_000);
    }
    // The results pause is short: this one is caught last.
    const results = await blackjackMidResults(random.url);
    scenarios.set(results.name, results);
    if (signal === 'SIGKILL') await until('a checkpoint of the results', () => checkpointIsCurrent(results), 5000);
    else {
      // A deploy catches changes made a moment before it: only the shutdown's checkpoint has this bet.
      bets.phones[1].send({ t: 'bet', amount: 20 });
      await Promise.all(bets.phones.map((p) => p.waitFor("Bob's bet", (r) => JSON.stringify(r.game).includes('"bet":20'))));
    }
    await sleep(150);

    for (const s of scenarios.values()) for (const p of s.phones) before.set(p, structuredClone(p.room as RoomState));
    killAt = Date.now();
    exits.push(...(await Promise.all([random.stop(signal), zero.stop(signal)])));
    await sleep(DOWNTIME_MS);
    await Promise.all([random.start(), zero.start()]);
    restoredAt = Date.now();

    const urlOf = (s: Scenario): string => (s.server === 'zero' ? zero.url : random.url);
    // Bob comes back first with a checkpoint older than everyone else's: the newest must still win.
    const bob = bets.phones[1];
    const first = bob.comeBack(random.url, bets.olderCheckpoint);
    await sleep(200);
    const rest = [...scenarios.values()].flatMap((s) => s.phones.filter((p) => p !== bob).map((p) => p.comeBack(urlOf(s))));
    await Promise.all([first, ...rest]);
    for (const s of scenarios.values()) {
      await Promise.all(s.phones.map((p) => p.waitFor('everyone back', (r) => r.players.every((x) => x.connected))));
    }
  }, 120_000);

  afterAll(async () => {
    for (const s of scenarios.values()) for (const p of s.phones) p.close();
    await Promise.all([servers.random?.stop('SIGKILL'), servers.zero?.stop('SIGKILL')]);
  });

  it(signal === 'SIGTERM' ? 'sends every phone a fresh checkpoint and a restarting close, then exits at once' : 'dies without a word', () => {
    if (signal === 'SIGKILL') {
      expect(exits.map((e) => e.signal)).toEqual(['SIGKILL', 'SIGKILL']);
      return;
    }
    expect(exits.map((e) => e.code)).toEqual([0, 0]);
    for (const e of exits) expect(e.ms).toBeLessThan(3000);
    for (const s of scenarios.values()) {
      for (const p of s.phones) expect(p.closeCodes, p.name).toContain(CLOSE_RESTARTING);
    }
  });

  it.each(SCENARIOS)('%s: everyone is back in the same seat with the same scores, chips and turn', (name) => {
    const s = scenarios.get(name);
    if (!s) throw new Error(`no scenario ${name}`);
    for (const phone of s.phones) {
      const was = before.get(phone);
      const now = phone.room;
      if (!was || !now) throw new Error(`${phone.name} has no room`);
      expect(now.code).toBe(was.code);
      expect(now.hostId).toBe(was.hostId);
      expect(now.players.map((p) => [p.id, p.name, p.score, p.isHost, p.participating])).toEqual(was.players.map((p) => [p.id, p.name, p.score, p.isHost, p.participating]));
      if (s.restarted) {
        s.restarted(was, now);
        continue;
      }
      expect(comparable(now, now.serverTime), phone.name).toEqual(comparable(was, was.serverTime));
      // Nobody lost time to the outage: what was left of every clock is still left.
      for (const d of deadlines(was.game, now.game, killAt)) {
        expect(d.after - now.serverTime, `${phone.name} ${d.path}`).toBeGreaterThanOrEqual(d.before - killAt - SLACK_MS);
      }
    }
    expect(restoredAt - killAt).toBeGreaterThanOrEqual(DOWNTIME_MS);
  });

  it('every game plays on to its end', async () => {
    const outcomes = await Promise.allSettled([...scenarios.values()].map((s) => s.finish()));
    const failed = outcomes.flatMap((o, i) => (o.status === 'rejected' ? [`${[...scenarios.keys()][i]}: ${String(o.reason)}`] : []));
    expect(failed).toEqual([]);
    for (const s of scenarios.values()) {
      const room = s.phones[0].room;
      expect(room?.phase, s.name).toBe('lobby');
      expect(room?.results?.entries.length, s.name).toBeGreaterThan(0);
    }
  }, 120_000);
});
