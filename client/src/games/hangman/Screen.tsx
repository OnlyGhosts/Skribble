import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { HangmanSettings, HangmanView } from '@shared/games/hangman/protocol';
import { gameById } from '@shared/platform/games';
import { DEFAULT_DRAWING_SETTINGS, GameCanvas, Toolbar, type DrawingSettings } from '../../platform/canvas';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { GameMenuSheet, GameTopBar } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { clearSection, drawDone, redoStroke, undoStroke } from './actions';
import { hangmanCanvas, useStrokeCount } from './canvas';
import { FigureGhost } from './components/Figure';
import { GuessPanel } from './components/GuessPanel';
import { ChoosingOverlay, DrawingCaption, TurnEndOverlay } from './components/Overlays';
import { WordStrip } from './components/WordStrip';
import { LANDSCAPE_QUERY, isHangman, scrollAnchor } from './hooks';
import { sectionLabel } from './lib/text';
import { useHangman } from './store';

const meta = gameById('hangman');

/** The hangman's bar under the toolbar while they draw: which piece this is, and Done. */
function DrawBar({ view }: { view: HangmanView }) {
  const section = view.section ?? 1;
  return (
    <div className="hm-drawbar" data-testid="draw-bar" data-section={section}>
      <span className="hm-drawbar__label">
        <strong>{sectionLabel(section, view.maxWrong)}</strong>
        <small>Trace the ghost, or draw it your way.</small>
      </span>
      <button type="button" className="btn btn--primary hm-drawbar__done" onClick={drawDone} data-testid="draw-done">
        Done
      </button>
    </div>
  );
}

/** Scrolls the column so `target` opens in view: its top, or the canvas frame at its top. */
function scrollColumn(column: HTMLElement | null, canvas: HTMLElement | null, target: 'top' | 'canvas'): void {
  if (!column) return;
  const top = target === 'canvas' && canvas ? canvas.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop : 0;
  column.scrollTo({ top: Math.max(0, top) });
}

/**
 * The Hangman screen: a compact top bar (round, the clock, players, chat, options) over one
 * column that scrolls: the word strip, the canvas (with the hangman's ghost and tools while they
 * draw) and the guess panel. Desktop adds the players on the left and the chat on the right; a
 * phone turned sideways puts the canvas beside the strip, with the drawing tools in that column.
 */
export function HangmanScreen({ room, meId, isHost }: GameScreenProps<HangmanView, HangmanSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const landscape = useMediaQuery(LANDSCAPE_QUERY);
  useAppMode(isPhone);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // A new section, turn or guess opens with what matters in view, however far the player had scrolled.
  const anchor = scrollAnchor(room, meId);
  useEffect(() => {
    if (anchor) scrollColumn(columnRef.current, canvasRef.current, anchor.to);
  }, [anchor?.key, anchor?.to]);
  const sheet = useHangman((s) => s.sheet);
  const openSheet = useHangman((s) => s.openSheet);
  const closeSheet = () => openSheet(null);
  const sectionFloor = useHangman((s) => s.sectionFloor);
  const strokes = useStrokeCount();
  const hasRedo = hangmanCanvas.store((s) => s.redoable.length > 0);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const [brush, setBrush] = useState<DrawingSettings>(DEFAULT_DRAWING_SETTINGS);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const paused = holding || view.paused;
  const mine = isHangman(view, meId);
  const canDraw = playing && mine && view.phase === 'drawing' && !paused;
  const myGuess = view.phase === 'guessing' && view.guesserId === meId;
  const wordKnown = view.word !== undefined;
  // Everyone but the hangman sees who is drawing, until the section's first stroke shows it.
  const caption = view.phase === 'drawing' && !mine && strokes <= sectionFloor;
  const drawTools = canDraw ? (
    <>
      <Toolbar settings={brush} onChange={setBrush} canUndo={connected && strokes > sectionFloor} onUndo={undoStroke} canRedo={connected && hasRedo} onRedo={redoStroke} onClear={clearSection} />
      <DrawBar view={view} />
    </>
  ) : null;
  const endsAt = playing && !paused ? view.endsAt : null;
  const warnUnder = view.phase === 'choosing' ? 5 : view.phase === 'turnEnd' ? 0 : 10;
  const tickUnder = (view.phase === 'guessing' && myGuess) || (view.phase === 'drawing' && mine) ? 5 : undefined;
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const style = { '--hm-accent': meta.accent } as CSSProperties;

  return (
    <div className={`hm${isPhone ? ' hm--phone' : ''}${canDraw ? ' hm--drawer' : ''}`} style={style} data-phase={view.phase} data-testid="hangman-screen">
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="hangman-header"
        className="hm__top"
        status={
          <>
            Round {view.round}/{view.totalRounds}
            <span className="gbar__more">
              {' '}
              · Turn {view.turn}/{view.turnsInRound}
            </span>
          </>
        }
        statusData={{ 'data-round': view.round, 'data-turn': view.turn }}
        clock={<Timer endsAt={endsAt} paused={paused} warnUnder={warnUnder} tickUnder={tickUnder} />}
        players={{ open: sheet === 'players', onOpen: () => openSheet('players') }}
        chat={isPhone ? { open: sheet === 'chat', onOpen: () => openSheet('chat') } : undefined}
        menu={{ open: sheet === 'menu', onOpen: () => openSheet('menu') }}
      />

      {!isPhone && (
        <aside className="hm__players card" aria-label="Players">
          <div className="hm__players-body">{players}</div>
        </aside>
      )}

      <main className="hm__main" data-testid="hangman-main">
        <div className="hm__scroll" ref={columnRef} data-testid="hangman-column">
          <section className="hm__strip card">
            <WordStrip view={view} showWord={wordKnown} />
          </section>
          <div className="hm__canvas" ref={canvasRef}>
            {/* Sideways, the tools go in the side column so the canvas, the tools and Done all fit the height. */}
            <GameCanvas session={hangmanCanvas} canDraw={canDraw} settings={brush} footer={drawTools && !landscape ? drawTools : undefined}>
              {canDraw && view.section !== null && <FigureGhost section={view.section} />}
              {caption && <DrawingCaption room={room} view={view} />}
            </GameCanvas>
          </div>
          {drawTools && landscape && (
            <div className="hm__tools" data-testid="hangman-tools">
              {drawTools}
            </div>
          )}
          {/* The hangman has nothing to guess while they draw: the Done bar says which section this is. */}
          {!canDraw && (
            <section className="hm__panel card">
              <GuessPanel room={room} view={view} meId={meId} />
            </section>
          )}
        </div>
        {playing && view.phase === 'choosing' && <ChoosingOverlay room={room} view={view} paused={paused} isHangman={mine} />}
        {playing && view.phase === 'turnEnd' && <TurnEndOverlay room={room} view={view} paused={holding} />}
      </main>

      {!isPhone && (
        <aside className="hm__chat card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="hm__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <GameMenuSheet open={sheet === 'menu'} onClose={closeSheet} />
        </>
      )}
    </div>
  );
}
