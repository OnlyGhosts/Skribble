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
import { Table } from './components/Table';
import { isInHand, isMyTurn, useConnected, useRejoining } from './hooks';
import { focusOf } from './lib/focus';
import { tableOf } from './lib/table';
import { animating, chipsValue, frameAt, outcomesShown, valueAt } from './lib/timeline';
import { standingOf } from './lib/text';
import { snapTimeline, usePoker } from './store';

const meta = gameById('poker');

/**
 * The Poker table on the platform's table shell, the same family as Blackjack: the top bar (the
 * game, players, options), the control panel (left on a desktop, docked at the bottom on a phone) and the calm
 * table (the pot over the board, the banner with the blinds and whose turn it is with the clock,
 * every other player as a compact seat, my two cards on the stage). The cards and chips move by
 * the timeline the store plans from the snapshots; the end of a hand stays on the table through
 * the results pause, then the next hand deals.
 */
export function PokerScreen({ room, meId, isHost }: GameScreenProps<PokerView, PokerSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const connected = useConnected();
  const rejoining = useRejoining();
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
  const standing = standingOf({ seated: seat !== undefined, waitingForSeat: seat?.waitingForSeat ?? false, busted: seat?.busted ?? false, inHand: isInHand(view, meId), phase: view.phase });

  // The turn clock, by whose turn it is under the ribbon (the results pause runs without one).
  const clock = playing && view.phase === 'acting' && view.turn !== null ? <Timer endsAt={held ? null : view.endsAt} paused={held} warnUnder={5} tickUnder={myTurn ? 5 : undefined} size="md" /> : null;
  const focus = focusOf({ view, table: frame.table, outcomesShown: outcomesShown(frame.timeline, now), held, meId });

  return (
    <TableShell
      meta={meta}
      className="pk"
      testId="poker-screen"
      headerTestId="poker-header"
      mainTestId="poker-main"
      data={{ 'data-phase': view.phase, 'data-hand': view.hand, 'data-street': view.street ?? '', 'data-turn-player': view.turn ?? '', 'data-busy': busy }}
      isPhone={isPhone}
      room={room}
      players={<PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />}
      sheet={sheet}
      onSheet={openSheet}
      table={<Table room={room} view={view} meId={meId} frame={frame} live={timeline} now={now} isPhone={isPhone} focus={focus} standing={standing} clock={clock} />}
      panel={<ControlPanel view={view} meId={meId} balance={valueAt(timeline, chipsValue(meId), seat?.chips ?? 0, now)} watching={standing === 'watching'} canSend={playing && connected && !rejoining} busy={busy} hotkeys={!isPhone} />}
    />
  );
}
