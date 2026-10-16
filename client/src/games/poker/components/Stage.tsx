import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { handName } from '@shared/games/poker/hands';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { HandFan, OutcomeFlag } from '../../../platform/table/HandFan';
import { PayoutFloat, type Tone } from '../../../platform/table/Outcome';
import { StakePill } from '../../../platform/table/Stakes';
import { TableCard } from '../../../platform/table/TableCard';
import { TableStage } from '../../../platform/table/TableStage';
import { playerOf } from '../hooks';
import { stageKind, stageOwner, type PkFocus } from '../lib/focus';
import { boardOnScreen, holeOnScreen, sameCard, winningCards, wonOnScreen, type CardOnScreen } from '../lib/screen';
import { winnings, type PokerTable } from '../lib/table';
import { betAnchor, betValue, outcomesShown, paidOut, seatAnchor, valueAt, type Timeline } from '../lib/timeline';
import { categoryLabel, handRankOf, lastActionLabel, payoutText, shortHandName } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
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

/** Past this many chips a stake reads short ("Bet 12k"), so it keeps to the owner's column (on a phone from 1,000). */
const SHORT_STAKE = 10_000;

/** The line beside my cards: where I stand in the hand, or what I did last (the line under the ribbon says whose turn it is). */
export function myState(view: PokerView, meId: string): string {
  const seat = view.players[meId];
  if (!seat) return '';
  if (seat.busted) return 'Out of chips';
  if (!view.order.includes(meId)) return 'Next hand';
  if (seat.status === 'folded') return 'Folded';
  if (seat.status === 'allIn') return 'All in';
  return lastActionLabel(seat.lastAction);
}

/** The hole cards as a stepped fan, the cards that play lifted; two empty places before the deal. */
function cardsOf(cards: CardOnScreen[], table: PokerTable | null, timeline: Timeline, now: number, leaving: boolean, testId: string, slotTestId: string) {
  const best = winningCards(table, timeline, now);
  return cards.length > 0
    ? cards.map((c) => <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="md" motion={c.motion} leaving={leaving || c.leaving} flipping={c.flipping} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId={testId} />)
    : [0, 1].map((i) => <PlayingCard key={`slot-${i}`} card={null} size="md" slot testId={slotTestId} />);
}

/**
 * Who took the main pot, small at the side of my hand once the showdown shows it: their name and
 * the cards that won, so the winning hand is in view however small the seats are.
 */
function WinnerAside({ room, table, timeline, now, leaving, winner }: { room: PokerRoomState; table: PokerTable | null; timeline: Timeline; now: number; leaving: boolean; winner: string }) {
  const shown = table?.results?.revealed[winner];
  const cards = holeOnScreen(table, timeline, winner, null, now);
  if (!shown || cards.length === 0) return null;
  return (
    <div className="pk-winner" data-testid="winner-hand" data-player-id={winner}>
      <span className="pk-winner__name">{playerOf(room, winner)?.name ?? 'Winner'}</span>
      <HandFan size="mini" className="pk-winner__hand" tone="win" total={categoryLabel(shown.category)} label={`${playerOf(room, winner)?.name ?? 'Winner'}: ${shown.name}`} testId="winner-cards">
        {cards.map((c) => (
          <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="sm" motion={null} leaving={leaving} testId="winner-card" />
        ))}
      </HandFan>
    </div>
  );
}

/**
 * The stage at the bottom of the table, the same place and size all game long: my two hole cards
 * big in a stepped fan with what they make in the pill over their top right corner, my face, my
 * bet and the dealer button on the left, my last move on the right. Lit on my turn; once the
 * showdown shows, outlined in the outcome's colour with the outcome in words on the right ("Win
 * +300"), or there the winner's hand when it beat mine. Not dealt in, I watch the hand in play here (backs until a showdown).
 */
export function Stage({ room, view, meId, focus, table, timeline, live, now, leaving, isPhone }: Props) {
  const owner = stageOwner(focus, table, meId);
  const mine = owner !== null && owner === meId;
  const player = playerOf(room, owner);
  const seat = owner === null ? undefined : view.players[owner];
  const cards = owner === null ? [] : holeOnScreen(table, timeline, owner, meId, now);
  const folded = seat?.status === 'folded';
  const up = cards.flatMap((c) => (c.card ? [c.card] : []));
  const board = boardOnScreen(table, timeline, now).flatMap((c) => (c?.card ? [c.card] : []));
  const rank = up.length === 2 && !leaving ? handRankOf(up, board) : null;
  const name = rank ? (isPhone ? shortHandName(rank) : handName(rank)) : null;
  const won = owner === null ? 0 : wonOnScreen(table, timeline, owner, now);
  const settled = Boolean(table?.results) && outcomesShown(timeline, now) && !leaving;
  const lost = settled && won === 0 && !folded && cards.length > 0;
  const turn = owner !== null && view.phase === 'acting' && view.turn === owner;
  const tone: Tone = won > 0 ? 'win' : lost ? 'loss' : turn ? 'active' : 'neutral';
  const bet = owner === null ? 0 : valueAt(live, betValue(owner), seat?.bet ?? 0, now);
  // The main pot's winner beside my hand, when it is someone else and their cards are shown.
  const winner = settled ? (table?.results?.pots[0]?.winners[0]?.playerId ?? null) : null;
  const winnerAside = mine && winner !== null && winner !== meId && (winnings(table?.results ?? null)[meId] ?? 0) === 0;
  const state = mine ? myState(view, meId) : lastActionLabel(seat?.lastAction ?? null);
  const hand = (
    <HandFan
      className={`pk-hand${folded ? ' pk-hand--folded' : ''}`}
      tone={tone}
      total={name}
      totalTestId="hand-hint"
      float={won > 0 && paidOut(timeline, now) ? <PayoutFloat text={payoutText(won)} /> : undefined}
      label={mine ? `Your cards${name ? `: ${name}` : ''}` : `${player?.name ?? 'Their'} cards`}
      testId={mine ? 'my-cards' : 'stage-cards'}
    >
      {cardsOf(cards, table, timeline, now, leaving, mine ? 'my-card' : 'stage-card', mine ? 'my-slot' : 'stage-slot')}
    </HandFan>
  );
  return (
    <TableStage
      variant={mine ? 'mine' : owner ? 'other' : 'none'}
      label={mine ? 'Your hand' : player ? `${player.name}'s hand` : 'Hand'}
      who={player ? { avatar: player.avatar, connected: player.connected, name: mine ? 'You' : player.name, anchor: seatAnchor(player.id) } : null}
      owner={
        owner !== null && (
          <>
            {seat?.isDealer && <DealerButton testId={mine ? 'my-dealer' : 'stage-dealer'} />}
            <span className="pk-bet" data-table-anchor={betAnchor(owner)} data-testid={mine ? 'my-bet' : 'stage-bet'} data-bet={bet}>
              {bet > 0 && <StakePill value={bet} format={bet >= SHORT_STAKE || (isPhone && bet >= 1000) ? 'short' : 'full'} />}
            </span>
          </>
        )
      }
      aside={
        won > 0 ? (
          <OutcomeFlag tone="win" word="Win" extra={payoutText(won)} testId="hand-outcome" />
        ) : winnerAside && winner !== null ? (
          <WinnerAside room={room} table={table} timeline={timeline} now={now} leaving={leaving} winner={winner} />
        ) : lost ? (
          <OutcomeFlag tone="loss" word="Lost" testId="hand-outcome" />
        ) : (
          state && (
            <span className={`pk-stage__state${seat?.status === 'allIn' ? ' pk-stage__state--allin' : ''}`} data-testid={mine ? 'my-state' : 'stage-state'}>
              {state}
            </span>
          )
        )
      }
      data={{ 'data-kind': stageKind(focus), 'data-player-id': owner ?? undefined }}
    >
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
        <div className="pk-mine" data-testid="stage-hand" data-player-id={owner ?? undefined}>
          {hand}
        </div>
      )}
    </TableStage>
  );
}
