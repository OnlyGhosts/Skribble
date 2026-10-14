import type { CSSProperties } from 'react';
import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { ConnectionPill } from '../../platform/components/ConnectionPill';
import { GameMark } from '../../platform/components/GameGlyph';
import { LogoutIcon, MoreIcon, UsersIcon } from '../../platform/components/Icons';
import { PlayerList } from '../../platform/components/PlayerList';
import { PreferenceRows, SettingsMenu } from '../../platform/components/Preferences';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { leaveRoom } from '../../platform/net/actions';
import { useActiveGame } from '../../platform/store/selectors';
import { ControlPanel } from './components/ControlPanel';
import { EndGameControl } from './components/EndGame';
import { ChatIcon } from './components/Icons';
import { Table } from './components/Table';
import { isActing, nameOf, pendingBettors, useConnected, useTableNow } from './hooks';
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
 * The Blackjack table, Stake style: a compact top bar (round, the turn clock, players, chat,
 * options), the table (dealer, shoe and discards, the ribbon, the other seats, my hands) and the
 * control panel always in the same place: under the table on a phone, in a left column on a
 * desktop with the chat on the right. The cards move by the timeline the store plans from the
 * snapshots; there is no results screen between rounds.
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
  const timeline = stored.round === (table?.round ?? null) || stored.discard ? stored : snapTimeline(table, 0);
  const now = useTableNow(timeline);
  if (!view) return null;

  const closeSheet = () => openSheet(null);
  const frame = frameAt(timeline, table, now);
  const playing = room.phase === 'playing';
  const held = Boolean(room.waiting) || view.phase === 'held';
  const myTurn = isActing(view, meId);
  const turnName = nameOf(room, view.turn?.playerId);
  const seat = view.players[meId];
  const chipsOf = (id: string) => (view.players[id]?.chips ?? 0) - pendingPayout(frame.table, frame.timeline, now, id);
  const busy = animating(timeline, now);
  const status = panelStatus({
    phase: view.phase,
    seated: seat !== undefined,
    bustedOut: seat?.bustedOut ?? false,
    connected,
    inRound: view.order.includes(meId),
    betPlaced: (seat?.bet ?? 0) > 0,
    pending: pendingBettors(view)
      .filter((id) => id !== meId)
      .map((id) => nameOf(room, id)),
    myTurn,
    turnName,
    handIndex: view.turn?.handIndex ?? 0,
    handCount: seat?.hands.length ?? 0,
    dealerPlaying: Boolean(frame.table?.settled) && !outcomesShown(frame.timeline, now),
  });
  const timed = playing && !held && (view.phase === 'betting' || view.phase === 'acting' || view.phase === 'ending');
  const tickUnder = myTurn || (view.phase === 'betting' && view.order.includes(meId) && (seat?.bet ?? 0) === 0) ? 5 : undefined;
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const endControl = (variant: 'menu' | 'header') => isHost && playing && <EndGameControl variant={variant} phase={view.phase} requested={view.endRequested} />;
  const style = { '--bj-accent': meta.accent } as CSSProperties;

  return (
    <div
      className={`bj${isPhone ? ' bj--phone' : ''}`}
      style={style}
      data-phase={view.phase}
      data-round={view.round}
      data-turn-player={view.turn?.playerId}
      data-turn-hand={view.turn?.handIndex}
      data-busy={busy}
      data-testid="blackjack-screen"
    >
      <header className="bj__top card" data-testid="blackjack-header">
        <div className="bj__brand">
          {!isPhone && <GameMark game={meta} size="sm" />}
          <div className="bj__round" data-testid="round-indicator" data-round={view.round} data-total={view.totalRounds}>
            <strong>{roundLabel(view.round, view.totalRounds)}</strong>
            <small data-testid="phase-kicker">{phaseKicker(view, turnName, myTurn)}</small>
          </div>
        </div>
        <div className="bj__clock">
          <Timer endsAt={timed ? view.endsAt : null} paused={held} warnUnder={view.phase === 'ending' ? 0 : 5} tickUnder={tickUnder} />
        </div>
        <div className="bj__side">
          <button type="button" className="bj__players-btn" onClick={() => openSheet('players')} aria-haspopup="dialog" aria-expanded={sheet === 'players'} aria-label={`Players (${room.players.length})`} data-testid="players-toggle">
            <UsersIcon size={18} />
            <span>{room.players.length}</span>
          </button>
          {isPhone ? (
            <>
              <button type="button" className="icon-btn bj__icon-btn" onClick={() => openSheet('chat')} aria-haspopup="dialog" aria-expanded={sheet === 'chat'} aria-label="Chat" data-testid="chat-toggle">
                <ChatIcon size={20} />
              </button>
              <button type="button" className="icon-btn bj__icon-btn" onClick={() => openSheet('menu')} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label="More options" data-testid="game-menu">
                <MoreIcon size={20} />
              </button>
            </>
          ) : (
            <>
              <ConnectionPill />
              <SettingsMenu />
              {endControl('header')}
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="bj__table" data-testid="blackjack-main">
        <Table room={room} view={view} meId={meId} frame={frame} now={now} isPhone={isPhone} chipsOf={chipsOf} />
      </main>

      <aside className="bj__panel card" aria-label="Controls">
        <ControlPanel room={room} view={view} meId={meId} balance={chipsOf(meId)} status={status} canSend={playing && connected} busy={busy} hotkeys={!isPhone} />
      </aside>

      {!isPhone && (
        <aside className="bj__chat card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="bj__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <BottomSheet open={sheet === 'menu'} title="Options" onClose={closeSheet} testId="menu-sheet">
            <div className="menu-sheet">
              <PreferenceRows />
              {endControl('menu')}
              <button type="button" className="btn btn--ghost btn--block menu-sheet__leave" onClick={leaveRoom} data-testid="leave-room">
                <LogoutIcon size={16} /> Leave room
              </button>
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
