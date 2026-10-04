import { after, type MaybePromise } from './drivers/types.js';

/** Concurrent writers (other instances) make a compare-and-set fail; each retry re-reads its input. */
export const MAX_CAS_RETRIES = 5;

/**
 * Repeats `attempt` while another writer gets in first, up to MAX_CAS_RETRIES. Stays synchronous
 * while the attempts do (the in-memory storage never conflicts).
 */
export function retryCas<T>(what: string, attempt: () => MaybePromise<T | 'conflict'>): MaybePromise<T> {
  const step = (i: number): MaybePromise<T> =>
    after(attempt(), (out) => {
      if (out !== 'conflict') return out;
      if (i >= MAX_CAS_RETRIES) throw new Error(`${what}: gave up after ${i} concurrent writes`);
      return new Promise<void>((resolve) => setTimeout(resolve, 5 + Math.random() * 20)).then(() => step(i + 1));
    });
  return step(0);
}
