import type { QuipgameSettings, QuipgameView } from '@shared/games/quipgame/protocol';
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
import { FinalResult, FinalVoting } from './components/Final';
import { BubbleIcon } from './components/Icons';
import { Result, ResultFooter } from './components/Result';
import { Voting } from './components/Voting';
import { Spectating, Writing } from './components/Writing';
import { isWriting } from './hooks';
import { phaseKicker, roundLabel } from './lib/text';
import { useQuipgame } from './store';

const meta = gameById('quipgame');
/** Wide desktops get the chat beside the column; everything narrower keeps it in a sheet. */
const WIDE_QUERY = '(min-width: 1100px)';

/**
 * The Quip Game screen: a compact top bar (round, the clock, players, chat, options) over one
 * centred column that shows the current phase. Phone-first: the page never scrolls, the column
 * does, and players and chat live in bottom sheets (chat moves to a right column on wide screens).
 */
export function QuipGameScreen({ room, meId, isHost }: GameScreenProps<QuipgameView, QuipgameSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const wide = useMediaQuery(WIDE_QUERY) && !isPhone;
  useAppMode(isPhone);
  const sheet = useQuipgame((s) => s.sheet);
  const openSheet = useQuipgame((s) => s.openSheet);
  const closeSheet = () => openSheet(null);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const ticking = playing && !holding && (isWriting(view) || view.phase === 'voting' || view.phase === 'finalVoting');

  return (
    <div className={`quip${isPhone ? ' quip--phone' : ''}${wide ? ' quip--wide' : ''}`} data-phase={view.phase} data-round={view.round} data-testid="quipgame-screen">
      <header className="quip__top card" data-testid="quipgame-header">
        <div className="quip__brand">
          {!isPhone && (
            <span className="brand__mark brand__mark--sm" style={{ background: meta.accent }} aria-hidden="true">
              <BubbleIcon size={16} />
            </span>
          )}
          <div className="quip__round" data-testid="round-indicator" data-round={view.round} data-total={view.totalRounds}>
            <strong>{roundLabel(view, !isPhone)}</strong>
            <small>{phaseKicker(view, isPhone)}</small>
          </div>
        </div>
        <div className="quip__clock">
          <Timer endsAt={playing ? view.endsAt : null} paused={holding} warnUnder={10} tickUnder={ticking ? 5 : undefined} />
        </div>
        <div className="quip__side">
          <button type="button" className="quip__players-btn" onClick={() => openSheet('players')} aria-haspopup="dialog" aria-expanded={sheet === 'players'} aria-label={`Scores (${room.players.length} players)`} data-testid="players-toggle">
            <UsersIcon size={18} />
            <span>{room.players.length}</span>
          </button>
          {!wide && (
            <button type="button" className="icon-btn quip__icon-btn" onClick={() => openSheet('chat')} aria-haspopup="dialog" aria-expanded={sheet === 'chat'} aria-label="Chat" data-testid="chat-toggle">
              <BubbleIcon size={20} />
            </button>
          )}
          {isPhone ? (
            <button type="button" className="icon-btn quip__icon-btn" onClick={() => openSheet('menu')} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label="More options" data-testid="game-menu">
              <MoreIcon size={20} />
            </button>
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

      <main className="quip__main" data-testid="quipgame-main">
        {isWriting(view) && (view.isSpectator ? <Spectating view={view} /> : <Writing view={view} open={playing} />)}
        {view.phase === 'voting' && view.matchup && <Voting room={room} view={view} matchup={view.matchup} />}
        {view.phase === 'result' && view.result && <Result room={room} view={view} result={view.result} isHost={isHost} playing={playing} holding={holding} />}
        {view.phase === 'finalVoting' && <FinalVoting room={room} view={view} />}
        {view.phase === 'finalResult' && view.finalResult && (
          <FinalResult room={room} view={view} footer={<ResultFooter view={view} isHost={isHost} label="Show results" playing={playing} holding={holding} />} />
        )}
      </main>

      {wide && (
        <aside className="quip__aside card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Scores (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />
      </BottomSheet>
      {!wide && (
        <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
          <div className="quip__chat-sheet">
            <Chat />
          </div>
        </BottomSheet>
      )}
      {isPhone && (
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
      )}
    </div>
  );
}
