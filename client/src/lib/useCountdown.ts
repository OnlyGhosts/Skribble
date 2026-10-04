import { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';

const TICK_MS = 200;

/** Milliseconds left until `endsAt` on the server clock (never negative); 0 when there is no deadline. */
export function useCountdown(endsAt: number | null | undefined): number {
  const clockOffset = useGameStore((s) => s.clockOffset);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (endsAt == null) {
      setRemaining(0);
      return;
    }
    const compute = () => Math.max(0, endsAt - (Date.now() + clockOffset));
    setRemaining(compute());
    const id = window.setInterval(() => setRemaining(compute()), TICK_MS);
    return () => window.clearInterval(id);
  }, [endsAt, clockOffset]);

  return remaining;
}

export function useCountdownSeconds(endsAt: number | null | undefined): number {
  return Math.ceil(useCountdown(endsAt) / 1000);
}
