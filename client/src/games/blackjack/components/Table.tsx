import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { tileTier } from '../../../platform/table/grid';
import { useTightStage } from '../../../platform/table/stage';
import { Deck, DiscardTray } from '../../../platform/table/Deck';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { playerOf, seatOrder } from '../hooks';
import { useBlackjack } from '../store';
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
  chipsOf(id: string): number;
}

/**
 * The table, top to bottom, never scrolling: the dealer between the discards and the shoe; the
 * ribbon; the spotlight; every other player as a tile in seat order; my hands. The dealer and my
 * hands keep their place and their size through every phase (the stage's first and last rows are
 * fixed, blackjack.css); only the spotlight and the tiles in between change to show what is going on.
 */
export function Table({ room, view, meId, truth, frame, now, isPhone, subject, chipsOf }: Props) {
  const { table, timeline, leaving } = frame;
  const settings = room.settings;
  const dealt = table?.order ?? [];
  const others = seatOrder(room, view, dealt).filter((id) => id !== meId);
  const swept = useBlackjack((s) => s.swept);
  const discarded = discardedCount(swept, truth, table);
  const seated = view.players[meId] !== undefined;
  const crowd = others.length === 0 ? 'none' : tileTier(others.length);
  const tight = useTightStage(isPhone, others.length);
  return (
    <section
      className={`tbl-felt tbl-stage bj-table tbl-crowd--${crowd}${tight ? ' tbl-stage--tight' : ''}${seated ? '' : ' tbl-stage--no-mine'}${leaving ? ' bj-table--leaving' : ''}`}
      aria-label="Table"
      data-testid="bj-table"
      data-round={table?.round ?? 0}
      data-settled={table?.settled ?? false}
      data-crowd={crowd}
    >
      <div className="tbl-felt__top bj-top">
        <DiscardTray discarded={discarded} />
        <Dealer table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'md' : 'lg'} />
        <Deck name="shoe" testId="shoe" />
      </div>
      <TableRibbon main={ribbonText(settings.blackjackPayout)} sub={dealerRuleText(settings.dealerHitsSoft17)} />
      <BjSpotlight room={room} view={view} meId={meId} subject={subject} frame={frame} now={now} size={isPhone ? 'lg' : 'xl'} tight={tight} />
      <Seats room={room} view={view} ids={others} meId={meId} table={table} timeline={timeline} now={now} leaving={leaving} wide={!isPhone} chipsOf={chipsOf} />
      {seated && <MyHands view={view} meId={meId} frame={frame} now={now} avatar={playerOf(room, meId)?.avatar} />}
    </section>
  );
}
