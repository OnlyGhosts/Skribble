import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { outlineClass } from '../../../platform/table/Outcome';
import { HAND_GAP_PX, MIN_CHIP_PX, MIN_FULL_HAND_PX, STAGE_CHIP_ROWS, chipGrid, chipsShown, fitCount, fullHandsFit, handSlots, type HandPlace } from '../lib/hands';
import { totalText, type TableHand } from '../lib/table';
import type { Timeline } from '../lib/timeline';
import { outcomeLabel } from '../lib/text';
import { useBlackjackStore } from '../store';
import { Hand, handOnScreen, handTone } from './Hand';

interface Size {
  width: number;
  height: number;
  /** The width the full hands take beside the chips (their slots and the gaps after them). */
  full: number;
  /**
   * The widest words over a hand's top right corner (its stake or owner and its total, or how it
   * ended): a full hand keeps room for them. It never shrinks while the row keeps its hands, so
   * which hands fold into chips never flips back and forth.
   */
  head: number;
}

/** The widest head (the words over a hand's corner) in the row: they keep their width whatever the cards' size. */
function headWidth(el: HTMLElement): number {
  return Math.ceil(Math.max(0, ...Array.from(el.querySelectorAll('.tbl-hand__head')).map((h) => h.getBoundingClientRect().width)));
}

/** The full hands' slots in a row of hands, and the gap after each. */
function fullWidth(el: HTMLElement): number {
  return Array.from(el.children).reduce((sum, c) => (c.classList.contains('bj-slot') ? sum + c.getBoundingClientRect().width + HAND_GAP_PX : sum), 0);
}

/** A row's size as it lays out (null until measured, and on the server render), and its full hands' width. */
function useSize<T extends HTMLElement>(count: number): [RefObject<T | null>, Size | null] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  // A new number of hands starts the head over.
  const counted = useRef(count);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const fresh = counted.current !== count;
    counted.current = count;
    const next = { width: el.clientWidth, height: el.clientHeight, full: Math.ceil(fullWidth(el)), head: headWidth(el) };
    setSize((s) => {
      const head = s && !fresh ? Math.max(s.head, next.head) : next.head;
      return s && s.width === next.width && s.height === next.height && s.full === next.full && s.head === head ? s : { ...next, head };
    });
  };
  // The observer is made again for a new number of hands, so its callback never measures with a stale count.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);
  // A hand's width changes with its cards, not the row's: measured again after every render.
  useLayoutEffect(measure);
  return [ref, size];
}

/**
 * How many full hands share the width and the most cards in any of them: the stylesheet sizes the
 * cards so every fan fits its share (blackjack.css, --fit-w), however many hits.
 */
export function fanStyle(hands: readonly { cards: readonly unknown[] }[]): CSSProperties {
  const fan = Math.max(2, ...hands.map((h) => h.cards.length));
  return { '--hands': Math.max(1, hands.length), '--fan': fan } as CSSProperties;
}

interface ChipProps {
  playerId: string;
  index: number;
  hand: TableHand;
  timeline: Timeline;
  now: number;
  testId: string;
}

/** A hand folded down to its total and stake, in its outcome's colour once settled. */
function HandChip({ playerId, index, hand, timeline, now, testId }: ChipProps) {
  const { cards, total, outcome } = handOnScreen(playerId, index, hand, timeline, now);
  const tone = handTone(outcome, total !== null && total.total > 21, hand.status === 'blackjack' && cards.length === 2, false);
  return (
    <li
      className={`bj-chip ${outlineClass(tone)}`}
      aria-label={`Hand ${index + 1}${total ? `: ${total.total}` : ''}${outcome ? `, ${outcomeLabel(outcome)}` : ''}`}
      data-testid={testId}
      data-index={index}
      data-status={hand.status}
      data-total={total?.total ?? 0}
      data-bet={hand.bet}
      data-outcome={outcome ?? undefined}
      data-payout={outcome ? (hand.payout ?? 0) : undefined}
    >
      <span className={`bj-chip__total tbl-pill tbl-pill--${tone}`}>{total ? totalText(total, false) : ''}</span>
    </li>
  );
}

/** The hands that did not get a chip of their own: how many; a tap opens every hand. */
function MoreChip({ playerId, hands, total, testId }: { playerId: string; hands: TableHand[]; total: number; testId: string }) {
  return (
    <li className="bj-chip bj-chip--more tbl-outline tbl-outline--neutral" data-testid={testId} data-count={hands.length}>
      <button type="button" className="bj-chip__more" aria-label={`${hands.length} more hands. Show all ${total}`} onClick={() => useBlackjackStore.getState().openSeat(playerId)}>
        <span className="bj-chip__total tbl-pill tbl-pill--neutral">+{hands.length}</span>
      </button>
    </li>
  );
}

interface Props {
  playerId: string;
  hands: TableHand[];
  timeline: Timeline;
  now: number;
  leaving: boolean;
  /** The hand in play, or -1. */
  activeIndex: number;
  /** `mine`: my hands on the stage at the bottom of the table; `stage`: another player's there, when I am not dealt in. */
  place: HandPlace;
  size: PlayingCardSize;
  /** Each full hand's stake by its total (my hands while they play). */
  stakes?: boolean;
  /** Another player's hands on my stage: their name by the hand in play's total (the first's, between turns). */
  ownerName?: string;
  testId: string;
  chipTestId: string;
}

/**
 * A seat's hands side by side, never scrolling: every hand full size while they fit, the cards
 * shrinking as hands are added; past that the hand in play stays full size and the others fold
 * into chips in a grid beside it, and past what the grid holds the furthest fold into a "+N".
 */
export function HandRow({ playerId, hands, timeline, now, leaving, activeIndex, place, size, stakes = false, ownerName, testId, chipTestId }: Props) {
  const [ref, box] = useSize<HTMLDivElement>(hands.length);
  // A full hand is never narrower than the words over its corner (its stake and total, its outcome).
  const minHand = Math.max(MIN_FULL_HAND_PX[place], (box?.head ?? 0) + HAND_GAP_PX);
  const maxFull = box === null ? hands.length : fullHandsFit(box.width, minHand);
  const slots = handSlots(hands.length, activeIndex, maxFull);
  const full = hands.filter((_, i) => slots[i] === 'full');
  const chipped = hands.flatMap((_, i) => (slots[i] === 'chip' ? [i] : []));
  const chips = chipped.length;
  // My hands have a fixed height to fill; another player's chips keep to a couple of rows.
  const maxRows = place === 'stage' ? STAGE_CHIP_ROWS : fitCount(box?.height ?? 0, MIN_CHIP_PX.height);
  // Before the first measure every chip shows (the server render); the grid caps them once the row has a size.
  // The chips take what the full hands leave (a full hand's least width until it is measured).
  const beside = full.length === 0 ? 0 : Math.max(box?.full ?? 0, minHand + HAND_GAP_PX);
  const grid = box === null ? { cols: chips, rows: 1, shown: chips } : chipGrid(chips, box.width - beside, maxRows, place === 'stage' ? MIN_CHIP_PX.stage : MIN_CHIP_PX.width);
  const shown = chipsShown(chipped, grid.shown, activeIndex);
  const folded = chipped.filter((i) => !shown.has(i)).map((i) => hands[i]);
  const style = { ...fanStyle(full), '--chip-cols': grid.cols, '--chip-rows': grid.rows, '--bj-head-w': `${box?.head ?? 0}px` } as CSSProperties;
  const named = activeIndex >= 0 ? activeIndex : slots.indexOf('full');
  const fullHand = (hand: TableHand, i: number) => (
    <div key={i} className="bj-slot">
      <Hand playerId={playerId} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size={size} active={i === activeIndex} narrow={full.length > 1} stake={stakes} ownerName={i === named ? ownerName : undefined} testId={testId} />
    </div>
  );
  return (
    <div ref={ref} className={`bj-hands bj-hands--${place}${chips > 0 ? ' bj-hands--chips' : ''}`} style={style} data-testid={`${testId}s-row`} data-full={full.length} data-chips={chips} data-more={folded.length}>
      {hands.map((hand, i) => (slots[i] === 'full' ? fullHand(hand, i) : null))}
      {chips > 0 && (
        <ol className="bj-chips" aria-label="Other hands">
          {hands.map((hand, i) => (shown.has(i) ? <HandChip key={i} playerId={playerId} index={i} hand={hand} timeline={timeline} now={now} testId={chipTestId} /> : null))}
          {folded.length > 0 && <MoreChip playerId={playerId} hands={folded} total={hands.length} testId={`${chipTestId}-more`} />}
        </ol>
      )}
    </div>
  );
}
