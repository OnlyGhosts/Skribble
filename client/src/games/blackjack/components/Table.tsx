import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { PlayingCard, type PlayingCardSize } from '../../../platform/components/PlayingCard';
import { Chips } from '../../../platform/components/Chips';
import { seatOrder } from '../hooks';
import type { TableModel } from '../lib/table';
import type { Frame } from '../lib/timeline';
import { dealerRuleText, ribbonText } from '../lib/text';
import { Dealer } from './Dealer';
import { Hand } from './Hand';
import { Seats } from './Seats';
import { DiscardTray, Shoe } from './Shoe';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  frame: Frame;
  now: number;
  isPhone: boolean;
  chipsOf(id: string): number;
}

function cardsOn(table: TableModel | null): number {
  if (!table) return 0;
  return table.dealer.length + Object.values(table.hands).reduce((sum, hands) => sum + hands.reduce((n, h) => n + h.cards.length, 0), 0);
}

/** My hands, bottom centre: split hands side by side, the one in play lit; two empty slots before my first deal. */
function MyHands({ view, meId, frame, now, isPhone }: Omit<Props, 'room' | 'chipsOf'>) {
  const { table, timeline, leaving } = frame;
  const hands = table?.hands[meId] ?? [];
  const seat = view.players[meId];
  const live = table !== null && !table.settled && !leaving;
  const turnIndex = live && view.phase === 'acting' && view.turn?.playerId === meId ? view.turn.handIndex : -1;
  const size: PlayingCardSize = hands.length > 2 ? 'md' : isPhone ? 'lg' : 'xl';
  const newBet = view.phase === 'betting' && seat && seat.bet > 0 ? seat.bet : 0;
  return (
    <section className={`bj-mine bj-mine--n${Math.max(1, hands.length)}`} aria-label="Your hands" data-testid="my-hands" data-count={hands.length}>
      {hands.length > 0 ? (
        <div className="bj-mine__hands">
          {hands.map((hand, i) => (
            <Hand key={i} playerId={meId} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size={size} active={i === turnIndex} testId="my-hand" />
          ))}
        </div>
      ) : (
        <div className="bj-mine__empty" aria-hidden="true">
          <PlayingCard card={null} size={size} slot testId="my-slot" />
          <PlayingCard card={null} size={size} slot testId="my-slot" />
        </div>
      )}
      {newBet > 0 && (
        <span className="bj-mine__bet" data-testid="my-bet" data-bet={newBet}>
          Bet <Chips value={newBet} size={14} />
        </span>
      )}
    </section>
  );
}

/**
 * The table, Stake style: the discards top left, the dealer top centre, the shoe top right, the
 * ribbon across the middle, the other seats in a strip, my hands at the bottom.
 */
export function Table({ room, view, meId, frame, now, isPhone, chipsOf }: Props) {
  const { table, timeline, leaving } = frame;
  const settings = room.settings;
  const dealt = table?.order ?? [];
  const others = seatOrder(room, view, dealt).filter((id) => id !== meId);
  const discarded = Math.max(0, settings.decks * 52 - view.shoeRemaining - cardsOn(view.dealer.cards.length > 0 ? table : null));
  return (
    <section className={`bj-table${leaving ? ' bj-table--leaving' : ''}`} aria-label="Table" data-testid="bj-table" data-round={table?.round ?? 0} data-settled={table?.settled ?? false}>
      <div className="bj-table__top">
        <DiscardTray discarded={discarded} />
        <Dealer table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'lg' : 'xl'} />
        <Shoe remaining={view.shoeRemaining} reshuffled={view.reshuffled} />
      </div>
      <div className="bj-ribbon" data-testid="table-ribbon">
        <span className="bj-ribbon__main">{ribbonText(settings.blackjackPayout)}</span>
        <span className="bj-ribbon__sub">{dealerRuleText(settings.dealerHitsSoft17)}</span>
      </div>
      <Seats room={room} view={view} ids={others} table={table} timeline={timeline} now={now} leaving={leaving} chipsOf={chipsOf} />
      <MyHands view={view} meId={meId} frame={frame} now={now} isPhone={isPhone} />
    </section>
  );
}
