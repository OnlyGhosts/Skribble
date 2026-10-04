import { useState } from 'react';
import type { RoomState } from '@shared/protocol';
import type { DrawingSettings } from '../canvas/useDrawing';
import { leaveRoom, rateDrawing } from '../net/actions';
import { selectDrawer, selectIsDrawer, selectIsHost, useGameStore } from '../store/useGameStore';
import { Chat } from '../components/Chat';
import { ConnectionPill } from '../components/ConnectionPill';
import { GameCanvas } from '../components/GameCanvas';
import { ChevronIcon, LogoutIcon, PencilIcon, ThumbDownIcon, ThumbUpIcon, UsersIcon } from '../components/Icons';
import { ChoosingOverlay, DrawingCaption, GameEndOverlay, TurnEndOverlay } from '../components/Overlays';
import { PlayerList } from '../components/PlayerList';
import { SoundToggle, ThemeToggle } from '../components/ThemeToggle';
import { Timer } from '../components/Timer';
import { Toolbar } from '../components/Toolbar';
import { WordDisplay } from '../components/WordDisplay';

const DEFAULT_TOOLS: DrawingSettings = { tool: 'brush', color: '#000000', size: 6 };

export function Game({ room }: { room: RoomState }) {
  const playerId = useGameStore((s) => s.playerId);
  const isHost = useGameStore(selectIsHost);
  const isDrawer = useGameStore(selectIsDrawer);
  const drawer = useGameStore(selectDrawer);
  const canUndo = useGameStore((s) => s.canvas.length > 0);
  const [tools, setTools] = useState<DrawingSettings>(DEFAULT_TOOLS);
  const [playersOpen, setPlayersOpen] = useState(false);

  const phase = room.phase;
  const canDraw = isDrawer && phase.kind === 'drawing';
  const endsAt = 'endsAt' in phase ? phase.endsAt : null;
  const turnKey = `${room.round}-${room.turn}-${drawer?.id ?? ''}`;

  return (
    <div className="game" data-phase={phase.kind}>
      <header className="game__top card">
        <div className="game__brand">
          <span className="brand__mark brand__mark--sm" aria-hidden="true">
            <PencilIcon size={16} />
          </span>
          <div className="game__round" data-testid="round-indicator">
            <strong>
              Round {room.round} of {room.totalRounds}
            </strong>
            <small>
              Turn {room.turn}/{room.turnsInRound}
            </small>
          </div>
        </div>

        <div className="game__word">
          {phase.kind === 'drawing' && <WordDisplay word={phase.word} mask={phase.mask} isDrawer={isDrawer} />}
          {phase.kind === 'turnEnd' && <WordDisplay word={phase.word} isDrawer={false} />}
          {phase.kind === 'choosing' && (
            <div className="word">
              <span className="word__label">{isDrawer ? 'Your turn!' : 'Get ready'}</span>
              <span className="word__text word__text--muted">{isDrawer ? 'Choose a word' : `${drawer?.name ?? 'Someone'} is choosing`}</span>
            </div>
          )}
          {phase.kind === 'gameEnd' && (
            <div className="word">
              <span className="word__label">Final scores</span>
              <span className="word__text word__text--muted">Game over</span>
            </div>
          )}
        </div>

        <div className="game__side">
          {phase.kind === 'drawing' && (
            <div className="rating" role="group" aria-label="Rate the drawing">
              <button
                type="button"
                className={`rating__btn${phase.myRating === 'like' ? ' is-active' : ''}`}
                onClick={() => rateDrawing('like')}
                disabled={isDrawer}
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
                disabled={isDrawer}
                aria-pressed={phase.myRating === 'dislike'}
                aria-label={`Dislike this drawing (${phase.dislikes})`}
                data-testid="rate-dislike"
              >
                <ThumbDownIcon size={16} /> <span>{phase.dislikes}</span>
              </button>
            </div>
          )}
          {endsAt !== null && (
            <Timer endsAt={endsAt} warnUnder={phase.kind === 'turnEnd' ? 0 : phase.kind === 'choosing' ? 5 : 10} tickUnder={phase.kind === 'drawing' ? 5 : undefined} />
          )}
          <div className="game__controls">
            <ConnectionPill />
            <SoundToggle />
            <ThemeToggle />
            <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
              <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
            </button>
          </div>
        </div>
      </header>

      <aside className={`game__players card${playersOpen ? ' is-open' : ''}`} aria-label="Players">
        <button type="button" className="players-toggle" onClick={() => setPlayersOpen((v) => !v)} aria-expanded={playersOpen} data-testid="players-toggle">
          <UsersIcon size={18} />
          <span>Players ({room.players.length})</span>
          <ChevronIcon size={16} className="players-toggle__chevron" />
        </button>
        <div className="game__players-body">
          <PlayerList room={room} meId={playerId} isHost={isHost} mode="game" />
        </div>
      </aside>

      <main className="game__center">
        <GameCanvas
          canDraw={canDraw}
          settings={tools}
          turnKey={turnKey}
          footer={canDraw ? <Toolbar settings={tools} onChange={setTools} canUndo={canUndo} /> : undefined}
        >
          {phase.kind === 'choosing' && <ChoosingOverlay phase={phase} room={room} isDrawer={isDrawer} />}
          {phase.kind === 'turnEnd' && <TurnEndOverlay phase={phase} room={room} />}
          {phase.kind === 'gameEnd' && <GameEndOverlay phase={phase} room={room} isHost={isHost} />}
          {phase.kind === 'drawing' && !isDrawer && <DrawingCaption drawer={drawer} />}
        </GameCanvas>
      </main>

      <aside className="game__chat card" aria-label="Chat">
        <Chat />
      </aside>
    </div>
  );
}
