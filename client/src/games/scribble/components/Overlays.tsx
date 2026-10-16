import type { ScribblePhase, ScribbleRoomState } from '@shared/games/scribble/protocol';
import type { PlayerPublic } from '@shared/platform/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { ResultNext, ResultPoints, earnersOf } from '../../../platform/components/RoundResult';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { chooseWord } from '../actions';
import { turnEndReasonText } from '../lib/format';

type ChoosingPhase = Extract<ScribblePhase, { kind: 'choosing' }>;
type TurnEndPhase = Extract<ScribblePhase, { kind: 'turnEnd' }>;

function findPlayer(room: ScribbleRoomState, id: string): PlayerPublic | undefined {
  return room.players.find((p) => p.id === id);
}

export function ChoosingOverlay({ phase, room, isDrawer, paused = false }: { phase: ChoosingPhase; room: ScribbleRoomState; isDrawer: boolean; paused?: boolean }) {
  const drawer = findPlayer(room, phase.drawerId);
  return (
    <div className="overlay overlay--choosing" data-testid="overlay-choosing">
      <div className="overlay__card">
        {isDrawer ? (
          <>
            <h2 className="overlay__title">Pick a word to draw</h2>
            <Timer endsAt={phase.endsAt} size="md" warnUnder={5} paused={paused} />
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
            <Timer endsAt={phase.endsAt} size="md" warnUnder={5} paused={paused} />
          </>
        )}
      </div>
    </div>
  );
}

export function TurnEndOverlay({ phase, room, paused = false }: { phase: TurnEndPhase; room: ScribbleRoomState; paused?: boolean }) {
  const drawerName = findPlayer(room, phase.drawerId)?.name ?? 'The drawer';
  // The summary's time ran out and the server's next turn is a beat away: no red "0" meanwhile.
  const seconds = useCountdownSeconds(paused ? null : phase.endsAt);
  const settling = !paused && seconds <= 0;
  const rows = earnersOf(room.players, phase.points).map(({ player, points }) => ({ id: player.id, player, name: player.name, points, tag: player.id === phase.drawerId ? 'drawer' : undefined }));
  return (
    <div className="overlay overlay--turn-end" data-testid="overlay-turn-end">
      <div className="overlay__card result-card">
        <p className="result-kicker">{turnEndReasonText(phase.reason, drawerName)}</p>
        {phase.word ? (
          <p className="result-reveal">
            <span className="result-reveal__label">The word was</span>
            <strong className="result-reveal__value">{phase.word}</strong>
          </p>
        ) : (
          <h2 className="overlay__title">No word was chosen</h2>
        )}
        <ResultPoints rows={rows} label="Points earned this turn" empty="Nobody guessed it this time." />
        <ResultNext noun="Next turn" endsAt={phase.endsAt} paused={paused} settling={settling} testId="turn-end-countdown" />
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
