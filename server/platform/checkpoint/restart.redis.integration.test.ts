/**
 * The real server on the Redis driver, stopped mid-game and started again: Redis keeps the rooms,
 * so no checkpoint is ever sent, a deploy (SIGTERM) still closes every phone as restarting and
 * exits at once, and the phones simply rejoin and play on. Skipped without a redis-server binary.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_RESTARTING, type RoomState } from '../../../shared/platform/protocol.js';
import { Phone, ServerProcess, freePort, sleep, type Exit } from './restartHarness.js';
import { pokerMidHand, spyMidVote, type Scenario } from './restartScenarios.js';

const hasRedisServer = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
const KEY = randomBytes(32).toString('base64');

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe.skipIf(!hasRedisServer).each(['SIGTERM', 'SIGKILL'] as const)('the server on Redis, %s mid-game', (signal) => {
  let redis: ChildProcess | null = null;
  let server: ServerProcess | null = null;
  const scenarios: Scenario[] = [];
  const before = new Map<Phone, RoomState>();
  let exit: Exit | null = null;

  beforeAll(async () => {
    const redisPort = await freePort();
    redis = spawn('redis-server', ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--loglevel', 'warning'], { stdio: 'ignore' });
    const deadline = Date.now() + 10_000;
    while (!(await portOpen(redisPort))) {
      if (Date.now() > deadline) throw new Error('redis-server did not start');
      await sleep(50);
    }
    server = new ServerProcess(await freePort(), KEY, false, { REDIS_URL: `redis://127.0.0.1:${redisPort}` });
    await server.start();
    expect(server.output).toContain('driver: redis');

    scenarios.push(await pokerMidHand(server.url), await spyMidVote(server.url));
    for (const s of scenarios) for (const p of s.phones) before.set(p, structuredClone(p.room as RoomState));
    exit = await server.stop(signal);
    await server.start();
    await Promise.all(scenarios.flatMap((s) => s.phones.map((p) => p.comeBack(server?.url ?? ''))));
    for (const s of scenarios) await Promise.all(s.phones.map((p) => p.waitFor('everyone back', (r) => r.players.every((x) => x.connected))));
  }, 90_000);

  afterAll(async () => {
    for (const s of scenarios) for (const p of s.phones) p.close();
    await server?.stop('SIGKILL');
    const r = redis;
    if (r && r.exitCode === null) {
      const gone = new Promise((resolve) => r.once('exit', resolve));
      r.kill('SIGKILL');
      await gone;
    }
  });

  it(signal === 'SIGTERM' ? 'closes every phone as restarting and exits at once, with no checkpoint sent' : 'sends no checkpoint', () => {
    for (const s of scenarios) for (const p of s.phones) expect(p.checkpoints, p.name).toEqual([]);
    if (signal === 'SIGKILL') return;
    expect(exit?.code).toBe(0);
    expect(exit?.ms).toBeLessThan(3000);
    for (const s of scenarios) for (const p of s.phones) expect(p.closeCodes, p.name).toContain(CLOSE_RESTARTING);
  });

  it('brings every phone back to its seat, and the games play on to the end', async () => {
    for (const s of scenarios) {
      for (const p of s.phones) {
        const was = before.get(p);
        expect(p.room?.code).toBe(was?.code);
        expect(p.room?.players.map((x) => [x.id, x.score])).toEqual(was?.players.map((x) => [x.id, x.score]));
      }
    }
    await Promise.all(scenarios.map((s) => s.finish()));
    for (const s of scenarios) expect(s.phones[0].room?.results?.entries.length, s.name).toBeGreaterThan(0);
  }, 90_000);
});
