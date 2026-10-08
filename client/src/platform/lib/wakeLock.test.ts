import { describe, expect, it, vi } from 'vitest';
import { WakeLockKeeper, type WakeLockEnv, type WakeLockSentinelLike } from './wakeLock';

type Listener = () => void;

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private listeners: Listener[] = [];
  async release(): Promise<void> {
    this.released = true;
    for (const fn of this.listeners) fn();
  }
  addEventListener(_type: 'release', listener: Listener): void {
    this.listeners.push(listener);
  }
  /** The OS taking the lock back (page hidden, battery saver). */
  async revoke(): Promise<void> {
    await this.release();
  }
}

function fakeEnv(opts: { supported?: boolean; failFirst?: number } = {}) {
  const listeners = new Map<string, Listener[]>();
  const sentinels: FakeSentinel[] = [];
  let failures = opts.failFirst ?? 0;
  const request = vi.fn(async (_type: 'screen'): Promise<WakeLockSentinelLike> => {
    if (failures > 0) {
      failures--;
      throw new Error('NotAllowedError');
    }
    const s = new FakeSentinel();
    sentinels.push(s);
    return s;
  });
  const document = {
    visibilityState: 'visible',
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
    },
  };
  const env: WakeLockEnv = { navigator: opts.supported === false ? {} : { wakeLock: { request } }, document };
  const emit = (type: string) => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  const listening = (type: string) => (listeners.get(type) ?? []).length;
  return { env, request, sentinels, document, emit, listening };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WakeLockKeeper', () => {
  it('requests a screen lock on hold and releases it on release', async () => {
    const f = fakeEnv();
    const keeper = new WakeLockKeeper(f.env);
    expect(keeper.supported).toBe(true);
    keeper.hold();
    keeper.hold();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith('screen');
    expect(keeper.active).toBe(true);
    keeper.release();
    await flush();
    expect(f.sentinels[0].released).toBe(true);
    expect(keeper.active).toBe(false);
    expect(f.listening('visibilitychange')).toBe(0);
  });

  it('does nothing, and never throws, without the API', () => {
    const f = fakeEnv({ supported: false });
    const keeper = new WakeLockKeeper(f.env);
    expect(keeper.supported).toBe(false);
    expect(() => {
      keeper.hold();
      keeper.release();
    }).not.toThrow();
    expect(f.listening('visibilitychange')).toBe(0);
  });

  it('asks again when the page comes back to the foreground after the OS released it', async () => {
    const f = fakeEnv();
    const keeper = new WakeLockKeeper(f.env);
    keeper.hold();
    await flush();
    f.document.visibilityState = 'hidden';
    await f.sentinels[0].revoke();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1); // hidden: no point asking yet
    expect(keeper.active).toBe(false);
    f.document.visibilityState = 'visible';
    f.emit('visibilitychange');
    await flush();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(keeper.active).toBe(true);
  });

  it('retries on the next user gesture when the first request was refused', async () => {
    const f = fakeEnv({ failFirst: 1 });
    const keeper = new WakeLockKeeper(f.env);
    keeper.hold();
    await flush();
    expect(keeper.active).toBe(false);
    expect(f.listening('pointerdown')).toBe(1);
    f.emit('pointerdown');
    await flush();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(keeper.active).toBe(true);
    expect(f.listening('pointerdown')).toBe(0);
    expect(f.listening('keydown')).toBe(0);
  });

  it('releases a lock granted after release() was already called', async () => {
    const f = fakeEnv();
    const keeper = new WakeLockKeeper(f.env);
    keeper.hold();
    keeper.release();
    await flush();
    expect(f.sentinels[0].released).toBe(true);
    expect(keeper.active).toBe(false);
  });
});
