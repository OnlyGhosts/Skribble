import { useLayoutEffect, useRef, useState } from 'react';
import type { SkribblePhase, SkribbleSettings, SkribbleView } from '@shared/games/skribble/protocol';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { ConnectionPill } from '../../platform/components/ConnectionPill';
import { LogoutIcon, MoreIcon, UsersIcon } from '../../platform/components/Icons';
import { PlayerList } from '../../platform/components/PlayerList';
import { SoundToggle, ThemeToggle } from '../../platform/components/ThemeToggle';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useCountdownSeconds } from '../../platform/lib/useCountdown';
import { useAppMode } from '../../platform/lib/useViewport';
import { leaveRoom } from '../../platform/net/actions';
import { useActiveGame } from '../../platform/store/selectors';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { rateDrawing } from './actions';
import type { DrawingSettings } from './canvas/useDrawing';
import { GameCanvas } from './components/GameCanvas';
import { PencilIcon, ThumbDownIcon, ThumbUpIcon } from './components/Icons';
import { ChoosingOverlay, DrawingCaption, TurnEndOverlay } from './components/Overlays';
import { Toolbar } from './components/Toolbar';
import { WordDisplay } from './components/WordDisplay';
import { drawerIdOf, hasGuessed } from './hooks';
import { useSkribbleStore } from './store';

const DEFAULT_TOOLS: DrawingSettings = { tool: 'brush', color: '#000000', size: 6 };

type DrawingPhase = Extract<SkribblePhase, { kind: 'drawing' }>;

function Rating({ phase, isDrawer, compact }: { phase: DrawingPhase; isDrawer: boolean; compact?: boolean }) {
  const iconSize = compact ? 15 : 16;
  return (
    <div className={`rating${compact ? ' rating--compact' : ''}`} role="group" aria-label="Rate the drawing">
      <button
        type="button"
        className={`rating__btn${phase.myRating === 'like' ? ' is-active' : ''}`}
        onClick={() => rateDrawing('like')}
        disabled={isDrawer}
        aria-pressed={phase.myRating === 'like'}
        aria-label={`Like this drawing (${phase.likes})`}
        data-testid="rate-like"
      >
        <ThumbUpIcon size={iconSize} /> <span>{phase.likes}</span>
      </button>
      <button
        type="button"
        className={`rating__btn rating__btn--down${phase.myRating === 'dislike' ? ' is-active' : ''}`}
        onClick={() => rateDrawing('dislike')}
        disabled={isDrawer}
        aria-pressed={phase.myRating === 'dislike'}
        aria-label={`Dislike this drawing (${phase.dislikes})`}
        data-testid="rate-dislike"
      >
        <ThumbDownIcon size={iconSize} /> <span>{phase.dislikes}</span>
      </button>
    </div>
  );
}

/** The Skribble game screen: header, canvas with overlays and toolbar, players and chat (sheets on phones). */
export function SkribbleScreen({ room, meId, isHost }: GameScreenProps<SkribbleView, SkribbleSettings>) {
  const game = useActiveGame();
  // Undo/clear apply locally the moment they are sent, so they are only offered while they can be sent.
  const hasStrokes = useSkribbleStore((s) => s.canvas.length > 0);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const [tools, setTools] = useState<DrawingSettings>(DEFAULT_TOOLS);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  // Phones show the turn summary as a fixed overlay. It must leave the header (and in landscape
  // the whole side column) uncovered so the players and menu buttons stay reachable; the header's
  // height varies (its word line comes and goes), so its edges are published as CSS vars.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (!isPhone || !root || !header) return;
    const update = () => {
      const rect = header.getBoundingClientRect();
      root.style.setProperty('--phone-header-bottom', `${Math.round(rect.bottom)}px`);
      root.style.setProperty('--phone-header-left', `${Math.round(rect.left)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(header);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--phone-header-bottom');
      root.style.removeProperty('--phone-header-left');
    };
  }, [isPhone]);

  const view = room.game;
  // The game holds at a turn boundary for players whose phones went dark (the platform overlay says so).
  const holding = Boolean(room.waiting);
  // A turn summary whose time ran out waits on the server's next turn: the header clock must not sit on a red "0".
  const summaryEndsAt = view?.phase.kind === 'turnEnd' && !holding ? view.phase.endsAt : null;
  const summarySeconds = useCountdownSeconds(summaryEndsAt);
  const summarySettling = summaryEndsAt !== null && summarySeconds <= 0;
  if (!view) return null;
  const phase = view.phase;
  const drawerId = drawerIdOf(view);
  const drawer = drawerId ? (room.players.find((p) => p.id === drawerId) ?? null) : null;
  const isDrawer = drawerId !== null && drawerId === meId;
  const guessed = hasGuessed(view, meId);
  const canDraw = isDrawer && phase.kind === 'drawing';
  const canUndo = hasStrokes && connected;
  const endsAt = 'endsAt' in phase ? phase.endsAt : null;
  const turnKey = `${view.round}-${view.turn}-${drawerId ?? ''}`;
  // On a phone an unsolved guesser types into the tiles in the guess bar, so the header word
  // area only shows a word that is actually known (drawer, solved guesser, turn summary).
  const wordKnown = holding || (phase.kind === 'drawing' && (isDrawer || guessed)) || phase.kind === 'turnEnd';

  const wordArea = holding ? (
    <div className="word" data-testid="skribble-paused">
      <span className="word__label">Paused</span>
      <span className="word__text word__text--muted">Waiting for players</span>
    </div>
  ) : (
    <>
      {phase.kind === 'drawing' && <WordDisplay word={phase.word} mask={phase.mask} isDrawer={isDrawer} />}
      {phase.kind === 'turnEnd' && <WordDisplay word={phase.word} isDrawer={false} />}
      {phase.kind === 'choosing' && (
        <div className="word">
          <span className="word__label">{isDrawer ? 'Your turn!' : 'Get ready'}</span>
          <span className="word__text word__text--muted">{isDrawer ? 'Choose a word' : `${drawer?.name ?? 'Someone'} is choosing`}</span>
        </div>
      )}
      {phase.kind === 'gameOver' && (
        <div className="word">
          <span className="word__label">Final scores</span>
          <span className="word__text word__text--muted">Game over</span>
        </div>
      )}
    </>
  );

  const timer = (endsAt !== null || holding) && (
    <Timer endsAt={endsAt} paused={holding} settling={summarySettling} warnUnder={phase.kind === 'turnEnd' ? 0 : phase.kind === 'choosing' ? 5 : 10} tickUnder={phase.kind === 'drawing' ? 5 : undefined} />
  );

  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;

  return (
    <div ref={rootRef} className={`game${isPhone ? ' game--phone' : ''}${canDraw ? ' game--drawer' : ''}`} data-phase={phase.kind}>
      <header ref={headerRef} className="game__top card" data-testid="game-header">
        {isPhone ? (
          <>
            <div className="game__round game__round--compact" data-testid="round-indicator">
              <strong>
                Round {view.round}/{view.totalRounds}
              </strong>
              <small>
                Turn {view.turn}/{view.turnsInRound}
              </small>
            </div>
            {timer}
            {phase.kind === 'drawing' && <Rating phase={phase} isDrawer={isDrawer} compact />}
            <button
              type="button"
              className="players-btn"
              onClick={() => setPlayersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={playersOpen}
              aria-label={`Players (${room.players.length})`}
              data-testid="players-toggle"
            >
              <UsersIcon size={18} />
              <span>{room.players.length}</span>
            </button>
            <button
              type="button"
              className="icon-btn game__menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-label="More options"
              data-testid="game-menu"
            >
              <MoreIcon size={20} />
            </button>
            <div className={`game__word${wordKnown ? '' : ' game__word--phone-hidden'}`}>{wordArea}</div>
          </>
        ) : (
          <>
            <div className="game__brand">
              <span className="brand__mark brand__mark--sm brand__mark--skribble" aria-hidden="true">
                <PencilIcon size={16} />
              </span>
              <div className="game__round" data-testid="round-indicator">
                <strong>
                  Round {view.round} of {view.totalRounds}
                </strong>
                <small>
                  Turn {view.turn}/{view.turnsInRound}
                </small>
              </div>
            </div>

            <div className="game__word">{wordArea}</div>

            <div className="game__side">
              {phase.kind === 'drawing' && <Rating phase={phase} isDrawer={isDrawer} />}
              {timer}
              <div className="game__controls">
                <ConnectionPill />
                <SoundToggle />
                <ThemeToggle />
                <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                  <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
                </button>
              </div>
            </div>
          </>
        )}
      </header>

      {!isPhone && (
        <aside className="game__players card" aria-label="Players">
          <div className="game__players-body">{players}</div>
        </aside>
      )}

      <main className="game__center">
        <GameCanvas canDraw={canDraw} settings={tools} turnKey={turnKey} footer={canDraw ? <Toolbar settings={tools} onChange={setTools} canUndo={canUndo} /> : undefined}>
          {phase.kind === 'choosing' && <ChoosingOverlay phase={phase} room={room} isDrawer={isDrawer} paused={holding} />}
          {phase.kind === 'turnEnd' && <TurnEndOverlay phase={phase} room={room} paused={holding} />}
          {phase.kind === 'drawing' && !isDrawer && <DrawingCaption drawer={drawer} />}
        </GameCanvas>
      </main>

      <aside className="game__chat card" aria-label="Chat">
        <Chat />
      </aside>

      {isPhone && (
        <>
          <BottomSheet open={playersOpen} title={`Players (${room.players.length})`} onClose={() => setPlayersOpen(false)} testId="players-sheet">
            {players}
          </BottomSheet>
          <BottomSheet open={menuOpen} title="Options" onClose={() => setMenuOpen(false)} testId="menu-sheet">
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
