import type { ReactNode } from 'react';
import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { ChipFlights } from '../../../platform/table/ChipFlights';
import { Deck, DiscardCorner } from '../../../platform/table/Deck';
import { tileTier } from '../../../platform/table/grid';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { TurnLine } from '../../../platform/table/TurnLine';
import { nameOf, seatRing } from '../hooks';
import type { PkFocus } from '../lib/focus';
import type { PokerTable } from '../lib/table';
import { POT_VALUE, flightsAt, valueAt, type Frame, type Timeline } from '../lib/timeline';
import { focusLine, handLabel, ribbonText } from '../lib/text';
import { Board } from './Board';
import { Pot } from './Pot';
import { Seats } from './Seats';
import { Stage } from './Stage';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  frame: Frame;
  /** The current timeline: the numbers on show step by it even while the last hand's cards clear. */
  live: Timeline;
  now: number;
  isPhone: boolean;
  focus: PkFocus;
  /** The turn clock, in the line under the ribbon. */
  clock: ReactNode;
}

/** Cards out of the deck for the hand on the table: two a seat and the board. */
function dealt(table: PokerTable | null): number {
  return table ? table.order.length * 2 + table.community.length : 0;
}

/** Folded hands in the muck. */
function mucked(table: PokerTable | null): number {
  return table ? table.order.filter((id) => table.seats[id]?.status === 'folded').length * 2 : 0;
}

/**
 * The table, calm and never scrolling, the same places as Blackjack's, top to bottom: the pot over
 * the board big at the top centre (the deck peeking in at the top right corner, the folds going
 * off past the top left); the banner with the blinds and whose turn it is with the clock; every
 * other player as a compact seat round the table from my left; the stage with my two cards.
 * Chips fly over it all.
 */
export function Table({ room, view, meId, frame, live, now, isPhone, focus, clock }: Props) {
  const { table, timeline, leaving } = frame;
  const others = seatRing(room, view, meId).filter((id) => id !== meId);
  const truth = view.phase === 'acting' ? view.pot : 0;
  const crowd = others.length === 0 ? 'none' : tileTier(others.length);
  const line = focusLine(focus, { view, meId, nameOf: (id) => nameOf(room, id), results: table?.results ?? null });
  return (
    <section
      className={`tbl-felt tbl-felt--calm pk-table tbl-crowd--${crowd}`}
      aria-label="Table"
      data-testid="pk-table"
      data-hand={table?.hand ?? 0}
      data-street={table?.street ?? ''}
      data-settled={Boolean(table?.results)}
      data-crowd={crowd}
    >
      <DiscardCorner discarded={mucked(table)} />
      <Deck remaining={52 - dealt(table)} name="deck" testId="deck" corner />
      <div className="pk-centre">
        <Pot shown={valueAt(live, POT_VALUE, truth, now)} truth={truth} pots={view.phase === 'acting' ? view.pots : []} blinds={ribbonText(view)} />
        <Board table={table} timeline={timeline} now={now} leaving={leaving} />
      </div>
      <TableRibbon main={ribbonText(view)} sub={handLabel(view)} note={<TurnLine text={line.text} tone={line.tone} state={line.state} sub={line.sub} clock={clock} />} />
      <Seats room={room} view={view} ids={others} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} wide={!isPhone} />
      <Stage room={room} view={view} meId={meId} focus={focus} table={table} timeline={timeline} live={live} now={now} leaving={leaving} isPhone={isPhone} />
      <ChipFlights flights={flightsAt(live, now)} />
    </section>
  );
}
