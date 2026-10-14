/**
 * Marks the next snapshot as a fresh entry: a welcome (a first join, or a reconnect after missing
 * any number of moves) shows the table as it is rather than replaying what was missed.
 */
export function createEntryFlag(): { mark(): void; take(): boolean } {
  let marked = false;
  return {
    mark() {
      marked = true;
    },
    take() {
      const was = marked;
      marked = false;
      return was;
    },
  };
}
