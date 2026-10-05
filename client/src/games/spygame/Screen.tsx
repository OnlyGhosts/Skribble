import type { SpygameSettings, SpygameView } from '@shared/games/spygame/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { ConnectionPill } from '../../platform/components/ConnectionPill';
import { LogoutIcon, MoreIcon, UsersIcon } from '../../platform/components/Icons';
import { PlayerList } from '../../platform/components/PlayerList';
import { SoundToggle, ThemeToggle } from '../../platform/components/ThemeToggle';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { leaveRoom } from '../../platform/net/actions';
import { useActiveGame } from '../../platform/store/selectors';
import { AccuseList } from './components/AccuseList';
import { CandidateGrid } from './components/CandidateGrid';
import { GuessGrid } from './components/GuessGrid';
import { ChatIcon, SpyIcon } from './components/Icons';
import { RevealOverlay } from './components/RevealOverlay';
import { RoleCard } from './components/RoleCard';
import { RoundClock } from './components/RoundClock';
import { VotePanel, VoteSheet } from './components/Vote';
import { nameOf } from './hooks';
import { waitingNotice, wrongGuessNotice } from './lib/text';
import { useSpygame } from './store';

const meta = gameById('spygame');

/**
 * The Spy Game screen. Phones: a compact header (round, clock, players, chat, menu) over one
 * scrolling column with the role card, the vote, the location grid and the players to accuse.
 * Desktop: the same column on the left, players and chat on the right.
 */
export function SpyGameScreen({ room, meId, isHost }: GameScreenProps<SpygameView, SpygameSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  // The sheets live in the game store so a starting vote can close whichever one is up.
  const sheet = useSpygame((s) => s.sheet);
  const openSheet = useSpygame((s) => s.openSheet);
  const closeSheet = () => openSheet(null);
  const playersOpen = sheet === 'players';
  const chatOpen = sheet === 'chat';
  const menuOpen = sheet === 'menu';

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const waitingFor = view.clock.waitingForId ? nameOf(room, view.clock.waitingForId) : null;
  const wrongGuesses = view.spyGuessed.length > 0 && view.phase !== 'reveal';
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const accuse = <AccuseList room={room} view={view} meId={meId} />;

  const playersButton = (
    <button type="button" className="spy__players-btn" onClick={() => openSheet('players')} aria-haspopup="dialog" aria-expanded={playersOpen} aria-label={`Scores (${room.players.length} players)`} data-testid="players-toggle">
      <UsersIcon size={18} />
      <span>{room.players.length}</span>
    </button>
  );

  return (
    <div className={`spy${isPhone ? ' spy--phone' : ''}`} data-phase={view.phase} data-role={view.role} data-testid="spygame-screen">
      <header className="spy__top card" data-testid="spygame-header">
        {isPhone ? (
          <>
            <div className="spy__round spy__round--compact" data-testid="round-indicator">
              <strong>
                Round {view.round}/{view.totalRounds}
              </strong>
              <small>{meta.name}</small>
            </div>
            <RoundClock clock={view.clock} />
            {playersButton}
            <button type="button" className="icon-btn spy__icon-btn" onClick={() => openSheet('chat')} aria-haspopup="dialog" aria-expanded={chatOpen} aria-label="Chat" data-testid="chat-toggle">
              <ChatIcon size={20} />
            </button>
            <button type="button" className="icon-btn spy__icon-btn" onClick={() => openSheet('menu')} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="More options" data-testid="game-menu">
              <MoreIcon size={20} />
            </button>
          </>
        ) : (
          <>
            <div className="spy__brand">
              <span className="brand__mark brand__mark--sm" style={{ background: meta.accent }} aria-hidden="true">
                <SpyIcon size={16} />
              </span>
              <div className="spy__round" data-testid="round-indicator">
                <strong>
                  Round {view.round} of {view.totalRounds}
                </strong>
                <small>{meta.name}</small>
              </div>
            </div>
            <div className="spy__center">
              <RoundClock clock={view.clock} />
            </div>
            <div className="spy__side">
              {playersButton}
              <ConnectionPill />
              <SoundToggle />
              <ThemeToggle />
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="spy__stage">
        <main className="spy__main" data-testid="spygame-main">
          {waitingFor && (
            <div className="banner banner--info spy__banner" role="status" data-testid="spygame-waiting">
              {waitingNotice(waitingFor)}
            </div>
          )}
          {wrongGuesses && (
            <div className="banner spy__banner spy__banner--wrong" role="status" data-testid="spygame-wrong-guess" data-guesses-left={view.guessesLeft}>
              {wrongGuessNotice(view.guessesLeft)}
            </div>
          )}
          <RoleCard view={view} />
          {view.phase === 'voting' && <VotePanel room={room} view={view} meId={meId} />}
          {view.role === 'spy' ? <GuessGrid view={view} /> : <CandidateGrid view={view} />}
          {isPhone && <section className="card spy__accuse-card">{accuse}</section>}
        </main>
        {playing && view.reveal && <RevealOverlay room={room} view={view} reveal={view.reveal} isHost={isHost} />}
      </div>

      {!isPhone && (
        <aside className="spy__aside">
          <section className="card spy__accuse-card spy__accuse-card--desktop">{accuse}</section>
          <section className="card spy__chat" aria-label="Chat">
            <Chat />
          </section>
        </aside>
      )}

      <BottomSheet open={playersOpen} title={`Scores (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={chatOpen} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="spy__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <BottomSheet open={menuOpen} title="Options" onClose={closeSheet} testId="menu-sheet">
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
      {/* Last, so it stacks above the other sheets should one be open. */}
      <VoteSheet room={room} view={view} meId={meId} />
    </div>
  );
}
