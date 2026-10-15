import type { ReactNode } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { tileTier } from '../../../platform/table/grid';
import { Deck, DiscardTray } from '../../../platform/table/Deck';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { playerOf, seatOrder } from '../hooks';
import type { BjSubject } from '../lib/spotlight';
import { discardedCount, type TableModel } from '../lib/table';
import type { Frame } from '../lib/timeline';
import { dealerRuleText, ribbonText } from '../lib/text';
import { Dealer } from './Dealer';
import { MyHands } from './MyHands';
import { Seats } from './Seats';
import { BjSpotlight } from './Spotlight';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  /** The table in the latest snapshot (the frame may still show the old one leaving). */
  truth: TableModel | null;
  frame: Frame;
  now: number;
  isPhone: boolean;
  subject: BjSubject;
  /** The turn clock, in the spotlight. */
  clock: ReactNode;
  chipsOf(id: string): number;
}

/**
 * The table, top to bottom, never scrolling: the discards, the dealer and the shoe; the ribbon;
 * the spotlight on the hand being played; every other player as a tile in seat order; my hands.
 * The dealer and my hands move up into the spotlight when it is on them, so nothing shows twice.
 */
export function Table({ room, view, meId, truth, frame, now, isPhone, subject, clock, chipsOf }: Props) {
  const { table, timeline, leaving } = frame;
  const settings = room.settings;
  const dealt = table?.order ?? [];
  const others = seatOrder(room, view, dealt).filter((id) => id !== meId);
  const discarded = discardedCount(view.shoeSize, view.shoeRemaining, truth, table);
  const seated = view.players[meId] !== undefined;
  const mineInSpot = (subject.kind === 'turn' && subject.mine) || subject.kind === 'result';
  const showMine = seated && !mineInSpot;
  const crowd = others.length === 0 ? 'none' : tileTier(others.length);
  return (
    <section
      className={`tbl-felt tbl-stage bj-table tbl-crowd--${crowd}${showMine ? '' : ' tbl-stage--no-mine'}${leaving ? ' bj-table--leaving' : ''}`}
      aria-label="Table"
      data-testid="bj-table"
      data-round={table?.round ?? 0}
      data-settled={table?.settled ?? false}
      data-crowd={crowd}
    >
      <div className="tbl-felt__top bj-top">
        <DiscardTray discarded={discarded} />
        {subject.kind === 'dealer' ? (
          <div className="bj-dealer bj-dealer--away" aria-hidden="true">
            <span className="bj-dealer__label">Dealer</span>
          </div>
        ) : (
          <Dealer table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'md' : 'lg'} />
        )}
        <Deck remaining={view.shoeRemaining} note={view.reshuffled ? 'New shoe' : undefined} name="shoe" testId="shoe" />
      </div>
      <TableRibbon main={ribbonText(settings.blackjackPayout)} sub={dealerRuleText(settings.dealerHitsSoft17)} />
      <BjSpotlight room={room} view={view} meId={meId} subject={subject} frame={frame} now={now} size={isPhone ? 'lg' : 'xl'} clock={clock} />
      <Seats room={room} view={view} ids={others} table={table} timeline={timeline} now={now} leaving={leaving} wide={!isPhone} chipsOf={chipsOf} />
      {showMine && <MyHands view={view} meId={meId} frame={frame} now={now} size={isPhone ? 'md' : 'lg'} place="bottom" avatar={playerOf(room, meId)?.avatar} />}
    </section>
  );
}
