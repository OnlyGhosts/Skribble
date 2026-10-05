import type { QuipgameChoice, QuipgameMatchupView, QuipgameRoomState, QuipgameView } from '@shared/games/quipgame/protocol';
import { castVote } from '../actions';
import { voterCount } from '../hooks';
import { votedLine } from '../lib/text';
import { useQuipgame, useQuipgameStore } from '../store';
import { MegaphoneIcon } from './Icons';

interface Props {
  room: QuipgameRoomState;
  view: QuipgameView;
  matchup: QuipgameMatchupView;
}

/** The announcer's "read this out" card: the prompt and both answers in large text, above the normal controls. */
export function Announcer({ matchup }: { matchup: QuipgameMatchupView }) {
  return (
    <section className="card quip-announce" aria-label="Read this out" data-testid="quip-announcer">
      <p className="quip-announce__kicker">
        <MegaphoneIcon size={16} /> You're the announcer — read this out
      </p>
      <p className="quip-announce__prompt">{matchup.prompt}</p>
      <ol className="quip-announce__answers">
        <li>
          <span className="quip-announce__label">A</span> {matchup.a}
        </li>
        <li>
          <span className="quip-announce__label">B</span> {matchup.b}
        </li>
      </ol>
    </section>
  );
}

/** A matchup: the prompt, answers A and B as big tappable cards, the live count. Authors sit tight. */
export function Voting({ room, view, matchup }: Props) {
  const selected = useQuipgame((s) => s.selectedChoice);
  const choice: QuipgameChoice | null = view.myVote ?? selected;
  const voters = voterCount(room, matchup.votes);
  const canTap = view.canVote && room.phase === 'playing';

  const vote = (c: QuipgameChoice) => {
    if (!canTap) return;
    if (castVote(c)) useQuipgameStore.getState().selectChoice(c);
  };

  const answer = (c: QuipgameChoice, text: string) => {
    const isSelected = choice === c;
    const content = (
      <>
        <span className="quip-answer__label" aria-hidden="true">
          {c.toUpperCase()}
        </span>
        <span className="quip-answer__text">{text}</span>
      </>
    );
    if (view.isAuthor) {
      return (
        <div className="quip-answer quip-answer--static" data-testid="vote-answer" data-choice={c}>
          {content}
        </div>
      );
    }
    return (
      <button type="button" className={`quip-answer${isSelected ? ' quip-answer--selected' : ''}`} onClick={() => vote(c)} disabled={!canTap} aria-pressed={isSelected} aria-label={`Vote ${c.toUpperCase()}: ${text}`} data-testid="vote-answer" data-choice={c} data-selected={isSelected}>
        {content}
      </button>
    );
  };

  return (
    <>
      {view.isAnnouncer && <Announcer matchup={matchup} />}
      <section className="card quip-vote" aria-label="Vote" data-testid="quip-voting" data-matchup={matchup.index} data-author={view.isAuthor} data-can-vote={view.canVote}>
        <p className="overlay__kicker" data-testid="vote-progress">
          Matchup {matchup.index + 1} of {matchup.total}
        </p>
        <div className="quip-prompt" data-testid="vote-prompt">
          {matchup.prompt}
        </div>
        <div className="quip-vote__answers" role={view.isAuthor ? undefined : 'group'} aria-label={view.isAuthor ? undefined : 'Your vote'}>
          {answer('a', matchup.a)}
          {answer('b', matchup.b)}
        </div>
        {view.isAuthor ? (
          <div className="quip-vote__author" role="status" data-testid="vote-author">
            <strong>This one's yours, sit tight</strong>
            <span>The room is deciding…</span>
          </div>
        ) : (
          !view.canVote && (
            <p className="quip-vote__note" role="status" data-testid="vote-watching">
              {room.phase === 'playing' ? 'Reconnect to vote on this one.' : 'The game is over.'}
            </p>
          )
        )}
        <p className="quip-write__status" role="status" data-testid="vote-count" data-votes={matchup.votes} data-voters={voters}>
          {votedLine(matchup.votes, voters)}
        </p>
      </section>
    </>
  );
}
