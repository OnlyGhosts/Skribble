import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { TableShell } from '../../platform/table/TableShell';
import { ControlPanel } from './components/ControlPanel';
import { EndGameControl } from './components/EndGame';
import { Table } from './components/Table';
import { isActing, nameOf, pendingBettors, playerOf, useConnected, useTableNow } from './hooks';
import { spotlightSubject } from './lib/spotlight';
import { tableOf, type TableModel } from './lib/table';
import { animating, frameAt, outcomesShown, snapTimeline, type Timeline } from './lib/timeline';
import { panelStatus, phaseKicker, roundLabel } from './lib/text';
import { useBlackjack } from './store';

const meta = gameById('blackjack');

/** Chips a settled hand is still to hand back on screen: the balance catches up when the outcome shows. */
function pendingPayout(table: TableModel | null, timeline: Timeline, now: number, id: string): number {
  if (!table?.settled || outcomesShown(timeline, now)) return 0;
  return (table.hands[id] ?? []).reduce((sum, h) => sum + (h.payout ?? 0), 0);
}

/**
 * The Blackjack table, Stake style, on the platform's table shell: the top bar (round and phase),
 * the table (dealer, the spotlight on the hand being played with the turn clock, every other
 * player as a tile, my hands) and the control panel always in the same place. The cards move by
 * the timeline the store plans from the snapshots; there is no results screen between rounds.
 */
export function BlackjackScreen({ room, meId, isHost }: GameScreenProps<BlackjackView, BlackjackSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const connected = useConnected();
  const sheet = useBlackjack((s) => s.sheet);
  const openSheet = useBlackjack((s) => s.openSheet);
  const stored = useBlackjack((s) => s.timeline);
  const view = room.game;
  const table = tableOf(view);
  // A timeline planned for another table (a render before the store caught up) shows the truth.
  const timeline = stored.id === (table?.round ?? null) || stored.discard ? stored : snapTimeline(table, 0);
  const now = useTableNow(timeline);
  if (!view) return null;

  const frame = frameAt(timeline, table, now);
  const playing = room.phase === 'playing';
  const held = Boolean(room.waiting) || view.phase === 'held';
  const myTurn = isActing(view, meId);
  const turnName = nameOf(room, view.turn?.playerId);
  const seat = view.players[meId];
  const chipsOf = (id: string) => (view.players[id]?.chips ?? 0) - pendingPayout(frame.table, frame.timeline, now, id);
  const busy = animating(timeline, now);
  // The settled round's reveal is still playing: every part of the screen says it is the dealer's turn.
  const dealerPlaying = Boolean(frame.table?.settled) && !outcomesShown(frame.timeline, now);
  const status = panelStatus({
    phase: view.phase,
    seated: seat !== undefined,
    bustedOut: seat?.bustedOut ?? false,
    connected,
    inRound: view.order.includes(meId),
    hasChips: (seat?.chips ?? 0) + (seat?.bet ?? 0) > 0,
    betPlaced: (seat?.bet ?? 0) > 0,
    pending: pendingBettors(view)
      .filter((id) => id !== meId)
      .map((id) => nameOf(room, id)),
    myTurn,
    turnName,
    handIndex: view.turn?.handIndex ?? 0,
    handCount: seat?.hands.length ?? 0,
    dealerPlaying,
    awaitingFirstBet: view.phase === 'betting' && view.endsAt === null,
  });
  const subject = spotlightSubject({ view, table: frame.table, dealerPlaying, outcomesShown: outcomesShown(frame.timeline, now), meId });
  // The dealer's turn has no clock of its own: the next bets' countdown waits until the spotlight moves on to them.
  const timed = playing && !held && subject.kind !== 'dealer' && (view.phase === 'betting' || view.phase === 'acting' || view.phase === 'ending');
  const tickUnder = myTurn || (view.phase === 'betting' && view.order.includes(meId) && (seat?.bet ?? 0) === 0) ? 5 : undefined;
  const clock = <Timer endsAt={timed ? view.endsAt : null} paused={held} warnUnder={view.phase === 'ending' ? 0 : 5} tickUnder={tickUnder} size="md" />;
  // Someone else's turn: their face beside "Pia's turn" in the panel.
  const turnPlayer = status.state === 'their-turn' ? playerOf(room, view.turn?.playerId) : undefined;
  const panel = turnPlayer ? { ...status, who: turnPlayer.avatar } : status;

  return (
    <TableShell
      meta={meta}
      className="bj"
      testId="blackjack-screen"
      headerTestId="blackjack-header"
      mainTestId="blackjack-main"
      data={{ 'data-phase': view.phase, 'data-round': view.round, 'data-turn-player': view.turn?.playerId, 'data-turn-hand': view.turn?.handIndex, 'data-busy': busy }}
      isPhone={isPhone}
      status={
        <>
          {roundLabel(view.round)}
          {/* A phone leaves the phase to the spotlight. */}
          <span className="gbar__more">
            {' · '}
            <span data-testid="phase-kicker">{phaseKicker(view, turnName, myTurn, dealerPlaying)}</span>
          </span>
        </>
      }
      statusTestId="round-indicator"
      statusData={{ 'data-round': view.round }}
      room={room}
      players={<PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />}
      sheet={sheet}
      onSheet={openSheet}
      endControl={(variant) => isHost && playing && <EndGameControl variant={variant} phase={view.phase} requested={view.endRequested} />}
      table={<Table room={room} view={view} meId={meId} truth={table} frame={frame} now={now} isPhone={isPhone} subject={subject} clock={clock} chipsOf={chipsOf} />}
      panel={<ControlPanel room={room} view={view} meId={meId} balance={chipsOf(meId)} status={panel} canSend={playing && connected} busy={busy} hotkeys={!isPhone} />}
    />
  );
}
