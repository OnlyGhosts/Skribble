import type { CSSProperties } from 'react';
import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { ConnectionPill } from '../../platform/components/ConnectionPill';
import { LogoutIcon, MoreIcon, UsersIcon } from '../../platform/components/Icons';
import { PlayerList } from '../../platform/components/PlayerList';
import { SoundToggle, ThemeToggle } from '../../platform/components/ThemeToggle';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { leaveRoom } from '../../platform/net/actions';
import { useActiveGame } from '../../platform/store/selectors';
import { ActionBar } from './components/ActionBar';
import { Board } from './components/Board';
import { EndGameControl } from './components/EndGame';
import { ChatIcon, SpadeIcon } from './components/Icons';
import { MyHand } from './components/MyHand';
import { ResultsOverlay } from './components/Results';
import { Seats } from './components/Seats';
import { isInHand, isMyTurn, nameOf, useConnected } from './hooks';
import { blindsLabel, handLabel, phaseKicker } from './lib/text';
import { usePoker } from './store';

const meta = gameById('poker');

/**
 * The Poker table: a compact top bar (hand, street, the move clock, players, chat, options) over
 * a scrolling column with the board, the pot and the other seats round the table. My cards and
 * the action bar sit under the column, so neither scrolls away however many seats there are. Desktop adds the players on the left
 * and the chat on the right; the hand's results come up over the column.
 */
export function PokerScreen({ room, meId, isHost }: GameScreenProps<PokerView, PokerSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const connected = useConnected();
  const sheet = usePoker((s) => s.sheet);
  const openSheet = usePoker((s) => s.openSheet);
  const closeSheet = () => openSheet(null);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const paused = holding || view.paused;
  const myTurn = isMyTurn(view, meId);
  const endsAt = playing && !paused ? view.endsAt : null;
  const seat = view.players[meId];
  const showActions = playing && view.phase === 'acting' && isInHand(view, meId) && seat !== undefined && seat.status !== 'folded' && seat.status !== 'out';
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const style = { '--pk-accent': meta.accent } as CSSProperties;
  const hostControls = isHost && playing;

  return (
    <div className={`pk${isPhone ? ' pk--phone' : ''}`} style={style} data-phase={view.phase} data-hand={view.hand} data-street={view.street ?? ''} data-turn-player={view.turn ?? ''} data-testid="poker-screen">
      <header className="pk__top card" data-testid="poker-header">
        <div className="pk__brand">
          {!isPhone && (
            <span className="brand__mark brand__mark--sm" style={{ background: meta.accent }} aria-hidden="true">
              <SpadeIcon size={16} />
            </span>
          )}
          <div className="pk__hand" data-testid="hand-indicator" data-hand={view.hand} data-total={view.totalHands}>
            <strong>
              {handLabel(view, !isPhone)}
              {!isPhone && <span className="pk__blinds"> · blinds {blindsLabel(view)}</span>}
            </strong>
            <small data-testid="phase-kicker">{phaseKicker(view, nameOf(room, view.turn), myTurn, isPhone)}</small>
          </div>
        </div>
        <div className="pk__clock">
          <Timer endsAt={endsAt} paused={paused} warnUnder={view.phase === 'results' ? 0 : 5} tickUnder={myTurn ? 5 : undefined} />
        </div>
        <div className="pk__side">
          <button type="button" className="pk__players-btn" onClick={() => openSheet('players')} aria-haspopup="dialog" aria-expanded={sheet === 'players'} aria-label={`Players (${room.players.length})`} data-testid="players-toggle">
            <UsersIcon size={18} />
            <span>{room.players.length}</span>
          </button>
          {isPhone ? (
            <>
              <button type="button" className="icon-btn pk__icon-btn" onClick={() => openSheet('chat')} aria-haspopup="dialog" aria-expanded={sheet === 'chat'} aria-label="Chat" data-testid="chat-toggle">
                <ChatIcon size={20} />
              </button>
              <button type="button" className="icon-btn pk__icon-btn" onClick={() => openSheet('menu')} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label="More options" data-testid="game-menu">
                <MoreIcon size={20} />
              </button>
            </>
          ) : (
            <>
              <ConnectionPill />
              <SoundToggle />
              <ThemeToggle />
              {hostControls && <EndGameControl variant="header" />}
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </header>

      {!isPhone && (
        <aside className="pk__players card" aria-label="Players">
          <div className="pk__players-body">{players}</div>
        </aside>
      )}

      <main className="pk__main" data-testid="poker-main">
        <div className="pk__scroll" data-testid="poker-column">
          <Board room={room} view={view} size={isPhone ? 'md' : 'lg'} />
          <Seats room={room} view={view} meId={meId} />
        </div>
        <MyHand room={room} view={view} meId={meId} size={isPhone ? 'lg' : 'xl'} />
        {showActions && <ActionBar view={view} meId={meId} myTurn={myTurn} canSend={playing && connected} />}
        {playing && view.phase === 'results' && <ResultsOverlay room={room} view={view} isHost={isHost} holding={holding} />}
      </main>

      {!isPhone && (
        <aside className="pk__chat card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="pk__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <BottomSheet open={sheet === 'menu'} title="Options" onClose={closeSheet} testId="menu-sheet">
            <div className="menu-sheet">
              <div className="menu-sheet__row">
                <span className="menu-sheet__label">Connection</span>
                <ConnectionPill />
              </div>
              <div className="menu-sheet__row">
                <span className="menu-sheet__label">Sound</span>
                <SoundToggle />
              </div>
              <div className="menu-sheet__row">
                <span className="menu-sheet__label">Theme</span>
                <ThemeToggle />
              </div>
              {hostControls && <EndGameControl variant="menu" />}
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
