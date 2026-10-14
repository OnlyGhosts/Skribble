import { useState, type FormEvent } from 'react';
import { HANGMAN_WORD_LETTERS, HANGMAN_WORD_MAX_CHARS, type HangmanRoomState, type HangmanView } from '@shared/games/hangman/protocol';
import { isValidHangmanWord, normalizeHangmanWord } from '@shared/games/hangman/words';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { ResultNext, ResultPoints, earnersOf } from '../../../platform/components/RoundResult';
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
  const rows = earnersOf(room.players, view.points).map(({ player, points }) => ({
    id: player.id,
    player,
    name: player.name,
    points,
    tag: player.id === view.hangmanId ? 'hangman' : undefined,
    data: { 'data-name': player.name, 'data-points': points },
  }));
  return (
    <div className="hm-overlay hm-overlay--turn-end" data-testid="overlay-turn-end" data-outcome={view.outcome?.kind}>
      <div className="overlay__card result-card">
        <p className="result-kicker">{outcomeText(view.outcome, nameOf(room, view.hangmanId), nameOf(room, solverId))}</p>
        {view.word ? (
          <p className="result-reveal">
            <span className="result-reveal__label">The word was</span>
            <strong className="result-reveal__value" data-testid="turn-end-word">
              {view.word}
            </strong>
          </p>
        ) : (
          <h2 className="overlay__title">No word was chosen</h2>
        )}
        <ResultPoints rows={rows} label="Points earned this turn" rowTestId="turn-end-points" empty="Nobody scored this turn." />
        <ResultNext noun="Next turn" endsAt={view.endsAt} paused={paused} settling={settling} testId="turn-end-countdown" />
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
