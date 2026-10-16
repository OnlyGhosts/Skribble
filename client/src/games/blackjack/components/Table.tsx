import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { tileTier } from '../../../platform/table/grid';
import { Deck, DiscardCorner } from '../../../platform/table/Deck';
import { TableRibbon } from '../../../platform/table/Ribbon';
import { TurnLine } from '../../../platform/table/TurnLine';
import { nameOf, seatOrder } from '../hooks';
import { useBlackjack } from '../store';
import { seatOutcome, type BjFocus } from '../lib/focus';
import { discardedCount, type TableModel } from '../lib/table';
import type { Frame } from '../lib/timeline';
import { DEALER_RULE_TEXT, RIBBON_TEXT, focusLine } from '../lib/text';
import { Dealer } from './Dealer';
import { Seats } from './Seats';
import { Stage } from './Stage';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  /** The table in the latest snapshot (the frame may still show the old one leaving). */
  truth: TableModel | null;
  frame: Frame;
  now: number;
  isPhone: boolean;
  focus: BjFocus;
  chipsOf(id: string): number;
}

/** The line under the ribbon: whose turn it is, the bets, the dealer, my result. */
function BjTurnLine({ room, view, meId, focus, frame }: { room: BlackjackRoomState; view: BlackjackView; meId: string; focus: BjFocus; frame: Frame }) {
  const hands = frame.table?.hands[focus.kind === 'turn' ? focus.playerId : meId] ?? [];
  const line = focusLine(focus, {
    nameOf: (id) => nameOf(room, id),
    meId,
    handCount: focus.kind === 'turn' ? (view.players[focus.playerId]?.hands.length ?? hands.length) : 0,
    result: focus.kind === 'result' ? { outcome: seatOutcome(hands) ?? 'push', back: hands.reduce((sum, h) => sum + (h.payout ?? 0), 0) } : undefined,
  });
  return <TurnLine text={line.text} tone={line.tone} state={line.state} sub={line.sub} subTestId={focus.kind === 'bets' ? 'bets-count' : 'turn-sub'} />;
}

/**
 * The table, calm and never scrolling, top to bottom: the dealer's hand big at the top centre
 * (the shoe peeking in at the top right corner); the banner with the table's rules and whose turn
 * it is; every other player as a compact seat; the stage with the hands that matter to me. The
 * dealer and the stage keep their place and size through every phase (blackjack.css); only the
 * seats in between change with the table.
 */
export function Table({ room, view, meId, truth, frame, now, isPhone, focus, chipsOf }: Props) {
  const { table, timeline, leaving } = frame;
  const settings = room.settings;
  const dealt = table?.order ?? [];
  const others = seatOrder(room, view, dealt).filter((id) => id !== meId);
  const swept = useBlackjack((s) => s.swept);
  const discarded = discardedCount(swept, truth, table);
  const crowd = others.length === 0 ? 'none' : tileTier(others.length);
  return (
    <section
      className={`tbl-felt tbl-felt--calm bj-table tbl-crowd--${crowd}${leaving ? ' bj-table--leaving' : ''}`}
      aria-label="Table"
      data-testid="bj-table"
      data-round={table?.round ?? 0}
      data-settled={table?.settled ?? false}
      data-crowd={crowd}
    >
      <DiscardCorner discarded={discarded} />
      <Deck name="shoe" testId="shoe" corner />
      <Dealer table={table} timeline={timeline} now={now} leaving={leaving} size={isPhone ? 'md' : 'lg'} />
      <TableRibbon main={RIBBON_TEXT} sub={DEALER_RULE_TEXT} note={<BjTurnLine room={room} view={view} meId={meId} focus={focus} frame={frame} />} />
      <Seats room={room} view={view} ids={others} meId={meId} table={table} timeline={timeline} now={now} leaving={leaving} wide={!isPhone} chipsOf={chipsOf} />
      <Stage room={room} view={view} meId={meId} focus={focus} frame={frame} now={now} />
    </section>
  );
}
