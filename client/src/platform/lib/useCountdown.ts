import { useEffect, useState } from 'react';
import { usePlatformStore } from '../store/usePlatformStore';

const TICK_MS = 200;

/** Milliseconds left until `endsAt` on the server clock (never negative); 0 when there is no deadline. */
export function remainingMs(endsAt: number | null | undefined, clockOffset: number, now = Date.now()): number {
  if (endsAt == null) return 0;
  return Math.max(0, endsAt - (now + clockOffset));
}

/**
 * Milliseconds left until `endsAt` on the server clock, refreshed a few times a second. The first
 * render already carries the real value: a timer must never flash "0" (in its urgent style) before
 * its effect has run.
 */
export function useCountdown(endsAt: number | null | undefined): number {
  const clockOffset = usePlatformStore((s) => s.clockOffset);
  const [remaining, setRemaining] = useState(() => remainingMs(endsAt, clockOffset));

  useEffect(() => {
    const compute = () => remainingMs(endsAt, clockOffset);
    setRemaining(compute());
    if (endsAt == null) return;
    const id = window.setInterval(() => setRemaining(compute()), TICK_MS);
    return () => window.clearInterval(id);
  }, [endsAt, clockOffset]);

  return remaining;
}

export function useCountdownSeconds(endsAt: number | null | undefined): number {
  return Math.ceil(useCountdown(endsAt) / 1000);
}
