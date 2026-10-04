import { useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared/protocol';
import { kickPlayer, voteKick } from '../net/actions';
import { formatPoints } from '../lib/format';
import { Avatar } from './Avatar';
import { CheckIcon, CrownIcon, KickIcon, PencilIcon } from './Icons';

interface Props {
  room: RoomState;
  meId: string | null;
  isHost: boolean;
  mode: 'lobby' | 'game';
}

function sortPlayers(players: PlayerPublic[], mode: Props['mode']): PlayerPublic[] {
  const list = players.slice();
  if (mode === 'lobby') return list.sort((a, b) => a.joinOrder - b.joinOrder);
  return list.sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
}

export function PlayerList({ room, meId, isHost, mode }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const phase = room.phase;
  const drawerId = 'drawerId' in phase ? phase.drawerId : null;
  const showTurnPoints = phase.kind === 'drawing' || phase.kind === 'turnEnd';
  const players = sortPlayers(room.players, mode);

  return (
    <ul className="player-list" data-testid="player-list" aria-label="Players">
      {players.map((p, i) => {
        const isMe = p.id === meId;
        const confirming = confirmId === p.id;
        return (
          <li
            key={p.id}
            className={[
              'player',
              p.connected ? '' : 'player--offline',
              isMe ? 'player--me' : '',
              p.id === drawerId ? 'player--drawer' : '',
              p.guessedThisTurn && p.id !== drawerId ? 'player--guessed' : '',
            ]
              .join(' ')
              .trim()}
            data-testid="player-item"
            data-player-id={p.id}
            data-name={p.name}
            data-score={p.score}
          >
            {mode === 'game' && <span className="player__rank">#{i + 1}</span>}
            <span className="player__avatar">
              <Avatar avatar={p.avatar} size="md" dimmed={!p.connected} />
              {p.id === drawerId && (
                <span className="player__badge player__badge--drawer" title="Drawing" aria-label="Drawing">
                  <PencilIcon size={11} />
                </span>
              )}
              {p.guessedThisTurn && p.id !== drawerId && (
                <span className="player__badge player__badge--guessed" title="Guessed the word" aria-label="Guessed the word">
                  <CheckIcon size={11} />
                </span>
              )}
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
                    {showTurnPoints && p.turnPoints > 0 && <span className="player__turn-points">{formatPoints(p.turnPoints)}</span>}
                  </>
                ) : (
                  <span className={`player__status${p.connected ? '' : ' player__status--offline'}`}>
                    {p.connected ? 'ready' : 'reconnecting…'}
                  </span>
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
