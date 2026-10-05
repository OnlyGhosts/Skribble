import type { SkribblePhase, SkribbleRoomState } from '@shared/games/skribble/protocol';
import type { PlayerPublic } from '@shared/platform/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { formatPoints } from '../../../platform/lib/format';
import { chooseWord } from '../actions';
import { turnEndReasonText } from '../lib/format';

type ChoosingPhase = Extract<SkribblePhase, { kind: 'choosing' }>;
type TurnEndPhase = Extract<SkribblePhase, { kind: 'turnEnd' }>;

function findPlayer(room: SkribbleRoomState, id: string): PlayerPublic | undefined {
  return room.players.find((p) => p.id === id);
}

export function ChoosingOverlay({ phase, room, isDrawer }: { phase: ChoosingPhase; room: SkribbleRoomState; isDrawer: boolean }) {
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

export function TurnEndOverlay({ phase, room }: { phase: TurnEndPhase; room: SkribbleRoomState }) {
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

export function DrawingCaption({ drawer }: { drawer: PlayerPublic | null }) {
  return (
    <div className="canvas-caption" data-testid="drawing-caption">
      {drawer && <Avatar avatar={drawer.avatar} size="sm" />}
      <span>{drawer?.name ?? 'Someone'} is drawing</span>
    </div>
  );
}
