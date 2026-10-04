/**
 * Lays a guess draft over the word mask so typed letters land in the word-length tiles.
 *
 * The mask is the server's view of the word: hidden letters are "_", revealed hint letters are
 * themselves, and spaces / hyphens / apostrophes stay where they are. Only letters and digits of
 * the draft are placed (guesses are compared without separators anyway), so a player can type
 * "ice cream" or "icecream" and both fill the same slots.
 */

export type GuessSlot =
  | {
      kind: 'letter';
      /** A hint letter revealed by the server, shown faintly until typed over. */
      hint?: string;
      /** The letter the player typed into this slot. */
      typed?: string;
      /** The slot the next typed letter lands in (shows the caret while focused). */
      active: boolean;
    }
  | { kind: 'sep'; char: string };

export interface GuessLayout {
  /** One group per word of the mask. */
  groups: GuessSlot[][];
  /** Letters typed beyond the available slots, in order. */
  overflow: string[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;

function isLetterSlot(ch: string): boolean {
  return ch === '_' || LETTER_OR_DIGIT.test(ch);
}

/** Letters and digits of the draft as an array of characters (code points, not UTF-16 units). */
export function draftLetters(draft: string): string[] {
  return Array.from(draft.replace(NOT_LETTER_OR_DIGIT, ''));
}

/** Number of letter slots in the mask (hidden or revealed). */
export function letterCountFor(mask: string): number {
  let count = 0;
  for (const ch of mask) if (isLetterSlot(ch)) count++;
  return count;
}

export function layoutGuess(mask: string, draft: string): GuessLayout {
  const letters = draftLetters(draft);
  const total = letterCountFor(mask);
  const activeIndex = letters.length < total ? letters.length : -1;
  let cursor = 0;
  const groups = mask
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) =>
      Array.from(part).map((ch): GuessSlot => {
        if (!isLetterSlot(ch)) return { kind: 'sep', char: ch };
        const index = cursor++;
        const slot: GuessSlot = { kind: 'letter', active: index === activeIndex };
        if (ch !== '_') slot.hint = ch;
        if (index < letters.length) slot.typed = letters[index];
        return slot;
      }),
    );
  return { groups, overflow: letters.slice(total) };
}

/** Whether a typed letter matches a revealed hint, ignoring case and accents. */
export function hintMatches(typed: string, hint: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  return fold(typed) === fold(hint);
}

/** Letter and separator counts of one tile group; the tiles size themselves from these. */
export function groupMetrics(slots: readonly GuessSlot[]): { letters: number; seps: number } {
  let letters = 0;
  let seps = 0;
  for (const slot of slots) {
    if (slot.kind === 'letter') letters++;
    else seps++;
  }
  return { letters, seps };
}

/**
 * The word's shape for assistive tech, e.g. "8 letters in 2 words. Revealed: blank blank E blank".
 * On phones the tiles are the only place the mask is shown, and they are hidden from screen readers.
 */
export function describeMask(mask: string): string {
  const words = mask.split(' ').filter((part) => part.length > 0);
  const total = letterCountFor(mask);
  const shape = `${total} ${total === 1 ? 'letter' : 'letters'}${words.length > 1 ? ` in ${words.length} words` : ''}`;
  if (!Array.from(mask).some((ch) => ch !== '_' && LETTER_OR_DIGIT.test(ch))) return `${shape}.`;
  const revealed = words
    .map((word) =>
      Array.from(word)
        .filter(isLetterSlot)
        .map((ch) => (ch === '_' ? 'blank' : ch.toUpperCase()))
        .join(' '),
    )
    .join(', ');
  return `${shape}. Revealed: ${revealed}.`;
}
