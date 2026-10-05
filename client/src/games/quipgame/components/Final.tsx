import type { ReactNode } from 'react';
import type { QuipgameRoomState, QuipgameView } from '@shared/games/quipgame/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { formatPoints } from '../../../platform/lib/format';
import { submitRanking } from '../actions';
import { playerOf, rankerCount, sameRanking } from '../hooks';
import { medalFor, rankHint, rankedLine } from '../lib/text';
import { useQuipgame, useQuipgameStore } from '../store';
import { MegaphoneIcon } from './Icons';

interface Props {
  room: QuipgameRoomState;
  view: QuipgameView;
}

/** The final's ranking: tap an answer for the next medal, tap it again to take the medal back, then submit. */
export function FinalVoting({ room, view }: Props) {
  const picks = useQuipgame((s) => s.picks);
  const canRank = view.maxPicks > 0 && room.phase === 'playing';
  const submitted = view.myRanking.length > 0;
  const changed = !sameRanking(picks, view.myRanking);
  const rankers = rankerCount(room, view.ranked);
  const prompt = view.finalPrompt ?? '';

  return (
    <>
      {view.isAnnouncer && (
        <section className="card quip-announce" aria-label="Read these out" data-testid="quip-announcer">
          <p className="quip-announce__kicker">
            <MegaphoneIcon size={16} /> You're the announcer — read these out
          </p>
          <p className="quip-announce__prompt">{prompt}</p>
          <ol className="quip-announce__answers">
            {view.finalAnswers.map((a, i) => (
              <li key={a.id}>
                <span className="quip-announce__label">{i + 1}</span> {a.text}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="card quip-final" aria-label="Rank the answers" data-testid="quip-final-voting" data-max-picks={view.maxPicks}>
        <p className="overlay__kicker">Final round</p>
        <div className="quip-prompt" data-testid="final-prompt">
          {prompt}
        </div>
        <p className="quip-final__hint" data-testid="final-hint">
          {canRank ? rankHint(view.maxPicks) : submitted ? 'Your ranking is in.' : 'Waiting for the rankings to come in.'}
        </p>
        <ol className="quip-final__list" aria-label="Answers">
          {view.finalAnswers.map((a) => {
            const own = a.id === view.myAnswerId;
            const position = picks.indexOf(a.id);
            const medal = position >= 0 ? medalFor(position + 1) : '';
            const full = position < 0 && picks.length >= view.maxPicks;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`quip-answer quip-final__answer${position >= 0 ? ' quip-answer--selected' : ''}${own ? ' quip-final__answer--own' : ''}`}
                  onClick={() => useQuipgameStore.getState().togglePick(a.id, view.maxPicks)}
                  disabled={own || !canRank || full}
                  aria-pressed={position >= 0}
                  aria-label={own ? `Your answer: ${a.text}` : `${a.text}${medal ? `, ranked ${position + 1}` : ''}`}
                  data-testid="final-answer"
                  data-answer-id={a.id}
                  data-own={own}
                  data-medal={position >= 0 ? position + 1 : ''}
                >
                  <span className="quip-final__medal" aria-hidden="true">
                    {own ? '✍️' : medal || <span className="quip-final__slot" />}
                  </span>
                  <span className="quip-answer__text">{a.text}</span>
                  {own && <span className="quip-final__own-tag">yours</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {canRank && (
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => submitRanking(picks)} disabled={picks.length === 0 || !changed} data-testid="final-submit">
            {submitted ? 'Update ranking' : 'Submit ranking'}
          </button>
        )}
        <p className="quip-write__status" role="status" data-testid="rank-count" data-ranked={view.ranked} data-rankers={rankers}>
          {rankedLine(view.ranked, rankers)}
        </p>
      </section>
    </>
  );
}

/** The final's result: every answer ranked, with its medal, author and points. */
export function FinalResult({ room, view, footer }: Props & { footer: ReactNode }) {
  const rows = view.finalResult ?? [];
  return (
    <section className="card quip-final quip-final--result" aria-label="Final result" data-testid="quip-final-result">
      <p className="overlay__kicker">Final round</p>
      <h2 className="quip-result__headline">{rows[0] ? `${rows[0].authorName} wins the final!` : 'The final'}</h2>
      <div className="quip-prompt quip-prompt--sm" data-testid="final-prompt">
        {view.finalPrompt ?? ''}
      </div>
      <ol className="quip-final__list" aria-label="Ranked answers">
        {rows.map((r) => {
          const player = playerOf(room, r.authorId);
          return (
            <li key={r.id} className={`quip-final__row${r.rank === 1 ? ' quip-final__row--top' : ''}`} data-testid="final-row" data-rank={r.rank} data-author-id={r.authorId} data-author-name={r.authorName} data-points={r.points}>
              <span className="quip-final__medal" aria-label={`Rank ${r.rank}`}>
                {medalFor(r.rank) || `#${r.rank}`}
              </span>
              <span className="quip-final__body">
                <span className="quip-result__text">{r.text}</span>
                <span className="quip-final__who">
                  {player && <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />}
                  <span className="quip-result__name">
                    <span className="quip-result__name-text">{r.authorName}</span>
                    {r.fallback && <span className="quip-result__tag">ran out of time</span>}
                  </span>
                </span>
              </span>
              <span className={`quip-result__points${r.points > 0 ? ' quip-result__points--scored' : ''}`} data-testid="final-points">
                {formatPoints(r.points)}
              </span>
            </li>
          );
        })}
      </ol>
      {footer}
    </section>
  );
}
