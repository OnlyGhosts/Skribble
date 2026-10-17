import { useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { scoreShort } from '../lib/format';
import { isReady } from '../lib/party';
import { kickPlayer, voteKick } from '../net/actions';
import { Avatar } from './Avatar';
import { CheckIcon, CrownIcon, EyeIcon, KickIcon } from './Icons';

interface Props {
  room: RoomState;
  meId: string | null;
  isHost: boolean;
  /** Lobby: join order and ready state. Game: ranked by score, spectators last. */
  mode: 'lobby' | 'game';
  /** The room's game module; its player hooks add badges, extra meta and row classes. */
  game: AnyGameClientModule | null;
}

function sortPlayers(players: PlayerPublic[], mode: Props['mode']): PlayerPublic[] {
  const list = players.slice();
  if (mode === 'lobby') return list.sort((a, b) => a.joinOrder - b.joinOrder);
  return list.sort((a, b) => Number(b.participating) - Number(a.participating) || b.score - a.score || a.joinOrder - b.joinOrder);
}

/** What a player is up to between games: readied up, sitting the next one out, or still deciding. */
export function lobbyStatus(player: PlayerPublic): { label: string; state: 'ready' | 'sittingOut' | 'notReady' | 'offline' } {
  if (!player.connected) return { label: 'Reconnecting…', state: 'offline' };
  if (player.sittingOut) return { label: 'Sitting out', state: 'sittingOut' };
  if (isReady(player)) return { label: 'Ready', state: 'ready' };
  return { label: 'Not ready', state: 'notReady' };
}

export function PlayerList({ room, meId, isHost, mode, game }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const players = sortPlayers(room.players, mode);
  const inGame = mode === 'game' && room.game !== null;
  // Anyone else in the list has a kick button, so your own row keeps its width free.
  const buttons = players.some((p) => p.id !== meId);

  return (
    <ul className="player-list" data-testid="player-list" aria-label="Players">
      {players.map((p) => {
        const isMe = p.id === meId;
        const confirming = confirmId === p.id;
        const spectating = mode === 'game' && !p.participating;
        const badge = inGame && !spectating ? game?.playerBadge?.(room, p) : null;
        const meta = inGame && !spectating ? game?.playerMeta?.(room, p) : null;
        const extraClass = inGame && !spectating ? game?.playerClassName?.(room, p) : undefined;
        const status = mode === 'lobby' ? lobbyStatus(p) : null;
        const rank = mode === 'game' && !spectating ? players.filter((o) => o.participating).indexOf(p) + 1 : null;
        return (
          <li
            key={p.id}
            className={['player', p.connected ? '' : 'player--offline', isMe ? 'player--me' : '', spectating ? 'player--spectating' : '', extraClass ?? ''].join(' ').trim()}
            data-testid="player-item"
            data-player-id={p.id}
            data-name={p.name}
            data-score={p.score}
            data-status={status?.state ?? (spectating ? 'sittingOut' : 'playing')}
          >
            {mode === 'game' && <span className="player__rank">{rank === null ? '' : `#${rank}`}</span>}
            <span className="player__avatar">
              <Avatar avatar={p.avatar} size="md" dimmed={!p.connected} />
              {spectating ? (
                <span className="player__badge player__badge--spectator" title="Watching this game" aria-label="Watching this game">
                  <EyeIcon size={11} />
                </span>
              ) : (
                badge
              )}
            </span>
            <span className="player__body">
              {/* One badge a player at most: in a game that is the avatar's (the game's state); the host's crown sits by the name. */}
              <span className="player__name">
                {p.isHost && mode === 'game' && (
                  <span className="player__crown" role="img" title="Host" aria-label="Host" data-testid="host-crown">
                    <CrownIcon size={14} />
                  </span>
                )}
                <span className="player__name-text">{p.name}</span>
                {isMe && <span className="player__you">you</span>}
                {p.isHost && mode === 'lobby' && (
                  <span className="player__tag player__host" data-testid="host-crown">
                    <CrownIcon size={12} /> Host
                  </span>
                )}
              </span>
              {mode === 'game' && (
                <span className="player__meta">
                  {spectating ? (
                    <span className="player__status player__status--sitting-out" data-testid="player-sitting-out">
                      watching
                    </span>
                  ) : (
                    <span className="player__score" data-testid="player-score">
                      {scoreShort(p.score, game?.meta.scoreUnit)}
                    </span>
                  )}
                  {meta}
                  {!p.connected && <span className="player__status player__status--offline">offline</span>}
                </span>
              )}
            </span>
            {status && (
              <span className={`player__status player__status--${status.state}`} data-testid="player-status">
                {status.state === 'ready' && (
                  <span className="player__check" aria-hidden="true">
                    <CheckIcon size={15} strokeWidth={2.6} />
                  </span>
                )}
                {status.label}
              </span>
            )}
            {/* Last, at the right end: your own row keeps the kick button's width empty, so every row's status and button line up. */}
            {isMe && buttons && <span className="player__actions player__actions--spacer" aria-hidden="true" />}
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
                    <KickIcon size={18} />
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
