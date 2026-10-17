import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkpointKeyFromEnv } from './key.js';

describe('checkpoint key from the environment', () => {
  it('uses ROOM_CHECKPOINT_KEY and never logs it', () => {
    const key = randomBytes(32);
    const logs: string[] = [];
    const got = checkpointKeyFromEnv({ ROOM_CHECKPOINT_KEY: key.toString('base64'), NODE_ENV: 'production' }, (m) => logs.push(m));
    expect(got?.equals(key)).toBe(true);
    expect(logs).toEqual([]);
  });

  it('runs without checkpoints in production when the key is missing, with one warning', () => {
    const logs: string[] = [];
    expect(checkpointKeyFromEnv({ NODE_ENV: 'production' }, (m) => logs.push(m))).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/ROOM_CHECKPOINT_KEY is not set/);
  });

  it('ignores a key of the wrong length, without printing it', () => {
    const logs: string[] = [];
    const short = randomBytes(16).toString('base64');
    expect(checkpointKeyFromEnv({ ROOM_CHECKPOINT_KEY: short, NODE_ENV: 'production' }, (m) => logs.push(m))).toBeNull();
    expect(logs.join('\n')).not.toContain(short);
    expect(logs).toHaveLength(2);
  });

  it('makes a random key per process outside production', () => {
    const a = checkpointKeyFromEnv({}, () => undefined);
    const b = checkpointKeyFromEnv({ NODE_ENV: 'development' }, () => undefined);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a?.equals(b ?? Buffer.alloc(0))).toBe(false);
  });
});
