import { useEffect, useRef, type ReactNode } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { Chips } from '../components/Chips';
import { prefersReducedMotion } from '../lib/media';

interface StripProps {
  /** The seat whose turn it is: lit and scrolled into view. */
  turnId: string | undefined;
  label: string;
  /** Scroll back to the start when the turn is on a seat outside the strip (mine). */
  homeWhenAway?: boolean;
  children: ReactNode;
}

/**
 * The other players in one horizontal strip that never collapses: it scrolls sideways rather than
 * squeezing, and keeps the seat whose turn it is in view (back to the start between turns).
 */
/** The parts of the strip's list element the scroll reads. */
export interface ScrollableStrip {
  clientWidth: number;
  scrollTo?(options: ScrollToOptions): void;
  querySelector<E extends Element = HTMLElement>(selector: string): E | null;
}

/**
 * Brings the turn seat to the middle of the strip (back to the start with no turn, or when the turn
 * is mine and `homeWhenAway`). Under reduced motion it jumps instead of gliding.
 */
export function scrollStrip(list: ScrollableStrip, turnId: string | undefined, homeWhenAway: boolean, reduced: boolean): void {
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
  if (!turnId) {
    list.scrollTo?.({ left: 0, behavior });
    return;
  }
  const el = list.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(turnId)}"]`);
  if (!el) {
    if (homeWhenAway) list.scrollTo?.({ left: 0, behavior });
    return;
  }
  const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
  list.scrollTo?.({ left: Math.max(0, left), behavior });
}

export function SeatStrip({ turnId, label, homeWhenAway = false, children }: StripProps) {
  const strip = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (strip.current) scrollStrip(strip.current, turnId, homeWhenAway, prefersReducedMotion());
  }, [turnId, homeWhenAway]);

  return (
    <ul ref={strip} className="tbl-seats" aria-label={label} data-testid="seats">
      {children}
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

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface SeatProps {
  playerId: string;
  name: string;
  avatar: AvatarData;
  connected: boolean;
  /** The stack on show. */
  chips: number;
  line: SeatLine;
  turn: boolean;
  /** Out of the game or the hand (busted, folded): dimmed. */
  dimmed?: boolean;
  /** After the name (the dealer button). */
  badge?: ReactNode;
  /** After the line (the bet in front of the seat). */
  meta?: ReactNode;
  /** Extra classes (an outcome outline). */
  className?: string;
  data?: DataAttrs;
  /** The cards in miniature. */
  children?: ReactNode;
}

/** One mini seat in the strip: avatar, name, chips and a line on what the seat is doing, the cards under them. */
export function MiniSeat({ playerId, name, avatar, connected, chips, line, turn, dimmed = false, badge, meta, className, data, children }: SeatProps) {
  return (
    <li
      className={`tbl-seat${turn ? ' tbl-seat--turn' : ''}${dimmed ? ' tbl-seat--dim' : ''}${className ? ` ${className}` : ''}`}
      data-testid="seat"
      data-player-id={playerId}
      data-name={name}
      data-state={line.state}
      data-turn={turn}
      aria-current={turn ? 'true' : undefined}
      {...data}
    >
      <div className="tbl-seat__who" data-table-anchor={`seat:${playerId}`}>
        <Avatar avatar={avatar} size="sm" dimmed={!connected} />
        <span className="tbl-seat__id">
          {badge ? (
            <span className="tbl-seat__name-row">
              <span className="tbl-seat__name">{name}</span>
              {badge}
            </span>
          ) : (
            <span className="tbl-seat__name">{name}</span>
          )}
          <span className="tbl-seat__meta">
            <Chips value={chips} size={12} className="tbl-seat__chips" />
            <span className={`tbl-seat__line tbl-seat__line--${line.tone}`} data-testid="seat-line">
              {line.text}
            </span>
            {meta}
          </span>
        </span>
      </div>
      <div className="tbl-seat__cards">{children}</div>
    </li>
  );
}
