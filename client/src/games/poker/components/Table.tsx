import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { ChipFlights } from '../../../platform/table/ChipFlights';
import { Deck, DiscardTray } from '../../../platform/table/Deck';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { seatRing } from '../hooks';
import type { PokerTable } from '../lib/table';
import { POT_VALUE, flightsAt, valueAt, type Frame, type Timeline } from '../lib/timeline';
import { RIBBON_TEXT, blindsLabel } from '../lib/text';
import { Board } from './Board';
import { MyHand } from './MyHand';
import { Pot } from './Pot';
import { Seats } from './Seats';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  frame: Frame;
  /** The current timeline: the numbers on show step by it even while the last hand's cards clear. */
  live: Timeline;
  now: number;
  isPhone: boolean;
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
 * The table, the same layout as Blackjack's: the muck top left, the pot top centre, the deck top
 * right, the board across the middle with the ribbon under it, the other seats in a strip, my
 * hand at the bottom. Chips fly over it all.
 */
export function Table({ room, view, meId, frame, live, now, isPhone }: Props) {
  const { table, timeline, leaving } = frame;
  const others = seatRing(room, view, meId).filter((id) => id !== meId);
  const truth = view.phase === 'acting' ? view.pot : 0;
  return (
    <section className="tbl-felt pk-table" aria-label="Table" data-testid="pk-table" data-hand={table?.hand ?? 0} data-street={table?.street ?? ''} data-settled={Boolean(table?.results)}>
      <div className="tbl-felt__top">
        <DiscardTray discarded={mucked(table)} label="Muck" />
        <Pot shown={valueAt(live, POT_VALUE, truth, now)} truth={truth} pots={view.phase === 'acting' ? view.pots : []} />
        <Deck remaining={52 - dealt(table)} name="deck" testId="deck" />
      </div>
      <Board table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'md' : 'lg'} />
      <TableRibbon main={RIBBON_TEXT} sub={`Blinds ${blindsLabel(view)}`} />
      <Seats room={room} view={view} ids={others} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} />
      <MyHand view={view} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} size={isPhone ? 'lg' : 'xl'} />
      <ChipFlights flights={flightsAt(live, now)} />
    </section>
  );
}
