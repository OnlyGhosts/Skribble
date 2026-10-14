import { useLayoutEffect, useRef } from 'react';
import { ChipIcon } from '../components/Chips';
import { formatChips } from '../lib/format';
import { prefersReducedMotion } from '../lib/media';
import type { Flight } from './timeline';

/** The marker on the places chips fly between: `data-table-anchor="pot"`, `"seat:<id>"`, `"bet:<id>"`. */
export const ANCHOR_ATTR = 'data-table-anchor';

function centreOf(doc: Document, anchor: string): { x: number; y: number } | null {
  const el = doc.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(anchor)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** One stack of chips on its way: it starts over its source and slides to its target in whatever is left of its time. */
function ChipFlight({ flight }: { flight: Flight }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    const from = centreOf(el.ownerDocument, flight.from);
    const to = centreOf(el.ownerDocument, flight.to);
    if (!from || !to) return;
    const left = Math.max(60, flight.at + flight.ms - Date.now());
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.visibility = 'visible';
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    el.animate([{ transform: 'translate(-50%, -50%)' }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }], { duration: left, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards' });
    // Mount-only: each flight plays once.
  }, []);
  return (
    <span ref={ref} className="tbl-flight" style={{ visibility: 'hidden', transform: 'translate(-50%, -50%)' }}>
      <ChipIcon size={12} className="chip-count__coin" />
      {formatChips(flight.amount)}
    </span>
  );
}

/**
 * The chips in the air over a table: bets sliding to their spots, bets swept into the pot, the
 * pot sliding to its winners. Purely visual (the numbers on the table say the same in words).
 */
export function ChipFlights({ flights }: { flights: Flight[] }) {
  if (flights.length === 0) return null;
  return (
    <div className="tbl-flights" aria-hidden="true" data-testid="chip-flights">
      {flights.map((f) => (
        <ChipFlight key={f.id} flight={f} />
      ))}
    </div>
  );
}
