import { describe, expect, it } from 'vitest';
import { MemoryStorage, STAMP_FIELD } from './storage.js';

describe('MemoryStorage', () => {
  it('answers synchronously, bumps the sequence on every write and refuses stale writers', () => {
    const storage = new MemoryStorage();
    expect(storage.state('R')).toEqual({ hash: {}, seq: 0 });
    expect(storage.list('R')).toEqual({ items: [], seq: 0 });

    expect(storage.append('R', 0, [[1], [2]], { n: '2' })).toBe(1);
    expect(storage.append('R', 0, [[3]], {})).toBe('conflict');
    expect(storage.append('R', 1, [[3]], { n: '3', extra: 'x' })).toBe(2);
    expect(storage.state('R')).toEqual({ hash: { n: '3', extra: 'x' }, seq: 2 });
    expect(storage.length('R')).toBe(3);
    expect(storage.range('R', 1, 2)).toEqual([[2], [3]]);

    expect(storage.pop('R', 2, 2, { n: -2 }, ['extra'])).toBe(3);
    expect(storage.list('R')).toEqual({ items: [[1]], seq: 3 });
    expect(storage.state('R').hash).toEqual({ n: '1' });

    expect(storage.reset('R', 2, 'stamp-a')).toBe('conflict');
    expect(storage.reset('R', null, 'stamp-a')).toBe(4);
    expect(storage.state('R')).toEqual({ hash: { [STAMP_FIELD]: 'stamp-a' }, seq: 4 });
    expect(storage.length('R')).toBe(0);

    storage.drop('R');
    expect(storage.state('R')).toEqual({ hash: {}, seq: 0 });
  });

  it('hands out copies, never its own arrays', () => {
    const storage = new MemoryStorage();
    const item = [1, 2];
    storage.append('R', 0, [item], {});
    item.push(3);
    const { items } = storage.list('R');
    expect(items).toEqual([[1, 2]]);
    (items[0] as number[]).push(9);
    expect(storage.list('R').items).toEqual([[1, 2]]);
  });
});
