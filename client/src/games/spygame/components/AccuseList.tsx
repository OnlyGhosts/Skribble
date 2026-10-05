import type { SpygameRoomState, SpygameView } from '@shared/games/spygame/protocol';
import type { PlayerPublic } from '@shared/platform/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { CrownIcon } from '../../../platform/components/Icons';
import { accusePlayer } from '../actions';
import { accuseBlock, accuseTargetBlock } from '../hooks';
import { useSpygame } from '../store';
import { AlertIcon, EyeIcon } from './Icons';

interface Props {
  room: SpygameRoomState;
  view: SpygameView;
  meId: string;
}

function Badges({ view, player }: { view: SpygameView; player: PlayerPublic }) {
  const p = view.players[player.id];
  return (
    <>
      {p?.isAccused && (
        <span className="pill spy-accuse__pill spy-accuse__pill--accused">
          <AlertIcon size={12} /> accused
        </span>
      )}
      {p?.isSpectator && (
        <span className="pill spy-accuse__pill">
          <EyeIcon size={12} /> watching
        </span>
      )}
      {p?.hasAccused && !p.isAccused && <span className="pill spy-accuse__pill">accused someone</span>}
      {!player.connected && <span className="pill spy-accuse__pill">offline</span>}
    </>
  );
}

/**
 * Everyone in the room with their badges. Agents tap a name to highlight it and tap again to
 * start a vote; the spy and spectators get the same list read-only.
 */
export function AccuseList({ room, view, meId }: Props) {
  const highlighted = useSpygame((s) => s.highlightedPlayer);
  const highlight = useSpygame((s) => s.highlightPlayer);
  const interactive = view.role === 'agent';
  const listBlock = interactive ? accuseBlock(view, meId) : null;
  const players = room.players.slice().sort((a, b) => a.joinOrder - b.joinOrder);

  const tap = (id: string) => {
    if (highlighted === id) {
      highlight(null);
      accusePlayer(id);
    } else {
      highlight(id);
    }
  };

  return (
    <section className="spy-accuse" aria-label="Players" data-testid="accuse-list" data-interactive={interactive}>
      <header className="spy-accuse__head">
        <h2 className="spy-accuse__title">Players</h2>
        <p className="spy-accuse__hint" data-testid="accuse-hint">
          {!interactive ? (view.role === 'spy' ? 'The agents may call a vote on anyone. Stay calm.' : 'Spectators watch the vote.') : (listBlock ?? 'Suspect someone? Tap their name, then tap again to call a vote.')}
        </p>
      </header>
      <ul className="spy-accuse__list">
        {players.map((player) => {
          const targetBlock = interactive ? accuseTargetBlock(view, meId, player.id) : null;
          const disabled = !interactive || listBlock !== null || targetBlock !== null;
          const state = disabled ? 'disabled' : highlighted === player.id ? 'highlighted' : 'idle';
          const content = (
            <>
              <Avatar avatar={player.avatar} size="md" dimmed={!player.connected} />
              <span className="spy-accuse__body">
                <span className="spy-accuse__name">
                  {player.isHost && (
                    <span className="player__crown" title="Host" aria-label="Host">
                      <CrownIcon size={14} />
                    </span>
                  )}
                  <span className="spy-accuse__name-text">{player.name}</span>
                  {player.id === meId && <span className="player__you">you</span>}
                </span>
                <span className="spy-accuse__meta">
                  <span className="spy-accuse__score">{player.score} pts</span>
                  <Badges view={view} player={player} />
                </span>
              </span>
              {interactive && (
                <span className="spy-accuse__action" data-testid="accuse-action">
                  {state === 'highlighted' ? 'Tap again to accuse' : targetBlock ?? ''}
                </span>
              )}
            </>
          );
          const rowClass = `spy-accuse__row spy-accuse__row--${state}${player.id === meId ? ' spy-accuse__row--me' : ''}`;
          return (
            <li key={player.id}>
              {interactive ? (
                <button type="button" className={rowClass} onClick={() => tap(player.id)} disabled={disabled} aria-pressed={state === 'highlighted'} data-testid="accuse-row" data-player-id={player.id} data-name={player.name} data-state={state}>
                  {content}
                </button>
              ) : (
                <div className={rowClass} data-testid="accuse-row" data-player-id={player.id} data-name={player.name} data-state="readonly">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
