import { describe, expect, it } from 'vitest';
import { AsyncLock, SerialQueue } from './serial.js';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (err: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('SerialQueue', () => {
  it('runs synchronous tasks inline and holds later tasks behind a pending one', async () => {
    const errors: unknown[] = [];
    const queue = new SerialQueue((err) => errors.push(err));
    const order: string[] = [];
    queue.push(() => {
      order.push('a');
    });
    expect(order).toEqual(['a']);

    const gate = deferred();
    queue.push(() => gate.promise.then(() => order.push('b')).then(() => undefined));
    queue.push(() => {
      order.push('c');
    });
    await flush();
    expect(order).toEqual(['a']);
    gate.resolve();
    await flush();
    expect(order).toEqual(['a', 'b', 'c']);
    // Once drained, tasks run inline again.
    queue.push(() => {
      order.push('d');
    });
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(errors).toEqual([]);
  });

  it('reports throwing and rejecting tasks without stalling the ones behind them', async () => {
    const errors: unknown[] = [];
    const queue = new SerialQueue((err) => errors.push(err));
    const order: string[] = [];
    queue.push(() => {
      throw new Error('sync');
    });
    queue.push(() => Promise.reject(new Error('async')));
    queue.push(() => {
      order.push('after');
    });
    await flush();
    expect(order).toEqual(['after']);
    expect(errors.map((e) => (e instanceof Error ? e.message : String(e)))).toEqual(['sync', 'async']);
  });
});

describe('AsyncLock', () => {
  it('never overlaps two runs and survives a rejection', async () => {
    const lock = new AsyncLock();
    let active = 0;
    let maxActive = 0;
    const work = async (label: string, log: string[]): Promise<string> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await flush();
      active--;
      log.push(label);
      return label;
    };
    const log: string[] = [];
    const results = await Promise.all([lock.run(() => work('a', log)), lock.run(() => work('b', log)), lock.run(() => work('c', log))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);

    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await lock.run(() => Promise.resolve('next'))).toBe('next');
  });
});
