import type { CSSProperties } from 'react';
import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
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
import { Dealer } from './components/Dealer';
import { CardsIcon, ChatIcon } from './components/Icons';
import { MyArea } from './components/MyArea';
import { ResultsOverlay } from './components/Results';
import { Seats } from './components/Seats';
import { isActing, nameOf } from './hooks';
import { phaseKicker, roundLabel } from './lib/text';
import { useBlackjack } from './store';

const meta = gameById('blackjack');

/**
 * The Blackjack table: a compact top bar (round, the clock, players, chat, options) over one
 * column that scrolls: the dealer at the top, the other seats in a strip, the viewer's own hands
 * and moves at the bottom. Desktop adds the players on the left and the chat on the right; the
 * round's results come up over the column.
 */
export function BlackjackScreen({ room, meId, isHost }: GameScreenProps<BlackjackView, BlackjackSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const sheet = useBlackjack((s) => s.sheet);
  const openSheet = useBlackjack((s) => s.openSheet);
  const closeSheet = () => openSheet(null);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const paused = holding || view.paused;
  const myTurn = isActing(view, meId);
  const turnName = nameOf(room, view.turn?.playerId);
  const endsAt = playing && !paused ? view.endsAt : null;
  const warnUnder = view.phase === 'results' ? 0 : 5;
  const tickUnder = (view.phase === 'acting' && myTurn) || (view.phase === 'betting' && (view.players[meId]?.bet ?? 0) === 0 && view.order.includes(meId)) ? 5 : undefined;
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const style = { '--bj-accent': meta.accent } as CSSProperties;

  return (
    <div className={`bj${isPhone ? ' bj--phone' : ''}`} style={style} data-phase={view.phase} data-round={view.round} data-turn-player={view.turn?.playerId} data-testid="blackjack-screen">
      <header className="bj__top card" data-testid="blackjack-header">
        <div className="bj__brand">
          {!isPhone && (
            <span className="brand__mark brand__mark--sm" style={{ background: meta.accent }} aria-hidden="true">
              <CardsIcon size={16} />
            </span>
          )}
          <div className="bj__round" data-testid="round-indicator" data-round={view.round} data-total={view.totalRounds}>
            <strong>{roundLabel(view, !isPhone)}</strong>
            <small data-testid="phase-kicker">{phaseKicker(view, turnName, myTurn, isPhone)}</small>
          </div>
        </div>
        <div className="bj__clock">
          <Timer endsAt={endsAt} paused={paused} warnUnder={warnUnder} tickUnder={tickUnder} />
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
              <SoundToggle />
              <ThemeToggle />
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </header>

      {!isPhone && (
        <aside className="bj__players card" aria-label="Players">
          <div className="bj__players-body">{players}</div>
        </aside>
      )}

      <main className="bj__main" data-testid="blackjack-main">
        <div className="bj__scroll" data-testid="blackjack-column">
          <Dealer view={view} size={isPhone ? 'md' : 'lg'} />
          <Seats room={room} view={view} meId={meId} />
          <MyArea room={room} view={view} meId={meId} playing={playing} />
        </div>
        {playing && view.phase === 'results' && <ResultsOverlay room={room} view={view} isHost={isHost} holding={holding} />}
      </main>

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
