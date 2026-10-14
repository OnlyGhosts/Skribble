import { useLayoutEffect, useRef } from 'react';
import type { Card } from '@shared/platform/cards';
import { PlayingCard, type PlayingCardSize } from '../components/PlayingCard';
import { prefersReducedMotion } from '../lib/media';
import { DEAL_MS, DISCARD_MS, FLIP_MS, MOVE_MS } from './timeline';

interface Props {
  card: Card | null;
  size: PlayingCardSize;
  /** How the card arrives as it mounts: from the deck, from its old slot in the same seat, or already there. */
  motion: 'deal' | 'move' | null;
  /** Going to the discard tray. */
  leaving: boolean;
  /** Turning face up as it mounts (the card underneath is the face). */
  flipping?: boolean;
  /** Lifted out of its row (the cards that play). */
  highlight?: boolean;
  testId: string;
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** The marker on the deck the cards fly out of, and on the tray they go to. */
export const DECK_ANCHOR = 'data-table-deck';
export const DISCARD_ANCHOR = 'data-table-discard';

/** The offset from this element's centre to the centre of the element marked with `attr`. */
function offsetTo(el: HTMLElement, attr: string): { dx: number; dy: number } | null {
  const target = el.ownerDocument.querySelector(`[${attr}]`);
  if (!target) return null;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return { dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2) };
}

function canAnimate(el: HTMLElement | null): el is HTMLElement {
  return el !== null && typeof el.animate === 'function' && !prefersReducedMotion();
}

/**
 * A card on a table. It slides in from the deck (or a short way from its old slot after a split)
 * as it mounts, turns over in place, and slides off to the discard tray when it leaves. Web
 * animations on transforms only, so phones keep them smooth; none under reduced motion.
 */
export function TableCard({ card, size, motion, leaving, flipping = false, highlight = false, testId }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!motion || !canAnimate(el)) return;
    if (motion === 'move') {
      el.animate([{ transform: 'translateX(-28px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: MOVE_MS, easing: EASE });
      return;
    }
    const from = offsetTo(el, DECK_ANCHOR);
    const start = from ? `translate(${from.dx}px, ${from.dy}px) rotate(-12deg) scale(0.8)` : 'translateY(-24px)';
    el.animate([{ transform: start, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: DEAL_MS, easing: EASE });
    // Mount-only: a card's arrival plays once.
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !canAnimate(el)) return;
    const to = offsetTo(el, DISCARD_ANCHOR);
    const end = to ? `translate(${to.dx}px, ${to.dy}px) rotate(10deg) scale(0.6)` : 'translateY(-24px)';
    el.animate([{ transform: 'none', opacity: 1 }, { transform: end, opacity: 0.2 }], { duration: DISCARD_MS, easing: 'ease-in', fill: 'forwards' });
  }, [leaving]);

  return (
    <span ref={ref} className="tbl-card">
      {flipping && card ? (
        <span className="tbl-flip" style={{ animationDuration: `${FLIP_MS}ms` }}>
          <span className={`playing-card playing-card--${size} playing-card--down tbl-flip__back`} aria-hidden="true">
            <span className="playing-card__back" />
          </span>
          <PlayingCard card={card} size={size} testId={testId} highlight={highlight} className="tbl-flip__front" />
        </span>
      ) : (
        <PlayingCard card={card} size={size} testId={testId} highlight={highlight} />
      )}
    </span>
  );
}
