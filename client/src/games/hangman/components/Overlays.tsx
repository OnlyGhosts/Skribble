import { useState, type FormEvent } from 'react';
import { HANGMAN_WORD_LETTERS, HANGMAN_WORD_MAX_CHARS, type HangmanRoomState, type HangmanView } from '@shared/games/hangman/protocol';
import { isValidHangmanWord, normalizeHangmanWord } from '@shared/games/hangman/words';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { formatPoints } from '../../../platform/lib/format';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { chooseWord, sendCustomWord } from '../actions';
import { nameOf, playerOf } from '../hooks';
import { outcomeText } from '../lib/text';
import { useHangman, useHangmanStore } from '../store';

interface Props {
  room: HangmanRoomState;
  view: HangmanView;
  /** The platform holds for missing players (or the server paused the hangman's clock): nothing counts down. */
  paused: boolean;
}

/** The hangman picks one of three words or types their own; everyone else waits. */
export function ChoosingOverlay({ room, view, paused, isHangman }: Props & { isHangman: boolean }) {
  const hangman = playerOf(room, view.hangmanId);
  const draft = useHangman((s) => s.customDraft);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  // The rule is checked here first so the field can say what is wrong; the server checks it again.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidHangmanWord(normalizeHangmanWord(draft))) return setInvalid(true);
    if (sendCustomWord(draft)) setSent(true);
  };
  return (
    <div className="hm-overlay hm-overlay--choosing" data-testid="overlay-choosing">
      <div className="overlay__card">
        {isHangman ? (
          <>
            <p className="overlay__kicker">Your turn as the hangman</p>
            <h2 className="overlay__title">Pick a word</h2>
            <Timer endsAt={view.endsAt} size="md" warnUnder={5} paused={paused} />
            <div className="hm-choices">
              {(view.choices ?? []).map((word, i) => (
                <button key={`${i}-${word}`} type="button" className="btn btn--choice" onClick={() => chooseWord(i)} data-testid="word-choice">
                  {word}
                </button>
              ))}
            </div>
            <form className="hm-custom" onSubmit={submit} data-testid="custom-word-form">
              <input
                className={`input hm-custom__input${invalid ? ' is-invalid' : ''}`}
                type="text"
                value={draft}
                maxLength={HANGMAN_WORD_MAX_CHARS}
                placeholder="…or type your own word or phrase"
                aria-label="Your own word or phrase"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setSent(false);
                  setInvalid(false);
                  useHangmanStore.getState().setCustomDraft(e.target.value);
                }}
                data-testid="custom-word-input"
              />
              <button type="submit" className="btn btn--primary hm-custom__send" disabled={!connected || sent || draft.trim().length === 0} data-testid="custom-word-send">
                Use it
              </button>
            </form>
            {invalid ? (
              <p className="field__error" role="alert" data-testid="custom-word-error">
                A word or phrase has {HANGMAN_WORD_LETTERS.min} to {HANGMAN_WORD_LETTERS.max} letters: letters, spaces, hyphens and apostrophes only.
              </p>
            ) : (
              <p className="overlay__hint">
                {HANGMAN_WORD_LETTERS.min} to {HANGMAN_WORD_LETTERS.max} letters. The first choice is picked for you when the timer runs out.
              </p>
            )}
          </>
        ) : (
          <>
            {hangman && <Avatar avatar={hangman.avatar} size="xl" />}
            <h2 className="overlay__title">
              {hangman?.name ?? 'Someone'} is choosing a word
              <span className="ellipsis" aria-hidden="true" />
            </h2>
            <Timer endsAt={view.endsAt} size="md" warnUnder={5} paused={paused} />
          </>
        )}
      </div>
    </div>
  );
}

/** The word, how the turn ended and who scored; counts down to the next hangman. */
export function TurnEndOverlay({ room, view, paused }: Props) {
  const seconds = useCountdownSeconds(paused ? null : view.endsAt);
  const settling = !paused && seconds <= 0;
  const solverId = view.outcome?.kind === 'solved' ? view.outcome.solverId : null;
  const earners = room.players
    .map((p) => ({ player: p, points: view.points[p.id] ?? 0 }))
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.player.joinOrder - b.player.joinOrder);
  return (
    <div className="hm-overlay hm-overlay--turn-end" data-testid="overlay-turn-end" data-outcome={view.outcome?.kind}>
      <div className="overlay__card">
        <p className="overlay__kicker">{outcomeText(view.outcome, nameOf(room, view.hangmanId), nameOf(room, solverId))}</p>
        <h2 className="overlay__title">
          {view.word ? (
            <>
              The word was{' '}
              <span className="hm-overlay__word" data-testid="turn-end-word">
                {view.word}
              </span>
            </>
          ) : (
            'No word was chosen'
          )}
        </h2>
        {earners.length > 0 ? (
          <ul className="hm-points" aria-label="Points earned this turn">
            {earners.map(({ player, points }) => (
              <li key={player.id} className="hm-points__row" data-testid="turn-end-points" data-name={player.name} data-points={points}>
                <Avatar avatar={player.avatar} size="sm" />
                <span className="hm-points__name">
                  {player.name}
                  {player.id === view.hangmanId && <span className="hm-points__tag">hangman</span>}
                </span>
                <span className="hm-points__pts">{formatPoints(points)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overlay__hint">Nobody scored this turn.</p>
        )}
        <div className="overlay__footer">
          <span data-testid="turn-end-countdown" data-countdown={paused ? 'paused' : settling ? 'settling' : 'running'}>
            {paused ? 'Next turn is paused' : settling ? 'Next turn is starting' : 'Next turn in'}
          </span>
          <Timer endsAt={view.endsAt} size="md" warnUnder={0} paused={paused} settling={settling} />
        </div>
      </div>
    </div>
  );
}

/** Over the canvas for everyone but the hangman while they draw. */
export function DrawingCaption({ room, view }: { room: HangmanRoomState; view: HangmanView }) {
  const hangman = playerOf(room, view.hangmanId);
  return (
    <div className="hm-caption" data-testid="drawing-caption">
      {hangman && <Avatar avatar={hangman.avatar} size="sm" />}
      <span>{hangman?.name ?? 'Someone'} is drawing</span>
    </div>
  );
}
