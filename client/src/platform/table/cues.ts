/** One cue held back until the table shows what it is about (an outcome after the dealer's reveal). */
let pending: ReturnType<typeof setTimeout> | null = null;

export function cueAt(at: number, play: () => void): void {
  cancelCue();
  pending = setTimeout(() => {
    pending = null;
    play();
  }, Math.max(0, at - Date.now()));
}

export function cancelCue(): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
}
