/**
 * A word list uploaded as a .txt file (custom words, custom prompts): checked and read in the
 * browser, then merged into what is already typed with the game's own parser, so a file follows
 * exactly the rules the box does. Nothing new reaches the server.
 */

export const WORD_FILE_MAX_BYTES = 100 * 1024;

export interface WordFileInfo {
  name: string;
  type: string;
  size: number;
}

/** Why the file cannot be used, or null. Some browsers give a .txt file no type, so the name counts too. */
export function wordFileProblem(file: WordFileInfo): string | null {
  const plain = file.type === 'text/plain' || (file.type === '' && /\.txt$/i.test(file.name));
  if (!plain) return 'Pick a plain .txt file.';
  if (file.size > WORD_FILE_MAX_BYTES) return 'That file is too big. Keep it under 100 KB.';
  return null;
}

/** A NUL byte never appears in text: it is a binary file with a .txt name. */
export function looksLikeText(text: string): boolean {
  return !text.includes('\u0000');
}

/** A game's list rules: how typed text splits into entries, and the parser the server applies. */
export interface WordListRules {
  split(text: string): string[];
  parse(text: string): string[];
}

export interface WordFileMerge {
  /** The box's new text: the old entries then the file's new ones, one per line. */
  text: string;
  added: number;
  /** Entries of the file left out because the box or the file already had them. */
  repeats: number;
  /** Entries the per-entry rules refuse (too long). */
  tooLong: number;
  /** New, valid entries that did not fit under the list's count limit. */
  overLimit: number;
}

/** Adds the file's entries to the box's, without duplicates, under the parser's rules and limits. */
export function mergeWordFile(current: string, fileText: string, { split, parse }: WordListRules): WordFileMerge {
  const before = parse(current);
  const merged = parse(`${current}\n${fileText}`);
  const added = merged.length - before.length;
  const seen = new Set(before.map((w) => w.toLowerCase()));
  let repeats = 0;
  let tooLong = 0;
  let fresh = 0;
  for (const entry of split(fileText)) {
    // One entry through the parser gives its normalised form, or nothing when a rule refuses it.
    const [word] = parse(entry);
    if (word === undefined) tooLong++;
    else if (seen.has(word.toLowerCase())) repeats++;
    else {
      seen.add(word.toLowerCase());
      fresh++;
    }
  }
  return { text: merged.join('\n'), added, repeats, tooLong, overLimit: Math.max(0, fresh - added) };
}

/** "Added 12 words." with what was left out and why, if anything. */
export function wordFileSummary({ added, repeats, tooLong, overLimit }: WordFileMerge, noun: { one: string; many: string }): string {
  const what = (n: number) => `${n} ${n === 1 ? noun.one : noun.many}`;
  const head = added === 0 ? `No new ${noun.many} in that file.` : `Added ${what(added)}.`;
  const reasons = [
    repeats > 0 ? `${repeats} ${repeats === 1 ? 'repeat' : 'repeats'}` : null,
    tooLong > 0 ? `${tooLong} too long` : null,
    overLimit > 0 ? `${overLimit} over the limit` : null,
  ].filter((r): r is string => r !== null);
  if (reasons.length === 0) return head;
  const list = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
  return `${head} Left out ${list}.`;
}
