import { describe, expect, it } from 'vitest';
import { clearChar, enteredLength, joinCode, padCode, writeChars } from './codeInput';

describe('code boxes', () => {
  it('pads a partial code and keeps a middle gap as an empty box', () => {
    expect(padCode('AB')).toEqual(['A', 'B', '', '']);
    expect(padCode('AB D')).toEqual(['A', 'B', '', 'D']);
    expect(padCode('abcd')).toEqual(['A', 'B', 'C', 'D']);
    expect(joinCode(['A', 'B', '', 'D'])).toBe('AB D');
    expect(joinCode(['A', 'B', '', ''])).toBe('AB');
  });

  it('deleting a middle box leaves the later characters where they are', () => {
    const afterDelete = clearChar('ABCD', 2);
    expect(padCode(afterDelete)).toEqual(['A', 'B', '', 'D']);
    // Retyping into the gap restores a full code instead of dropping the D.
    expect(writeChars(afterDelete, 2, 'X')).toEqual({ code: 'ABXD', focus: 3 });
  });

  it('writes runs of characters from a box and reports where to focus next', () => {
    expect(writeChars('', 0, 'AB')).toEqual({ code: 'AB', focus: 2 });
    expect(writeChars('AB', 2, 'CDXYZ')).toEqual({ code: 'ABCD', focus: 3 });
  });

  it('counts only entered characters', () => {
    expect(enteredLength('AB D')).toBe(3);
    expect(enteredLength('ABCD')).toBe(4);
    expect(enteredLength('')).toBe(0);
  });
});
