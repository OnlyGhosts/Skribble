import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { handName } from '@shared/games/poker/hands';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { HandFan, OutcomeFlag } from '../../../platform/table/HandFan';
import { PayoutFloat, type Tone } from '../../../platform/table/Outcome';
import { StakePill } from '../../../platform/table/Stakes';
import { TableCard } from '../../../platform/table/TableCard';
import { TableStage } from '../../../platform/table/TableStage';
import { playerOf } from '../hooks';
import { stageKind, type PkFocus } from '../lib/focus';
import { boardOnScreen, holeOnScreen, sameCard, winningCards, wonOnScreen, type CardOnScreen } from '../lib/screen';
import type { PokerTable } from '../lib/table';
import { betAnchor, betValue, outcomesShown, paidOut, valueAt, type Timeline } from '../lib/timeline';
import { handRankOf, payoutText, shortHandName } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  /** Whose cards the stage shows (stageOwner): mine, or the hand in play when I am not dealt in. */
  owner: string | null;
  focus: PkFocus;
  table: PokerTable | null;
  timeline: Timeline;
  /** The current timeline, for the numbers on show. */
  live: Timeline;
  now: number;
  leaving: boolean;
  /** A phone: the hand's name in its short form, so the pill fits. */
  isPhone: boolean;
}

/** Past this many chips a stake reads short ("Bet 12k"), so it keeps beside the total (on a phone from 1,000). */
const SHORT_STAKE = 10_000;

/** My place in the hand, in a word, where it is the news: out, not dealt in, folded, all in. */
export function myState(view: PokerView, meId: string): string {
  const seat = view.players[meId];
  if (!seat) return '';
  if (seat.busted) return 'Out of chips';
  if (!view.order.includes(meId)) return 'Next hand';
  if (seat.status === 'folded') return 'Folded';
  if (seat.status === 'allIn') return 'All in';
  return '';
}

/** The hole cards as a stepped fan, the cards that play lifted; two empty places before the deal. */
function cardsOf(cards: CardOnScreen[], table: PokerTable | null, timeline: Timeline, now: number, leaving: boolean, testId: string, slotTestId: string) {
  const best = winningCards(table, timeline, now);
  return cards.length > 0
    ? cards.map((c) => <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="md" motion={c.motion} leaving={leaving || c.leaving} flipping={c.flipping} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId={testId} />)
    : [0, 1].map((i) => <PlayingCard key={`slot-${i}`} card={null} size="md" slot testId={slotTestId} />);
}

/**
 * The stage at the bottom of the table, the same place and size all game long: my two hole cards
 * big and centred in a stepped fan, what they make in the pill over their top right corner and,
 * left of it, the dealer button, my bet ("Bet 20", where the chips land) and where I stand ("All
 * in", "Folded"). Lit on my turn; once the showdown shows, outlined in the outcome's colour with
 * the outcome in words by the pill ("Win +300"). Not dealt in, I watch the hand in play here
 * (backs until a showdown), its owner's name by the pill; their seat leaves its cards out.
 */
export function Stage({ room, view, meId, owner, focus, table, timeline, live, now, leaving, isPhone }: Props) {
  const mine = owner !== null && owner === meId;
  const player = playerOf(room, owner);
  const seat = owner === null ? undefined : view.players[owner];
  const data = { 'data-kind': stageKind(focus), 'data-player-id': owner ?? undefined };
  if (owner === null || !player) return <TableStage variant="none" label="Hand" data={data} />;
  const cards = holeOnScreen(table, timeline, owner, meId, now);
  const folded = seat?.status === 'folded';
  const up = cards.flatMap((c) => (c.card ? [c.card] : []));
  const board = boardOnScreen(table, timeline, now).flatMap((c) => (c?.card ? [c.card] : []));
  const rank = up.length === 2 && !leaving ? handRankOf(up, board) : null;
  const name = rank ? (isPhone ? shortHandName(rank) : handName(rank)) : null;
  const won = wonOnScreen(table, timeline, owner, now);
  const settled = Boolean(table?.results) && outcomesShown(timeline, now) && !leaving;
  const lost = settled && won === 0 && !folded && cards.length > 0;
  const turn = view.phase === 'acting' && view.turn === owner;
  const tone: Tone = won > 0 ? 'win' : lost ? 'loss' : turn ? 'active' : 'neutral';
  const bet = valueAt(live, betValue(owner), seat?.bet ?? 0, now);
  const state = mine ? myState(view, meId) : '';
  const lead = (
    <>
      {seat?.isDealer && <DealerButton testId={mine ? 'my-dealer' : 'stage-dealer'} />}
      {!mine && (
        <span className="tbl-hand__owner" data-testid="stage-owner">
          {player.name}
        </span>
      )}
      {won > 0 ? (
        <OutcomeFlag tone="win" word="Win" extra={payoutText(won)} testId="hand-outcome" />
      ) : lost ? (
        <OutcomeFlag tone="loss" word="Lost" testId="hand-outcome" />
      ) : (
        state && (
          <span className={`tbl-tag pk-stage__state${seat?.status === 'allIn' ? ' pk-stage__state--allin' : ''}`} data-testid="my-state">
            {state}
          </span>
        )
      )}
      {/* Where this seat's chips land; the pill only while a bet is out. */}
      <span className="pk-bet" data-table-anchor={betAnchor(owner)} data-testid={mine ? 'my-bet' : 'stage-bet'} data-bet={bet}>
        {bet > 0 && mine && <StakePill value={bet} format={bet >= SHORT_STAKE || (isPhone && bet >= 1000) ? 'short' : 'full'} className="tbl-hand__stake" />}
      </span>
    </>
  );
  const hand = (
    <HandFan
      className={`pk-hand${folded ? ' pk-hand--folded' : ''}`}
      tone={tone}
      total={name}
      totalTestId="hand-hint"
      flag={lead}
      float={won > 0 && paidOut(timeline, now) ? <PayoutFloat text={payoutText(won)} /> : undefined}
      label={mine ? `Your cards${name ? `: ${name}` : ''}` : `${player.name}’s cards`}
      testId={mine ? 'my-cards' : 'stage-cards'}
    >
      {cardsOf(cards, table, timeline, now, leaving, mine ? 'my-card' : 'stage-card', mine ? 'my-slot' : 'stage-slot')}
    </HandFan>
  );
  return (
    <TableStage variant={mine ? 'mine' : 'other'} label={mine ? 'Your hand' : `${player.name}’s hand`} data={data}>
      {mine ? (
        <div
          className="pk-mine"
          data-testid="my-area"
          data-player-id={meId}
          data-role="player"
          data-status={seat ? (seat.busted ? 'out' : seat.status) : 'spectator'}
          data-my-turn={turn}
          data-dealer={seat?.isDealer ?? false}
          data-outcome={won > 0 ? 'win' : lost ? 'loss' : undefined}
          data-payout={won > 0 ? won : undefined}
        >
          {hand}
        </div>
      ) : (
        <div className="pk-mine" data-testid="stage-hand" data-player-id={owner}>
          {hand}
        </div>
      )}
    </TableStage>
  );
}
