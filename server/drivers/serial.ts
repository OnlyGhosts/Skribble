import type { MaybePromise } from './types.js';

/**
 * Runs tasks one after another. A task that finishes synchronously runs inline (so the in-memory
 * driver stays synchronous); one that returns a promise makes every later task wait for it, so a
 * 'join' followed by a 'chat' on the same socket reaches the room in that order.
 */
export class SerialQueue {
  private tail: Promise<void> | null = null;

  constructor(private readonly onError: (err: unknown) => void) {}

  push(task: () => MaybePromise<void>): void {
    if (this.tail) {
      this.track(this.tail.then(() => this.settle(task)));
      return;
    }
    let out: MaybePromise<void>;
    try {
      out = task();
    } catch (err) {
      this.onError(err);
      return;
    }
    if (out instanceof Promise) this.track(out.catch(this.onError));
  }

  private track(p: Promise<void>): void {
    const tracked: Promise<void> = p.then(() => {
      if (this.tail === tracked) this.tail = null;
    });
    this.tail = tracked;
  }

  private async settle(task: () => MaybePromise<void>): Promise<void> {
    try {
      await task();
    } catch (err) {
      this.onError(err);
    }
  }
}

/**
 * Mutual exclusion for async work. Redis WATCH is scoped to a connection, so every
 * WATCH/GET/MULTI/EXEC transaction on one connection must run alone.
 */
export class AsyncLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
