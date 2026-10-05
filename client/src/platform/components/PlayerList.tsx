import { useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { kickPlayer, voteKick } from '../net/actions';
import { Avatar } from './Avatar';
import { CrownIcon, KickIcon } from './Icons';

interface Props {
  room: RoomState;
  meId: string | null;
  isHost: boolean;
  /** Lobby: join order and ready state. Game: ranked by score. */
  mode: 'lobby' | 'game';
  /** The room's game module; its player hooks add badges, extra meta and row classes. */
  game: AnyGameClientModule | null;
}

function sortPlayers(players: PlayerPublic[], mode: Props['mode']): PlayerPublic[] {
  const list = players.slice();
  if (mode === 'lobby') return list.sort((a, b) => a.joinOrder - b.joinOrder);
  return list.sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
}

export function PlayerList({ room, meId, isHost, mode, game }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const players = sortPlayers(room.players, mode);
  const inGame = mode === 'game' && room.game !== null;

  return (
    <ul className="player-list" data-testid="player-list" aria-label="Players">
      {players.map((p, i) => {
        const isMe = p.id === meId;
        const confirming = confirmId === p.id;
        const badge = inGame ? game?.playerBadge?.(room, p) : null;
        const meta = inGame ? game?.playerMeta?.(room, p) : null;
        const extraClass = inGame ? game?.playerClassName?.(room, p) : undefined;
        return (
          <li
            key={p.id}
            className={['player', p.connected ? '' : 'player--offline', isMe ? 'player--me' : '', extraClass ?? ''].join(' ').trim()}
            data-testid="player-item"
            data-player-id={p.id}
            data-name={p.name}
            data-score={p.score}
          >
            {mode === 'game' && <span className="player__rank">#{i + 1}</span>}
            <span className="player__avatar">
              <Avatar avatar={p.avatar} size="md" dimmed={!p.connected} />
              {badge}
            </span>
            <span className="player__body">
              <span className="player__name">
                {p.isHost && (
                  <span className="player__crown" title="Host" aria-label="Host" data-testid="host-crown">
                    <CrownIcon size={14} />
                  </span>
                )}
                <span className="player__name-text">{p.name}</span>
                {isMe && <span className="player__you">you</span>}
              </span>
              <span className="player__meta">
                {mode === 'game' ? (
                  <>
                    <span className="player__score" data-testid="player-score">
                      {p.score} pts
                    </span>
                    {meta}
                  </>
                ) : (
                  <span className={`player__status${p.connected ? '' : ' player__status--offline'}`}>{p.connected ? 'ready' : 'reconnecting…'}</span>
                )}
                {mode === 'game' && !p.connected && <span className="player__status player__status--offline">offline</span>}
              </span>
            </span>
            {!isMe && (
              <span className="player__actions">
                {confirming ? (
                  <span className="confirm" role="group" aria-label={`Confirm kicking ${p.name}`}>
                    <button
                      type="button"
                      className="btn btn--danger btn--xs"
                      onClick={() => {
                        if (isHost) kickPlayer(p.id);
                        else voteKick(p.id);
                        setConfirmId(null);
                      }}
                      data-testid="kick-confirm"
                    >
                      {isHost ? 'Kick' : 'Vote'}
                    </button>
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => setConfirmId(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm player__kick"
                    aria-label={isHost ? `Kick ${p.name}` : `Vote to kick ${p.name}`}
                    title={isHost ? 'Kick player' : 'Vote to kick'}
                    onClick={() => setConfirmId(p.id)}
                    data-testid={isHost ? 'kick-player' : 'votekick-player'}
                  >
                    <KickIcon size={15} />
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
