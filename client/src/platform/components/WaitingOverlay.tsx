import { useRef } from 'react';
import type { PlayerPublic, RoomState, WaitingState } from '@shared/platform/protocol';
import { useModalFocus } from '../lib/useModalFocus';
import { kickPlayer, leaveRoom } from '../net/actions';
import { Avatar } from './Avatar';
import { KickIcon, LogoutIcon } from './Icons';

/** "Waiting for Bob and Carol to reconnect" (Oxford-free list of up to any length). */
export function waitingTitle(names: string[]): string {
  if (names.length === 0) return 'Waiting for players to reconnect';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Waiting for ${list} to reconnect`;
}

/** The missing players that still hold a seat (a removed one simply drops off the list). */
export function missingPlayers(room: RoomState, waiting: WaitingState): PlayerPublic[] {
  return waiting.missing.map((id) => room.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => p !== undefined);
}

/**
 * Shown by the platform over any game's screen while the game holds at a boundary for players
 * whose phones went dark (`room.waiting`). The game picks up on its own when they are back; the
 * host may remove them instead. A modal dialog like the podium: it takes the focus away from the
 * screen it covers and keeps Tab inside until it goes away.
 */
export function WaitingOverlay({ room, waiting, isHost }: { room: RoomState; waiting: WaitingState; isHost: boolean }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const missing = missingPlayers(room, waiting);
  return (
    <div className="waiting-overlay" role="dialog" aria-modal="true" aria-label="Game paused" data-testid="overlay-waiting" data-connected={waiting.connected} data-needed={waiting.needed}>
      <div className="overlay__card" ref={cardRef} tabIndex={-1}>
        <p className="overlay__kicker">Game paused</p>
        {missing.length > 0 && (
          <ul className="waiting__avatars" aria-hidden="true">
            {missing.map((p) => (
              <li key={p.id} className="waiting__avatar">
                <Avatar avatar={p.avatar} size="lg" dimmed />
              </li>
            ))}
          </ul>
        )}
        <h2 className="overlay__title" data-testid="waiting-title">
          {waitingTitle(missing.map((p) => p.name))}
        </h2>
        <p className="waiting__count" role="status" data-testid="waiting-count">
          <span className="spinner" aria-hidden="true" /> {`${waiting.connected} of ${waiting.needed} players connected`}
        </p>
        <p className="overlay__hint">The game carries on by itself as soon as they are back.</p>
        {isHost && missing.length > 0 && (
          <div className="waiting__remove">
            {missing.map((p) => (
              <button key={p.id} type="button" className="btn btn--secondary btn--sm" onClick={() => kickPlayer(p.id)} data-testid="waiting-remove" data-player-id={p.id}>
                <KickIcon size={15} /> {`Remove ${p.name}`}
              </button>
            ))}
            <p className="overlay__hint" data-testid="waiting-remove-hint">
              Removing a player lets the game continue without them, or ends it if too few remain.
            </p>
          </div>
        )}
        <div className="overlay__footer">
          <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="waiting-leave">
            <LogoutIcon size={16} /> Leave room
          </button>
        </div>
      </div>
    </div>
  );
}
