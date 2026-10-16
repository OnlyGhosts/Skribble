import { useLayoutEffect, useRef, useState } from 'react';
import type { SkribblePhase, SkribbleSettings, SkribbleView } from '@shared/games/skribble/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMenuSheet, GameTopBar, RoundStatus } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useCountdownSeconds } from '../../platform/lib/useCountdown';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { DEFAULT_DRAWING_SETTINGS, GameCanvas, Toolbar, type DrawingSettings } from '../../platform/canvas';
import { clearCanvas, rateDrawing, redoStroke, undoStroke } from './actions';
import { skribbleCanvas } from './canvas';
import { ThumbDownIcon, ThumbUpIcon } from './components/Icons';
import { GuessBox } from './components/GuessBox';
import { GuessFeed } from './components/GuessFeed';
import { ChoosingOverlay, DrawingCaption, TurnEndOverlay } from './components/Overlays';
import { WordDisplay } from './components/WordDisplay';
import { drawerIdOf, hasGuessed } from './hooks';

const meta = gameById('skribble');

type DrawingPhase = Extract<SkribblePhase, { kind: 'drawing' }>;

/**
 * Guessers rate the drawing from the canvas corner; the drawer and anyone sitting the game out
 * only see the tally there (it lets the drawer's strokes through to the canvas).
 */
function Rating({ phase, canRate }: { phase: DrawingPhase; canRate: boolean }) {
  return (
    <div className={`rating${canRate ? '' : ' rating--tally'}`} role="group" aria-label="Rate the drawing" data-testid="rating">
      <button
        type="button"
        className={`rating__btn${phase.myRating === 'like' ? ' is-active' : ''}`}
        onClick={() => rateDrawing('like')}
        disabled={!canRate}
        aria-pressed={phase.myRating === 'like'}
        aria-label={`Like this drawing (${phase.likes})`}
        data-testid="rate-like"
      >
        <ThumbUpIcon size={16} /> <span>{phase.likes}</span>
      </button>
      <button
        type="button"
        className={`rating__btn rating__btn--down${phase.myRating === 'dislike' ? ' is-active' : ''}`}
        onClick={() => rateDrawing('dislike')}
        disabled={!canRate}
        aria-pressed={phase.myRating === 'dislike'}
        aria-label={`Dislike this drawing (${phase.dislikes})`}
        data-testid="rate-dislike"
      >
        <ThumbDownIcon size={16} /> <span>{phase.dislikes}</span>
      </button>
    </div>
  );
}

/** The Skribble game screen: header, canvas with overlays and toolbar, players (a sheet on phones), the guess feed and the guess box. */
export function SkribbleScreen({ room, meId, isHost }: GameScreenProps<SkribbleView, SkribbleSettings>) {
  const game = useActiveGame();
  // Undo/clear apply locally the moment they are sent, so they are only offered while they can be sent.
  const hasStrokes = skribbleCanvas.store((s) => s.canvas.length > 0);
  const hasRedo = skribbleCanvas.store((s) => s.redoable.length > 0);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const [tools, setTools] = useState<DrawingSettings>(DEFAULT_DRAWING_SETTINGS);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Phones show the turn summary as a fixed overlay. It must leave the header (and in landscape
  // the whole side column) uncovered so the players and menu buttons stay reachable; the header's
  // height varies (its word line comes and goes), so its edges are published as CSS vars.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root?.querySelector<HTMLElement>('[data-testid="game-header"]');
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
  const participating = room.players.find((p) => p.id === meId)?.participating ?? false;
  const canRate = participating && !isDrawer;
  const guessed = hasGuessed(view, meId);
  const canDraw = isDrawer && phase.kind === 'drawing';
  const canUndo = hasStrokes && connected;
  const canRedo = hasRedo && connected;
  const endsAt = 'endsAt' in phase ? phase.endsAt : null;
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
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="game-header"
        className="game__top"
        status={
          <>
            <RoundStatus round={view.round} total={view.totalRounds} />
            <span className="gbar__more">
              {' '}
              · Turn {view.turn}/{view.turnsInRound}
            </span>
          </>
        }
        statusData={{ 'data-round': view.round, 'data-turn': view.turn }}
        clock={timer || undefined}
        players={{ open: playersOpen, onOpen: () => setPlayersOpen(true) }}
        menu={{ open: menuOpen, onOpen: () => setMenuOpen(true) }}
        middle={isPhone ? undefined : <div className="game__word">{wordArea}</div>}
        below={isPhone ? <div className={`game__word${wordKnown ? '' : ' game__word--phone-hidden'}`}>{wordArea}</div> : undefined}
      />

      {!isPhone && (
        <aside className="game__players card" aria-label="Players">
          <div className="game__players-body">{players}</div>
        </aside>
      )}

      <main className="game__center">
        <GameCanvas
          session={skribbleCanvas}
          canDraw={canDraw}
          settings={tools}
          footer={canDraw ? <Toolbar settings={tools} onChange={setTools} canUndo={canUndo} onUndo={undoStroke} canRedo={canRedo} onRedo={redoStroke} onClear={clearCanvas} /> : undefined}
        >
          {phase.kind === 'choosing' && <ChoosingOverlay phase={phase} room={room} isDrawer={isDrawer} paused={holding} />}
          {phase.kind === 'turnEnd' && <TurnEndOverlay phase={phase} room={room} paused={holding} />}
          {phase.kind === 'drawing' && !isDrawer && <DrawingCaption drawer={drawer} />}
          {phase.kind === 'drawing' && <Rating phase={phase} canRate={canRate} />}
        </GameCanvas>
      </main>

      <aside className="game__guesses card" aria-label="Guesses">
        <GuessFeed />
        <GuessBox />
      </aside>

      {isPhone && (
        <>
          <BottomSheet open={playersOpen} title={`Players (${room.players.length})`} onClose={() => setPlayersOpen(false)} testId="players-sheet">
            {players}
          </BottomSheet>
          <GameMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
        </>
      )}
    </div>
  );
}
