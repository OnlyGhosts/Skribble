import { Children, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { ChipIcon } from '../components/Chips';
import { CheckIcon, CloseIcon, SparkIcon } from '../components/Icons';
import { CardsIcon, OutIcon, StarIcon } from './Icons';
import { TotalPill, type Tone } from './Outcome';
import { StackCount } from './Stakes';
import type { StakeFormat } from './stakes';
import { TIER_SHAPES, WIDE_TIER_SHAPES, arcLift, fitGrid, tileTier, type TileTier } from './grid';

interface GridProps {
  /** How many tiles there are (the tier and the columns go by it). */
  count: number;
  label: string;
  /** Desktop: wider tiles, set along a gentle arc. */
  wide?: boolean;
  children: ReactNode;
}

/** The grid's size, read as it lays out: the columns are fitted to it. */
function useBox(): [RefObject<HTMLUListElement | null>, { width: number; height: number; gap: number } | null] {
  const ref = useRef<HTMLUListElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number; gap: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const next = { width: el.clientWidth - (padX || 0), height: el.clientHeight - (padY || 0), gap: parseFloat(style.rowGap) || 0 };
      setBox((b) => (b && b.width === next.width && b.height === next.height && b.gap === next.gap ? b : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);
  return [ref, box];
}

/** How far the ends of a desktop row lift: a gentle arc for a few big tiles, barely a curve for many small ones (it costs height). */
const ARC_LIFT: Record<TileTier, number> = { full: 16, compact: 16, small: 8, dense: 4 };

/**
 * Every other seated player as a tile, in seat order (left to right, top to bottom, the order of
 * play). The grid never scrolls: it takes the space it is given, and the tiles step down in size
 * and detail as the table grows (grid.ts). On a desktop the rows bow into a gentle arc.
 */
export function PlayersGrid({ count, label, wide = false, children }: GridProps) {
  const [ref, box] = useBox();
  const tier = tileTier(count);
  const shape = (wide ? WIDE_TIER_SHAPES : TIER_SHAPES)[tier];
  const { cols, rows } = fitGrid(count, box, { wide, gap: box?.gap });
  const style = { '--cols': cols, '--rows': rows, '--tile-w': `${shape.width}px`, '--tile-h': `${shape.height}px`, '--arc': `${ARC_LIFT[tier]}px` } as CSSProperties;
  return (
    <ul ref={ref} className={`tbl-grid tbl-grid--${tier}${wide ? ' tbl-grid--arc' : ''}`} style={style} aria-label={label} data-testid="seats" data-tier={tier} data-cols={cols} data-count={count}>
      {Children.toArray(children).map((child, i) => (
        <li key={isValidElement(child) && child.key !== null ? child.key : i} className="tbl-grid__cell" style={wide ? arcCell(i, cols, count) : undefined}>
          {child}
        </li>
      ))}
    </ul>
  );
}

/**
 * A desktop tile's place on the arc: its lift, and on a short last row the half-column it starts
 * at, so that row sits centred under the others (the arc grid has two tracks a column).
 */
function arcCell(i: number, cols: number, count: number): CSSProperties {
  const row = Math.floor(i / cols);
  const inRow = Math.min(cols, count - row * cols);
  const col = i % cols;
  const style: Record<string, string | number> = { '--lift': arcLift(col, inRow) };
  if (col === 0 && inRow < cols) style.gridColumnStart = cols - inRow + 1;
  return style as CSSProperties;
}

/** How a seat's status line reads: the turn in the accent, a settled result strong, out in red, the rest quiet. */
export type SeatLineTone = 'turn' | 'strong' | 'bad' | 'quiet';

export interface SeatLine {
  /** The game's own state name, for data-state. */
  state: string;
  text: string;
  tone: SeatLineTone;
}

/**
 * The seat's status at a glance, as the icon in a compact tile and the dot on a small one: on
 * turn, still to act, done, a bet down, an outcome, out of chips, sitting out, folded, all in.
 */
export type SeatMark = 'turn' | 'waiting' | 'done' | 'bet' | 'win' | 'blackjack' | 'loss' | 'push' | 'out' | 'idle' | 'folded' | 'allin';

function MarkIcon({ mark }: { mark: SeatMark }) {
  const p = { size: 10, strokeWidth: 2.8 };
  switch (mark) {
    case 'turn':
      return <CardsIcon {...p} />;
    case 'done':
    case 'win':
      return <CheckIcon {...p} strokeWidth={3.2} />;
    case 'bet':
      return <ChipIcon {...p} />;
    case 'blackjack':
      return <StarIcon {...p} />;
    case 'loss':
    case 'folded':
      return <CloseIcon {...p} />;
    case 'out':
      return <OutIcon {...p} />;
    case 'allin':
      return <SparkIcon {...p} />;
    default:
      return null;
  }
}

/** How a seat's last hand went, once settled: the tile takes the outcome's colour. */
export type SeatOutcome = 'win' | 'blackjack' | 'loss' | 'push';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface TileProps {
  playerId: string;
  name: string;
  avatar: AvatarData;
  connected: boolean;
  /** How many tiles the grid holds: the tier goes by it. */
  count: number;
  /** Whose turn it is: a thick lime ring and the Playing tag. */
  turn: boolean;
  /** On turn but not playing it (the phone went quiet): this word in a plain tag instead of Playing. */
  turnNote?: string;
  line: SeatLine;
  mark: SeatMark;
  /** The settled outcome, kept on show until the next deal. */
  outcome?: SeatOutcome | null;
  /** The stack, in words ("1,000 chips"; "1.2k chips" where a tile is too small for the full figure). */
  chips?: number;
  /** The stake in front of the seat, as its own labelled pill (StakePill). */
  bet?: ReactNode;
  /** The total, shown wherever the cards are not. */
  total?: { text: string; tone: Tone } | null;
  /** Folded, out, not dealt in: dimmed. */
  dimmed?: boolean;
  /** After the name (the dealer button). */
  badge?: ReactNode;
  /** A word in the corner ("All in"). */
  tag?: string | null;
  /** The cards in miniature, on full tiles. */
  cards?: ReactNode;
  /** Laid over the tile (a payout rising). */
  extra?: ReactNode;
  /** Opens the seat's sheet with its full hand. */
  onOpen?(): void;
  /** The total only stands in for the stack (Poker's): shown only where the tile is too short for the stack in words. */
  shortBadge?: boolean;
  data?: DataAttrs;
}

/**
 * How a tile writes its figures: in full on a full tile, in full where it fits on a compact one
 * (1,040 and 1,000 never both read "1k"), short on the small tiers.
 */
export function tileFigures(tier: TileTier): StakeFormat {
  if (tier === 'full') return 'full';
  return tier === 'compact' ? 'fit' : 'short';
}

/** One player in the grid; how much it shows depends on the tier (table.css lays each tier out). */
export function PlayerTile({ playerId, name, avatar, connected, count, turn, turnNote, line, mark, outcome = null, chips, bet, total, dimmed = false, badge, tag, cards, extra, onOpen, shortBadge = false, data }: TileProps) {
  const tier: TileTier = tileTier(count);
  return (
    <div
      className={`tbl-tile tbl-tile--${tier}${turn ? ' tbl-tile--turn' : ''}${dimmed ? ' tbl-tile--dim' : ''}${outcome ? ` tbl-tile--${outcome}` : ''}${shortBadge ? ' tbl-tile--short-badge' : ''}`}
      data-testid="seat"
      data-player-id={playerId}
      data-name={name}
      data-state={line.state}
      data-mark={mark}
      data-result={outcome ?? undefined}
      data-turn={turn}
      aria-current={turn ? 'true' : undefined}
      {...data}
    >
      <span className="tbl-tile__face" data-table-anchor={`seat:${playerId}`}>
        <Avatar avatar={avatar} size="sm" dimmed={!connected} />
        <span className={`tbl-tile__mark tbl-tile__mark--${mark}`} aria-hidden="true">
          <MarkIcon mark={mark} />
        </span>
      </span>
      <span className="tbl-tile__name">
        <span className="tbl-tile__name-text">{name}</span>
        {badge}
      </span>
      <span className="tbl-tile__meta">
        {chips !== undefined && <StackCount value={chips} format={tileFigures(tier)} className="tbl-tile__chips" testId="seat-chips" />}
        {bet !== undefined && <span className="tbl-tile__bet">{bet}</span>}
        <span className={`tbl-tile__line tbl-tile__line--${line.tone}`} data-testid="seat-line">
          {line.text}
        </span>
      </span>
      {total && (
        <span className="tbl-tile__total">
          <TotalPill tone={total.tone} testId="seat-total">
            {total.text}
          </TotalPill>
        </span>
      )}
      {tier === 'full' && cards && <span className="tbl-tile__cards">{cards}</span>}
      {turn ? (
        <span className={`tbl-tile__tag${turnNote ? '' : ' tbl-tile__tag--turn'}`} data-testid="seat-playing">
          {turnNote ?? 'Playing'}
        </span>
      ) : (
        tag && <span className="tbl-tile__tag">{tag}</span>
      )}
      {extra}
      {onOpen && (
        <button type="button" className="tbl-tile__open" onClick={onOpen} aria-label={`${name}: ${line.text || 'seat'}. Show details`} data-testid="seat-open" />
      )}
    </div>
  );
}

/** A seat's full detail, opened by tapping its tile: the game draws what goes in it. */
export function SeatSheet({ title, onClose, children }: { title: string | null; onClose(): void; children: ReactNode }) {
  return (
    <BottomSheet open={title !== null} title={title ?? ''} onClose={onClose} testId="seat-sheet">
      <div className="tbl-seat-sheet">{children}</div>
    </BottomSheet>
  );
}
