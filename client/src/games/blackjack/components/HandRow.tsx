import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Chips } from '../../../platform/components/Chips';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { outlineClass } from '../../../platform/table/Outcome';
import { HAND_GAP_PX, MIN_CHIP_PX, MIN_FULL_HAND_PX, SPOT_CHIP_ROWS, chipGrid, chipsShown, fitCount, fullHandsFit, handSlots } from '../lib/hands';
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
}

/** The full hands' slots in a row of hands, and the gap after each. */
function fullWidth(el: HTMLElement): number {
  return Array.from(el.children).reduce((sum, c) => (c.classList.contains('bj-slot') ? sum + c.getBoundingClientRect().width + HAND_GAP_PX : sum), 0);
}

/** A row's size as it lays out (null until measured, and on the server render), and its full hands' width. */
function useSize<T extends HTMLElement>(): [RefObject<T | null>, Size | null] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const next = { width: el.clientWidth, height: el.clientHeight, full: Math.ceil(fullWidth(el)) };
    setSize((s) => (s && s.width === next.width && s.height === next.height && s.full === next.full ? s : next));
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A hand's width changes with its cards, not the row's: measured again after every render.
  useLayoutEffect(measure);
  return [ref, size];
}

/**
 * How many full hands share the width and the most cards in any of them: the stylesheet sizes the
 * cards so every hand fits its share (blackjack.css, --fit-w), however many hits.
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
      <Chips value={hand.bet} size={10} className="bj-chip__bet" />
    </li>
  );
}

/** The hands that did not get a chip of their own: how many, their stakes together; a tap opens every hand. */
function MoreChip({ playerId, hands, total, testId }: { playerId: string; hands: TableHand[]; total: number; testId: string }) {
  const stake = hands.reduce((sum, h) => sum + h.bet, 0);
  return (
    <li className="bj-chip bj-chip--more tbl-outline tbl-outline--neutral" data-testid={testId} data-count={hands.length}>
      <button type="button" className="bj-chip__more" aria-label={`${hands.length} more hands. Show all ${total}`} onClick={() => useBlackjackStore.getState().openSeat(playerId)}>
        <span className="bj-chip__total tbl-pill tbl-pill--neutral">+{hands.length}</span>
        <Chips value={stake} size={10} className="bj-chip__bet" />
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
  /** My hands at the bottom of the table (larger totals, each hand in a fixed slot), or the spotlight's. */
  place: 'mine' | 'spot';
  size: PlayingCardSize;
  testId: string;
  chipTestId: string;
}

/**
 * A seat's hands side by side, never scrolling: every hand full size while they fit, the cards
 * shrinking as hands are added; past that the hand in play stays full size and the others fold
 * into chips in a grid beside it, and past what the grid holds the furthest fold into a "+N".
 */
export function HandRow({ playerId, hands, timeline, now, leaving, activeIndex, place, size, testId, chipTestId }: Props) {
  const [ref, box] = useSize<HTMLDivElement>();
  const minHand = MIN_FULL_HAND_PX[place];
  const maxFull = box === null ? hands.length : fullHandsFit(box.width, minHand);
  const slots = handSlots(hands.length, activeIndex, maxFull);
  const full = hands.filter((_, i) => slots[i] === 'full');
  const chipped = hands.flatMap((_, i) => (slots[i] === 'chip' ? [i] : []));
  const chips = chipped.length;
  // My hands have a fixed height to fill; the spotlight's chips keep to a couple of rows.
  const maxRows = place === 'mine' ? fitCount(box?.height ?? 0, MIN_CHIP_PX.height) : SPOT_CHIP_ROWS;
  // Before the first measure every chip shows (the server render); the grid caps them once the row has a size.
  // The chips take what the full hands leave (a full hand's least width until it is measured).
  const beside = full.length === 0 ? 0 : Math.max(box?.full ?? 0, minHand + HAND_GAP_PX);
  const grid = box === null ? { cols: chips, rows: 1, shown: chips } : chipGrid(chips, box.width - beside, maxRows, place === 'mine' ? MIN_CHIP_PX.width : MIN_CHIP_PX.spot);
  const shown = chipsShown(chipped, grid.shown, activeIndex);
  const folded = chipped.filter((i) => !shown.has(i)).map((i) => hands[i]);
  const style = { ...fanStyle(full), '--chip-cols': grid.cols, '--chip-rows': grid.rows } as CSSProperties;
  const fullHand = (hand: TableHand, i: number) => (
    <div key={i} className="bj-slot">
      <Hand playerId={playerId} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size={size} active={i === activeIndex} big={place === 'mine'} testId={testId} />
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
