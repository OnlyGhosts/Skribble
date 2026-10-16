import { useEffect, useRef } from 'react';
import { gameById } from '@shared/platform/games';
import type { GameResults, ResultEntry } from '@shared/platform/protocol';
import { pointsShort } from '../lib/format';
import { PHONE_QUERY, useMediaQuery } from '../lib/media';
import { PLATFORM_SOUNDS } from '../lib/platformSounds';
import { crowned, endReasonLine, rankedEntries, resultsHeadline, resultsPlace, topEntries } from '../lib/results';
import { useModalFocus } from '../lib/useModalFocus';
import { Avatar } from './Avatar';
import { Confetti } from './Confetti';
import { CloseIcon } from './Icons';
import { PhoneHappy } from './Mascots';

/** The winner's points under the headline: "1,100 points", or "30 points each" for a tie. */
function pointsLine(score: number, tie: boolean): string {
  return `${score.toLocaleString('en-US')} ${score === 1 ? 'point' : 'points'}${tie ? ' each' : ''}`;
}

interface Props {
  results: GameResults;
  meId: string | null;
  onClose(): void;
}

/**
 * The end of a game, however it ended, as a popup over the lobby: the winner, the places and the
 * points with a small celebration. Closing it (the button, the X, Escape, or a tap outside on a
 * desktop) leaves the player in the lobby, ready for the next game. A modal dialog: the card takes
 * the focus and Tab stays inside until it goes.
 */
export function ResultsPopup({ results, meId, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  useModalFocus(cardRef, true, onClose);

  const ordered = rankedEntries(results);
  const top = ordered.slice(0, 3);
  // Visual order puts the winner in the middle, like a real podium.
  const visual = [top[1], top[0], top[2]].filter((e): e is ResultEntry => e !== undefined);
  const celebrate = crowned(results);
  const champions = celebrate ? topEntries(results) : [];
  const iWon = meId !== null && champions.some((e) => e.playerId === meId);
  const place = resultsPlace(results, meId);
  const reason = endReasonLine(results);

  // Once per popup: the cue belongs to the moment it appears.
  const wonAtMount = useRef(iWon);
  useEffect(() => {
    PLATFORM_SOUNDS.play(wonAtMount.current ? 'fanfare' : 'gameOver');
  }, []);

  return (
    <div className="results-popup" role="dialog" aria-modal="true" aria-label="Final scores" data-testid="overlay-game-end" data-winner={iWon} data-reason={results.reason}>
      {/* A phone closes it with the button only: a stray tap beside the card must not skip the scores. */}
      <button type="button" className="results-popup__backdrop" aria-label="Close" tabIndex={-1} onClick={isPhone ? undefined : onClose} data-testid="results-backdrop" />
      {celebrate && <Confetti />}
      <div className="overlay__card overlay__card--wide results-card" ref={cardRef} tabIndex={-1} data-testid="results-card">
        <div className="results-card__scroll">
          <div className={`results-hero${iWon ? ' results-hero--won' : ''}`}>
            <PhoneHappy className="results-hero__mascot" />
            <p className="overlay__kicker results-hero__kicker">{`${gameById(results.gameId).name} · Game over`}</p>
            <h2 className="overlay__title results-hero__title" data-testid="results-headline">
              {resultsHeadline(results)}
            </h2>
            {champions.length > 0 && (
              <p className="results-hero__points" data-testid="results-points">
                {pointsLine(champions[0].score, champions.length > 1)}
              </p>
            )}
            <p className={`results-place${iWon ? ' results-place--won' : ''}`} data-testid="results-place">
              {place ?? 'You watched this one'}
            </p>
            {reason && (
              <p className="results-reason" data-testid="results-reason">
                {reason}
              </p>
            )}
          </div>

          {visual.length > 1 && (
            <ol className="podium" aria-label="Top three">
              {visual.map((entry) => (
                <li key={entry.playerId} className={`podium__step podium__step--${entry.rank}`} data-rank={entry.rank} data-testid="results-step">
                  <Avatar avatar={entry.avatar} size="md" />
                  <span className="podium__name">{entry.name}</span>
                  <span className="podium__block" aria-hidden="true">
                    {entry.rank}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <ol className="results-standings" aria-label="Final standings">
            {ordered.map((entry) => (
              <li
                key={entry.playerId}
                className={`results-standings__row${entry.playerId === meId ? ' results-standings__row--me' : ''}`}
                data-testid="results-entry"
                data-rank={entry.rank}
                data-name={entry.name}
                data-score={entry.score}
              >
                <span className="results-standings__rank">{entry.rank}</span>
                <Avatar avatar={entry.avatar} size="sm" />
                <span className="results-standings__name">
                  <span className="results-standings__text">{entry.name}</span>
                  {entry.playerId === meId && <span className="results-standings__you">You</span>}
                </span>
                <span className="results-standings__score">{pointsShort(entry.score)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="results-card__actions">
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onClose} data-testid="results-done">
            Back to the room
          </button>
        </div>

        <button type="button" className="icon-btn results-card__close" onClick={onClose} aria-label="Close" data-testid="results-close">
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  );
}
