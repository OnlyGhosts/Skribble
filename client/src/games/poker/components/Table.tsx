import type { ReactNode } from 'react';
import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { ChipFlights } from '../../../platform/table/ChipFlights';
import { Deck, DiscardTray } from '../../../platform/table/Deck';
import { tileTier } from '../../../platform/table/grid';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { playerOf, seatRing } from '../hooks';
import type { PkSubject } from '../lib/spotlight';
import type { PokerTable } from '../lib/table';
import { POT_VALUE, flightsAt, valueAt, type Frame, type Timeline } from '../lib/timeline';
import { RIBBON_TEXT, blindsLabel } from '../lib/text';
import { Board } from './Board';
import { MyHand } from './MyHand';
import { Pot } from './Pot';
import { Seats } from './Seats';
import { PkSpotlight } from './Spotlight';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  frame: Frame;
  /** The current timeline: the numbers on show step by it even while the last hand's cards clear. */
  live: Timeline;
  now: number;
  isPhone: boolean;
  subject: PkSubject;
  /** The turn clock, in the spotlight. */
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
 * The table, the same layout as Blackjack's: the muck, the pot over the board and the deck at the
 * top; the ribbon; the spotlight on the player to act; every other player as a tile round the
 * table from my left; my hand at the bottom (up in the spotlight on my turn). Chips fly over it all.
 */
export function Table({ room, view, meId, frame, live, now, isPhone, subject, clock }: Props) {
  const { table, timeline, leaving } = frame;
  const others = seatRing(room, view, meId).filter((id) => id !== meId);
  const truth = view.phase === 'acting' ? view.pot : 0;
  const mineInSpot = (subject.kind === 'turn' || subject.kind === 'result') && subject.mine;
  const showMine = view.players[meId] !== undefined && !mineInSpot;
  const crowd = others.length === 0 ? 'none' : tileTier(others.length);
  return (
    <section
      className={`tbl-felt tbl-stage pk-table tbl-crowd--${crowd}${showMine ? '' : ' tbl-stage--no-mine'}`}
      aria-label="Table"
      data-testid="pk-table"
      data-hand={table?.hand ?? 0}
      data-street={table?.street ?? ''}
      data-settled={Boolean(table?.results)}
      data-crowd={crowd}
    >
      <div className="tbl-felt__top pk-top">
        <DiscardTray discarded={mucked(table)} label="Muck" />
        <div className="pk-centre">
          <div className="pk-centre__row">
            <Pot shown={valueAt(live, POT_VALUE, truth, now)} truth={truth} pots={view.phase === 'acting' ? view.pots : []} />
            <span className="pk-blinds">{`Blinds ${blindsLabel(view)}`}</span>
          </div>
          <Board table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'md' : 'lg'} />
        </div>
        <Deck remaining={52 - dealt(table)} name="deck" testId="deck" />
      </div>
      <TableRibbon main={RIBBON_TEXT} sub={`Blinds ${blindsLabel(view)}`} />
      <PkSpotlight room={room} view={view} meId={meId} subject={subject} table={table} timeline={timeline} live={live} now={now} leaving={leaving} size={isPhone ? 'lg' : 'xl'} clock={clock} />
      <Seats room={room} view={view} ids={others} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} wide={!isPhone} />
      {showMine && <MyHand view={view} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} size={isPhone ? 'lg' : 'xl'} place="bottom" avatar={playerOf(room, meId)?.avatar} />}
      <ChipFlights flights={flightsAt(live, now)} />
    </section>
  );
}
