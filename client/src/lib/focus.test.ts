import { describe, expect, it } from 'vitest';
import { nextInCycle } from './focus';

describe('nextInCycle', () => {
  const items = ['close', 'kick-a', 'kick-b'];

  it('moves forward and wraps to the first element after the last', () => {
    expect(nextInCycle(items, 'close', false)).toBe('kick-a');
    expect(nextInCycle(items, 'kick-b', false)).toBe('close');
  });

  it('moves backwards and wraps to the last element before the first', () => {
    expect(nextInCycle(items, 'kick-a', true)).toBe('close');
    expect(nextInCycle(items, 'close', true)).toBe('kick-b');
  });

  it('enters the list from outside (the focused panel itself) at either end', () => {
    expect(nextInCycle(items, null, false)).toBe('close');
    expect(nextInCycle(items, null, true)).toBe('kick-b');
    expect(nextInCycle(items, 'elsewhere', false)).toBe('close');
  });

  it('has nowhere to go in an empty panel', () => {
    expect(nextInCycle([], null, false)).toBeNull();
  });
});
