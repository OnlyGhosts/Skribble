import type { QuipgameChoice, QuipgameMatchupView, QuipgameRoomState, QuipgameView } from '@shared/games/quipgame/protocol';
import { castVote } from '../actions';
import { voterCount } from '../hooks';
import { votedLine } from '../lib/text';
import { useQuipgame, useQuipgameStore } from '../store';
import { CheckIcon } from '../../../platform/components/Icons';
import { WATCHING_TEXT } from '../../../platform/lib/watching';
import { MegaphoneIcon } from './Icons';

interface Props {
  room: QuipgameRoomState;
  view: QuipgameView;
  matchup: QuipgameMatchupView;
  /** A spectator of the whole game: no vote, one line saying so. */
  watching?: boolean;
}

/** The announcer's "read this out" card: the prompt and both answers in large text, above the normal controls. */
export function Announcer({ matchup }: { matchup: QuipgameMatchupView }) {
  return (
    <section className="card quip-announce" aria-label="Read this out" data-testid="quip-announcer">
      <p className="quip-announce__kicker">
        <MegaphoneIcon size={16} /> You’re the announcer: read this out
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

/**
 * A matchup: the prompt, answers A and B as two equal cards, then Vote. A tap selects (with a
 * check), Vote sends it; a sent vote can still be changed until the matchup closes. Authors sit tight.
 */
export function Voting({ room, view, matchup, watching = false }: Props) {
  const selected = useQuipgame((s) => s.selectedChoice);
  // The pick shows at once; the local one is cleared when the step changes, so the server's echo takes over from there.
  const choice: QuipgameChoice | null = selected ?? view.myVote;
  const voters = voterCount(room, matchup.votes);
  const canTap = view.canVote && room.phase === 'playing';
  const sent = choice !== null && choice === view.myVote;

  const pick = (c: QuipgameChoice) => {
    if (canTap) useQuipgameStore.getState().selectChoice(c);
  };
  const vote = () => {
    if (canTap && choice && !sent) castVote(choice);
  };

  const answer = (c: QuipgameChoice, text: string) => {
    const isSelected = choice === c;
    const content = (
      <>
        <span className="quip-answer__label" aria-hidden="true">
          {c.toUpperCase()}
        </span>
        <span className="quip-answer__text">{text}</span>
        {isSelected && (
          <span className="quip-answer__check" aria-hidden="true">
            <CheckIcon size={18} />
          </span>
        )}
      </>
    );
    if (view.isAuthor) {
      return (
        <div className="quip-answer quip-answer--static" role="group" aria-label={`${c.toUpperCase()}: ${text}`} data-testid="vote-answer" data-choice={c}>
          {content}
        </div>
      );
    }
    return (
      <button type="button" className={`quip-answer${isSelected ? ' quip-answer--selected' : ''}`} onClick={() => pick(c)} disabled={!canTap} aria-pressed={isSelected} aria-label={`${c.toUpperCase()}: ${text}`} data-testid="vote-answer" data-choice={c} data-selected={isSelected}>
        {content}
      </button>
    );
  };

  return (
    <>
      {view.isAnnouncer && <Announcer matchup={matchup} />}
      <section className="card quip-vote" aria-label="Vote" data-testid="quip-voting" data-matchup={matchup.index} data-author={view.isAuthor} data-can-vote={view.canVote}>
        <p className="quip-kicker" data-testid="vote-progress">
          Matchup {matchup.index + 1} of {matchup.total}
        </p>
        <div className="quip-prompt" data-testid="vote-prompt">
          {matchup.prompt}
        </div>
        <div className="quip-vote__answers" role={view.isAuthor ? undefined : 'group'} aria-label={view.isAuthor ? undefined : 'Pick the funnier answer'}>
          {answer('a', matchup.a)}
          {answer('b', matchup.b)}
        </div>
        {view.isAuthor ? (
          <div className="quip-vote__author" role="status" data-testid="vote-author">
            <strong>This one’s yours, sit tight</strong>
            <span>The room is deciding…</span>
          </div>
        ) : view.canVote ? (
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={vote} disabled={!canTap || choice === null || sent} data-testid="vote-submit" data-sent={sent}>
            {sent ? (
              <>
                <CheckIcon size={18} /> Voted
              </>
            ) : view.myVote ? (
              'Change vote'
            ) : (
              'Vote'
            )}
          </button>
        ) : (
          <p className="quip-vote__note" role="status" data-testid="vote-watching">
            {room.phase !== 'playing' ? 'The game is over.' : watching ? WATCHING_TEXT : 'Reconnect to vote on this one.'}
          </p>
        )}
        <p className="quip-write__status" role="status" data-testid="vote-count" data-votes={matchup.votes} data-voters={voters}>
          {votedLine(matchup.votes, voters)}
        </p>
      </section>
    </>
  );
}
