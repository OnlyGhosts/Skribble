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
import { ARC_LIFT, GRID_GAP, arcLift, fitGrid, fitsRoom, naturalHeight, shapeOf, tierFor, tileHeight, type Room, type TileTier } from './grid';

interface GridProps {
  /** How many tiles there are (the columns go by it, and the tier by the room they have). */
  count: number;
  label: string;
  /** Desktop: wider tiles, set along a gentle arc. */
  wide?: boolean;
  /** No seat has cards yet (before the deal): a full tile keeps to its top rows. */
  bare?: boolean;
  /** The tiles, drawn for the tier the grid settled on. */
  children: (tier: TileTier) => ReactNode;
}

interface Measured {
  /** The grid's own box, inside its padding. */
  box: { width: number; height: number };
  room: Room;
}

/**
 * The grid's own size, and the room the table leaves it: its parent's height less the rows beside
 * it (the head, the ribbon, the stage) and the gaps between them. The corners floating over the
 * table (absolutely placed) take no row. The grid itself is capped to what the tiles need, so the
 * room, not the box, says which tier fits.
 */
function measure(el: HTMLElement): Measured {
  const style = getComputedStyle(el);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const box = { width: el.clientWidth, height: el.clientHeight - padY };
  const parent = el.parentElement;
  if (!parent) return { box, room: { width: box.width, height: box.height } };
  const parentStyle = getComputedStyle(parent);
  let taken = 0;
  let rows = 0;
  for (const child of Array.from(parent.children)) {
    const position = getComputedStyle(child).position;
    if (position === 'absolute' || position === 'fixed') continue;
    rows += 1;
    if (child !== el) taken += (child as HTMLElement).offsetHeight;
  }
  const inner = parent.clientHeight - (parseFloat(parentStyle.paddingTop) || 0) - (parseFloat(parentStyle.paddingBottom) || 0);
  const height = Math.max(0, inner - taken - Math.max(0, rows - 1) * (parseFloat(parentStyle.rowGap) || 0));
  return { box, room: { width: box.width, height } };
}

const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }): boolean => a.width === b.width && a.height === b.height;

/** The grid's size and room, read as it lays out and again whenever it or a row beside it changes. */
function useMeasured(): [RefObject<HTMLUListElement | null>, Measured | null] {
  const ref = useRef<HTMLUListElement | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = measure(el);
      setMeasured((m) => (m && sameSize(m.box, next.box) && sameSize(m.room, next.room) ? m : next));
    };
    read();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    observer?.observe(el);
    for (const sibling of Array.from(el.parentElement?.children ?? [])) if (sibling !== el) observer?.observe(sibling);
    return () => observer?.disconnect();
  }, []);
  return [ref, measured];
}

/**
 * Every other seated player as a tile, in seat order (left to right, top to bottom, the order of
 * play). The grid never scrolls: it takes the space it is given, and the tiles step down in size
 * and detail as the table grows and the room shrinks (grid.ts). On a desktop the rows bow into a
 * gentle arc.
 */
export function PlayersGrid({ count, label, wide = false, bare = false, children }: GridProps) {
  const [ref, measured] = useMeasured();
  // The tier on show stays while it fits (tierFor): remembered across renders, never flipped by a pixel.
  const shown = useRef<TileTier | null>(null);
  const tier = tierFor(count, measured?.room ?? null, { wide, current: shown.current });
  useLayoutEffect(() => {
    shown.current = tier;
  });
  const shape = shapeOf(tier, wide);
  const { cols, rows } = fitGrid(count, measured?.box ?? null, { wide, tier });
  // The height the grid asks for: what its tiles need at their natural size in this width, within the room where the tier fits it.
  const wanted = measured ? naturalHeight(count, measured.box.width, { wide, tier, bare }) : 0;
  const natural = measured ? `${fitsRoom(count, measured.room, { wide, tier }) ? Math.min(wanted, measured.room.height) : wanted}px` : undefined;
  const style = { '--cols': cols, '--rows': rows, '--tile-w': `${shape.width}px`, '--tile-h': `${tileHeight(tier, wide, bare)}px`, '--grid-gap': `${GRID_GAP[tier]}px`, '--arc': `${ARC_LIFT[tier]}px`, '--grid-natural': natural } as CSSProperties;
  return (
    <ul ref={ref} className={`tbl-grid tbl-grid--${tier}${wide ? ' tbl-grid--arc' : ''}`} style={style} aria-label={label} data-testid="seats" data-tier={tier} data-cols={cols} data-count={count}>
      {Children.toArray(children(tier)).map((child, i) => (
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
  /** The tier the grid settled on (PlayersGrid hands it to its children). */
  tier: TileTier;
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
export function PlayerTile({ playerId, name, avatar, connected, tier, turn, turnNote, line, mark, outcome = null, chips, bet, total, dimmed = false, badge, tag, cards, extra, onOpen, shortBadge = false, data }: TileProps) {
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
