import { useEffect, useState } from 'react';
import { nextEvent, type Timeline } from './timeline';

/** The local clock for drawing a table's timeline: re-renders at each moment the table changes, and not otherwise. */
export function useTableNow<T>(timeline: Timeline<T>): number {
  const [now, setNow] = useState(() => Date.now());
  const current = Math.max(now, Date.now());
  const next = nextEvent(timeline, current);
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 4);
    return () => clearTimeout(id);
  }, [next, timeline]);
  return current;
}
