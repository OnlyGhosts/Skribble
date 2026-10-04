import type { Phase, PlayerPublic, RoomState } from '@shared/protocol';
import { chooseWord, returnToLobby } from '../net/actions';
import { formatPoints, turnEndReasonText } from '../lib/format';
import { Avatar } from './Avatar';
import { Timer } from './Timer';

type ChoosingPhase = Extract<Phase, { kind: 'choosing' }>;
type TurnEndPhase = Extract<Phase, { kind: 'turnEnd' }>;
type GameEndPhase = Extract<Phase, { kind: 'gameEnd' }>;

function findPlayer(room: RoomState, id: string): PlayerPublic | undefined {
  return room.players.find((p) => p.id === id);
}

export function ChoosingOverlay({ phase, room, isDrawer }: { phase: ChoosingPhase; room: RoomState; isDrawer: boolean }) {
  const drawer = findPlayer(room, phase.drawerId);
  return (
    <div className="overlay overlay--choosing" data-testid="overlay-choosing">
      <div className="overlay__card">
        {isDrawer ? (
          <>
            <h2 className="overlay__title">Pick a word to draw</h2>
            <Timer endsAt={phase.endsAt} size="md" warnUnder={5} />
            <div className="word-choices">
              {(phase.choices ?? []).map((word, i) => (
                <button key={`${i}-${word}`} type="button" className="btn btn--choice" onClick={() => chooseWord(i)} data-testid="word-choice">
                  {word}
                </button>
              ))}
            </div>
            <p className="overlay__hint">A word is picked for you when the timer runs out.</p>
          </>
        ) : (
          <>
            {drawer && <Avatar avatar={drawer.avatar} size="xl" />}
            <h2 className="overlay__title">
              {drawer?.name ?? 'Someone'} is choosing a word<span className="ellipsis" aria-hidden="true" />
            </h2>
            <Timer endsAt={phase.endsAt} size="md" warnUnder={5} />
          </>
        )}
      </div>
    </div>
  );
}

export function TurnEndOverlay({ phase, room }: { phase: TurnEndPhase; room: RoomState }) {
  const drawerName = findPlayer(room, phase.drawerId)?.name ?? 'The drawer';
  const earners = Object.entries(phase.points)
    .filter(([, pts]) => pts > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="overlay overlay--turn-end" data-testid="overlay-turn-end">
      <div className="overlay__card">
        <p className="overlay__kicker">{turnEndReasonText(phase.reason, drawerName)}</p>
        <h2 className="overlay__title">
          {phase.word ? (
            <>
              The word was <span className="overlay__word">{phase.word}</span>
            </>
          ) : (
            'No word was chosen'
          )}
        </h2>
        {earners.length > 0 ? (
          <ul className="points-list" aria-label="Points earned this turn">
            {earners.map(([id, pts]) => {
              const player = findPlayer(room, id);
              return (
                <li key={id} className="points-list__row">
                  {player && <Avatar avatar={player.avatar} size="sm" />}
                  <span className="points-list__name">
                    {player?.name ?? 'A player'}
                    {id === phase.drawerId && <span className="points-list__tag">drawer</span>}
                  </span>
                  <span className="points-list__pts">{formatPoints(pts)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="overlay__hint">Nobody guessed it this time.</p>
        )}
        <div className="overlay__footer">
          <span>Next turn in</span>
          <Timer endsAt={phase.endsAt} size="md" warnUnder={0} />
        </div>
      </div>
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function GameEndOverlay({ phase, room, isHost }: { phase: GameEndPhase; room: RoomState; isHost: boolean }) {
  const ordered = phase.podium.slice().sort((a, b) => a.rank - b.rank || b.score - a.score);
  const top = ordered.slice(0, 3);
  const rest = ordered.slice(3);
  // Visual order puts the winner in the middle, like a real podium.
  const podiumOrder = [top[1], top[0], top[2]].filter((p): p is GameEndPhase['podium'][number] => p !== undefined);
  return (
    <div className="overlay overlay--end" data-testid="overlay-game-end">
      <div className="overlay__card overlay__card--wide">
        <p className="overlay__kicker">Game over</p>
        <h2 className="overlay__title">
          {top[0] ? `${findPlayer(room, top[0].playerId)?.name ?? 'Someone'} wins!` : 'Thanks for playing!'}
        </h2>
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
        <div className="overlay__footer">
          {isHost ? (
            <button type="button" className="btn btn--primary" onClick={returnToLobby} data-testid="back-to-lobby">
              Back to lobby
            </button>
          ) : (
            <p className="overlay__hint">
              Waiting for the host<span className="ellipsis" aria-hidden="true" />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DrawingCaption({ drawer }: { drawer: PlayerPublic | null }) {
  return (
    <div className="canvas-caption" data-testid="drawing-caption">
      {drawer && <Avatar avatar={drawer.avatar} size="sm" />}
      <span>{drawer?.name ?? 'Someone'} is drawing</span>
    </div>
  );
}
