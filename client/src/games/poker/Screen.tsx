import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { TableShell } from '../../platform/table/TableShell';
import { useTableNow } from '../../platform/table/useTableNow';
import { ControlPanel } from './components/ControlPanel';
import { EndGameControl } from './components/EndGame';
import { Table } from './components/Table';
import { isInHand, isMyTurn, nameOf, useConnected } from './hooks';
import { tableOf } from './lib/table';
import { wonOnScreen } from './lib/screen';
import { animating, chipsValue, frameAt, outcomesShown, valueAt } from './lib/timeline';
import { handLabel, panelStatus, phaseKicker, resultText } from './lib/text';
import { snapTimeline, usePoker } from './store';

const meta = gameById('poker');

/**
 * The Poker table on the platform's table shell, the same flow as Blackjack: the top bar (hand,
 * blinds, the turn clock), the table (pot, board, seats, my hand) and the control panel always in
 * the same place. The cards and chips move by the timeline the store plans from the snapshots;
 * the end of a hand stays on the table through the results pause, then the next hand deals.
 */
export function PokerScreen({ room, meId, isHost }: GameScreenProps<PokerView, PokerSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const connected = useConnected();
  const sheet = usePoker((s) => s.sheet);
  const openSheet = usePoker((s) => s.openSheet);
  const stored = usePoker((s) => s.timeline);
  const view = room.game;
  const table = tableOf(view, meId);
  // A timeline planned for another hand (a render before the store caught up) shows the truth.
  const timeline = stored.id === (table?.hand ?? null) || stored.discard ? stored : snapTimeline(table, 0);
  const now = useTableNow(timeline);
  if (!view) return null;

  const frame = frameAt(timeline, table, now);
  const playing = room.phase === 'playing';
  const held = Boolean(room.waiting) || view.paused;
  const myTurn = isMyTurn(view, meId);
  const seat = view.players[meId];
  const busy = animating(timeline, now);
  const results = frame.table?.results ?? null;
  const shownResult = results && outcomesShown(frame.timeline, now) ? resultText(results, (id) => (id === meId ? 'You' : nameOf(room, id))) : null;
  const status = panelStatus({
    phase: view.phase,
    seated: seat !== undefined,
    busted: seat?.busted ?? false,
    connected,
    held,
    inHand: isInHand(view, meId),
    myTurn,
    turnName: view.phase === 'acting' && view.turn ? nameOf(room, view.turn) : null,
    result: view.phase === 'results' ? shownResult : null,
    won: wonOnScreen(frame.table, frame.timeline, meId, now) > 0,
  });

  return (
    <TableShell
      meta={meta}
      className="pk"
      testId="poker-screen"
      headerTestId="poker-header"
      mainTestId="poker-main"
      data={{ 'data-phase': view.phase, 'data-hand': view.hand, 'data-street': view.street ?? '', 'data-turn-player': view.turn ?? '', 'data-busy': busy }}
      isPhone={isPhone}
      status={
        <>
          {handLabel(view)} ·{' '}
          <span data-testid="phase-kicker">
            <span data-testid="blinds" data-small={view.blinds.small} data-big={view.blinds.big}>
              {phaseKicker(view)}
            </span>
          </span>
        </>
      }
      statusTestId="hand-indicator"
      statusData={{ 'data-hand': view.hand, 'data-total': view.totalHands }}
      clock={<Timer endsAt={playing && !held ? view.endsAt : null} paused={held} warnUnder={view.phase === 'results' ? 0 : 5} tickUnder={myTurn ? 5 : undefined} />}
      playerCount={room.players.length}
      players={<PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />}
      sheet={sheet}
      onSheet={openSheet}
      endControl={(variant) => isHost && playing && <EndGameControl variant={variant} />}
      table={<Table room={room} view={view} meId={meId} frame={frame} live={timeline} now={now} isPhone={isPhone} />}
      panel={<ControlPanel view={view} meId={meId} balance={valueAt(timeline, chipsValue(meId), seat?.chips ?? 0, now)} status={status} canSend={playing && connected} busy={busy} hotkeys={!isPhone} />}
    />
  );
}
