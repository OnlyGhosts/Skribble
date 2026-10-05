import { useRef } from 'react';
import type { PlayerPublic, PodiumEntry, RoomState } from '@shared/platform/protocol';
import { useModalFocus } from '../lib/useModalFocus';
import { leaveRoom, returnToLobby } from '../net/actions';
import { Avatar } from './Avatar';
import { LogoutIcon } from './Icons';

const MEDALS = ['🥇', '🥈', '🥉'];

function findPlayer(room: RoomState, id: string): PlayerPublic | undefined {
  return room.players.find((p) => p.id === id);
}

/**
 * The final standings, shown by the platform over any game's screen once the room is 'ended'.
 * The host sends everyone back to the lobby; anyone may leave. A modal dialog: it takes the focus
 * away from the game screen it covers and keeps Tab inside until it goes away.
 */
export function PodiumOverlay({ room, isHost }: { room: RoomState; isHost: boolean }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const ordered = (room.podium ?? []).slice().sort((a, b) => a.rank - b.rank || b.score - a.score);
  const top = ordered.slice(0, 3);
  const rest = ordered.slice(3);
  // Visual order puts the winner in the middle, like a real podium.
  const podiumOrder = [top[1], top[0], top[2]].filter((p): p is PodiumEntry => p !== undefined);
  return (
    <div className="podium-overlay" role="dialog" aria-modal="true" aria-label="Final scores" data-testid="overlay-game-end">
      <div className="overlay__card overlay__card--wide" ref={cardRef} tabIndex={-1}>
        <p className="overlay__kicker">Game over</p>
        <h2 className="overlay__title">{top[0] ? `${findPlayer(room, top[0].playerId)?.name ?? 'Someone'} wins!` : 'Thanks for playing!'}</h2>
        <ol className="podium" aria-label="Podium">
          {podiumOrder.map((entry) => {
            const player = findPlayer(room, entry.playerId);
            return (
              <li key={entry.playerId} className={`podium__step podium__step--${entry.rank}`} data-rank={entry.rank} data-testid="podium-entry">
                <span className="podium__medal" aria-hidden="true">
                  {MEDALS[entry.rank - 1] ?? ''}
                </span>
                {player ? <Avatar avatar={player.avatar} size="lg" /> : <span className="avatar avatar--lg avatar--placeholder" />}
                <span className="podium__name">{player?.name ?? 'Left the game'}</span>
                <span className="podium__score">{entry.score} pts</span>
                <span className="podium__block" aria-hidden="true" />
              </li>
            );
          })}
        </ol>
        {rest.length > 0 && (
          <ol className="podium-rest" start={4} aria-label="Other players">
            {rest.map((entry) => {
              const player = findPlayer(room, entry.playerId);
              return (
                <li key={entry.playerId} className="podium-rest__row" data-testid="podium-entry">
                  <span className="podium-rest__rank">#{entry.rank}</span>
                  {player && <Avatar avatar={player.avatar} size="sm" />}
                  <span className="podium-rest__name">{player?.name ?? 'Left the game'}</span>
                  <span className="podium-rest__score">{entry.score} pts</span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="overlay__footer podium-overlay__footer">
          {isHost ? (
            <button type="button" className="btn btn--primary" onClick={returnToLobby} data-testid="back-to-lobby">
              Back to lobby
            </button>
          ) : (
            <p className="overlay__hint">
              Waiting for the host<span className="ellipsis" aria-hidden="true" />
            </p>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="podium-leave">
            <LogoutIcon size={16} /> Leave room
          </button>
        </div>
      </div>
    </div>
  );
}
