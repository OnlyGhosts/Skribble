import { Children, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { ChipIcon, Chips } from '../components/Chips';
import { CheckIcon, CloseIcon, SparkIcon } from '../components/Icons';
import { CardsIcon, OutIcon, StarIcon } from './Icons';
import { TotalPill, type Tone } from './Outcome';
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
  const style = { '--cols': cols, '--rows': rows, '--tile-w': `${shape.width}px`, '--tile-h': `${shape.height}px` } as CSSProperties;
  return (
    <ul ref={ref} className={`tbl-grid tbl-grid--${tier}${wide ? ' tbl-grid--arc' : ''}`} style={style} aria-label={label} data-testid="seats" data-tier={tier} data-cols={cols} data-count={count}>
      {Children.toArray(children).map((child, i) => (
        <li key={i} className="tbl-grid__cell" style={wide ? ({ '--lift': arcLift(i % cols, Math.min(cols, count - Math.floor(i / cols) * cols)) } as CSSProperties) : undefined}>
          {child}
        </li>
      ))}
    </ul>
  );
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
  line: SeatLine;
  mark: SeatMark;
  /** The settled outcome, kept on show until the next deal. */
  outcome?: SeatOutcome | null;
  /** The stack (full tiles only). */
  chips?: number;
  /** The stake in front of the seat. */
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
  /** A compact tile shows the status line (Poker's last move) in place of the bet. */
  compactLine?: boolean;
  data?: DataAttrs;
}

/** One player in the grid; how much it shows depends on the tier (table.css lays each tier out). */
export function PlayerTile({ playerId, name, avatar, connected, count, turn, line, mark, outcome = null, chips, bet, total, dimmed = false, badge, tag, cards, extra, onOpen, compactLine = false, data }: TileProps) {
  const tier: TileTier = tileTier(count);
  return (
    <div
      className={`tbl-tile tbl-tile--${tier}${turn ? ' tbl-tile--turn' : ''}${dimmed ? ' tbl-tile--dim' : ''}${outcome ? ` tbl-tile--${outcome}` : ''}${compactLine ? ' tbl-tile--line' : ''}`}
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
        {chips !== undefined && <Chips value={chips} size={11} className="tbl-tile__chips" />}
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
        <span className="tbl-tile__tag tbl-tile__tag--turn" data-testid="seat-playing">
          Playing
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
