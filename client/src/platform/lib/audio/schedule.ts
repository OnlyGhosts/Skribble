/**
 * Sounds timed to an animation: each plays at a local epoch time (a card landing, a reveal). A
 * moment already well past is skipped rather than played late; clear() drops everything pending
 * (a new plan, a leave).
 */
export interface SoundSchedule {
  at(epochMs: number, play: () => void): void;
  clear(): void;
}

/** How late a timed sound may still play. */
export const SCHEDULE_SLACK_MS = 120;

export function createSoundSchedule(now: () => number = Date.now): SoundSchedule {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    at(epochMs, play) {
      const wait = epochMs - now();
      if (wait < -SCHEDULE_SLACK_MS) return;
      const id = setTimeout(() => {
        pending.delete(id);
        play();
      }, Math.max(0, wait));
      pending.add(id);
    },
    clear() {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    },
  };
}
