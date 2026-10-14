import { ROOM_CODE_LENGTH } from '@shared/platform/roomCode';

/**
 * The room code as the four boxes hold it. An empty box in the middle is a space in the string
 * (never a collapse: deleting the third character of "ABCD" must leave "AB D", so the box can be
 * retyped without losing the "D"). Trailing empties are trimmed, so a complete code has no spaces
 * and an incomplete one never validates as a room code.
 */
export function padCode(code: string): string[] {
  const chars = Array.from(code.toUpperCase().slice(0, ROOM_CODE_LENGTH)).map((ch) => (ch === ' ' ? '' : ch));
  while (chars.length < ROOM_CODE_LENGTH) chars.push('');
  return chars;
}

export function joinCode(chars: readonly string[]): string {
  return chars
    .map((ch) => ch || ' ')
    .join('')
    .trimEnd();
}

/** Writes `text` into consecutive boxes from `start`; returns the new code and the box to focus. */
export function writeChars(code: string, start: number, text: string): { code: string; focus: number } {
  const next = padCode(code);
  let i = start;
  for (const ch of text) {
    if (i >= ROOM_CODE_LENGTH) break;
    next[i++] = ch;
  }
  return { code: joinCode(next), focus: Math.min(i, ROOM_CODE_LENGTH - 1) };
}

/** Empties one box, leaving every other box where it is. */
export function clearChar(code: string, index: number): string {
  const next = padCode(code);
  next[index] = '';
  return joinCode(next);
}

/** Letters actually entered, ignoring empty boxes. */
export function enteredLength(code: string): number {
  return padCode(code).filter(Boolean).length;
}

/**
 * What the user typed into a box that already held `previous`: the browser hands over both
 * characters, the old one before or after the new one depending on where the caret was (a click on
 * a filled box can leave it on either side). Typing replaces the box, so the old character goes.
 */
export function typedText(raw: string, previous: string): string {
  if (raw.length < 2 || !previous) return raw;
  if (raw.startsWith(previous)) return raw.slice(previous.length);
  if (raw.endsWith(previous)) return raw.slice(0, -previous.length);
  return raw;
}
