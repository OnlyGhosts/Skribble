import type { QuipgameAnswerResultView, QuipgameChoice, QuipgameMatchupResultView, QuipgameRoomState, QuipgameView } from '@shared/games/quipgame/protocol';
import { gameById } from '@shared/platform/games';
import { Avatar } from '../../../platform/components/Avatar';
import { formatPoints } from '../../../platform/lib/format';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { skipResult } from '../actions';
import { playerOf } from '../hooks';

const meta = gameById('quipgame');

interface Props {
  room: QuipgameRoomState;
  view: QuipgameView;
  result: QuipgameMatchupResultView;
  isHost: boolean;
  playing: boolean;
}

function headline(result: QuipgameMatchupResultView): string {
  switch (result.outcome) {
    case 'a':
      return `${result.a.authorName} takes it!`;
    case 'b':
      return `${result.b.authorName} takes it!`;
    case 'tie':
      return "It's a tie!";
    case 'noVotes':
      return 'Nobody voted';
  }
}

interface FooterProps {
  view: QuipgameView;
  isHost: boolean;
  label: string;
  /** False once the game has ended: the platform's podium is up and nothing counts down any more. */
  playing: boolean;
}

/** The footer every result shares: the countdown, and the host's Next. */
export function ResultFooter({ view, isHost, label, playing }: FooterProps) {
  const seconds = useCountdownSeconds(view.endsAt);
  return (
    <div className="quip-result__footer">
      {isHost && view.canSkip ? (
        <button type="button" className="btn btn--primary btn--lg" onClick={skipResult} data-testid="quip-next">
          {label} ({seconds})
        </button>
      ) : (
        <span className="quip-result__countdown" role="status" data-testid="result-countdown" data-seconds={seconds}>
          {playing ? `${label} in ${seconds}` : 'Game over'}
        </span>
      )}
    </div>
  );
}

function AnswerRow({ room, side, answer, total, won }: { room: QuipgameRoomState; side: QuipgameChoice; answer: QuipgameAnswerResultView; total: number; won: boolean }) {
  const player = playerOf(room, answer.authorId);
  const share = total > 0 ? Math.round((answer.votes / total) * 100) : 0;
  return (
    <li
      className={`quip-result__answer${won ? ' quip-result__answer--won' : ''}`}
      data-testid="result-answer"
      data-choice={side}
      data-author-id={answer.authorId}
      data-author-name={answer.authorName}
      data-votes={answer.votes}
      data-points={answer.points}
      data-flawless={answer.flawless}
      data-fallback={answer.fallback}
    >
      <div className="quip-result__head">
        <span className="quip-answer__label" aria-hidden="true">
          {side.toUpperCase()}
        </span>
        <span className="quip-result__text" data-testid="result-text">
          {answer.text}
        </span>
      </div>
      <div className="quip-result__who">
        {player && <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />}
        <span className="quip-result__name">
          {answer.authorName}
          {answer.fallback && <span className="quip-result__tag">ran out of time</span>}
        </span>
        {answer.flawless && (
          <span className="quip-result__flawless" style={{ background: meta.accent }} data-testid="result-flawless">
            Flawless!
          </span>
        )}
        <span className={`quip-result__points${answer.points > 0 ? ' quip-result__points--scored' : ''}`} data-testid="result-points">
          {formatPoints(answer.points)}
        </span>
      </div>
      <div className="quip-result__bar" role="img" aria-label={`${answer.votes} of ${total} votes`}>
        <span className="quip-result__fill" style={{ width: `${share}%` }} />
        <span className="quip-result__votes" data-testid="result-votes">
          {answer.votes} {answer.votes === 1 ? 'vote' : 'votes'}
        </span>
      </div>
    </li>
  );
}

/** A resolved matchup: both answers with their authors, the vote bars, the points and the flawless badge. */
export function Result({ room, view, result, isHost, playing }: Props) {
  const total = result.a.votes + result.b.votes;
  const last = result.index + 1 >= result.total;
  const label = !last ? 'Next' : view.round >= view.totalRounds ? 'Show results' : view.round + 1 >= view.totalRounds ? 'Final round' : 'Next round';
  return (
    <section className="card quip-result" aria-label="Result" data-testid="quip-result" data-matchup={result.index} data-outcome={result.outcome}>
      <p className="overlay__kicker">
        Matchup {result.index + 1} of {result.total}
      </p>
      <h2 className="quip-result__headline" data-testid="result-headline">
        {headline(result)}
      </h2>
      <div className="quip-prompt quip-prompt--sm" data-testid="result-prompt">
        {result.prompt}
      </div>
      <ol className="quip-result__list">
        <AnswerRow room={room} side="a" answer={result.a} total={total} won={result.outcome === 'a'} />
        <AnswerRow room={room} side="b" answer={result.b} total={total} won={result.outcome === 'b'} />
      </ol>
      <ResultFooter view={view} isHost={isHost} label={label} playing={playing} />
    </section>
  );
}
