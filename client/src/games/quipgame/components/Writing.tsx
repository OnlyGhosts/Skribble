import { useEffect, useId, useRef, type FormEvent } from 'react';
import { QUIPGAME_ANSWER_MAX_LENGTH, cleanText, type QuipgameView } from '@shared/games/quipgame/protocol';
import { EditIcon } from '../../../platform/components/Icons';
import { submitAnswer } from '../actions';
import { promptNumber, promptToWrite } from '../hooks';
import { doneLine, waitingLine } from '../lib/text';
import { useQuipgame, useQuipgameStore } from '../store';

interface Props {
  view: QuipgameView;
  /** False once the phase is over (the podium is up): nothing can be sent any more. */
  open: boolean;
}

/** One prompt at a time: the big prompt card, a native single-line input and Submit; then the waiting card with Edit. */
export function Writing({ view, open }: Props) {
  const editingPromptId = useQuipgame((s) => s.editingPromptId);
  const drafts = useQuipgame((s) => s.drafts);
  const prompt = promptToWrite(view, editingPromptId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const limitId = useId();
  const promptId = prompt?.id ?? null;

  // A prompt re-opened for editing starts from the answer the server holds.
  useEffect(() => {
    if (!promptId || drafts[promptId] !== undefined) return;
    const sent = view.myAnswers[promptId];
    if (sent !== undefined) useQuipgameStore.getState().setDraft(promptId, sent);
  }, [promptId, drafts, view.myAnswers]);

  // The next prompt slides in with the field already focused, so the phone keyboard stays up between answers.
  useEffect(() => {
    if (promptId && document.activeElement !== inputRef.current && document.activeElement?.tagName === 'INPUT') inputRef.current?.focus();
  }, [promptId]);

  const status = (
    <p className="quip-write__status" role="status" data-testid="write-done" data-done={view.done} data-total={view.total}>
      {doneLine(view.done, view.total)}
    </p>
  );

  if (!prompt) {
    return (
      <section className="card quip-write quip-write--waiting" aria-label="Waiting" data-testid="quip-waiting">
        <p className="overlay__kicker">All sent</p>
        <h2 className="quip-write__title">{waitingLine(view.done, view.total)}</h2>
        <ul className="quip-write__sent" aria-label="Your answers">
          {view.myPrompts.map((p) => (
            <li key={p.id} className="quip-write__sent-row" data-testid="write-sent" data-prompt-id={p.id}>
              <span className="quip-write__sent-body">
                <span className="quip-write__sent-prompt">{p.text}</span>
                <strong className="quip-write__sent-answer">{view.myAnswers[p.id] ?? ''}</strong>
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => useQuipgameStore.getState().editPrompt(p.id)} disabled={!open} aria-label={`Edit your answer to: ${p.text}`} data-testid="write-edit">
                <EditIcon size={16} /> Edit
              </button>
            </li>
          ))}
        </ul>
        {status}
      </section>
    );
  }

  const draft = drafts[prompt.id] ?? '';
  const clean = cleanText(draft);
  const valid = clean.length > 0 && clean.length <= QUIPGAME_ANSWER_MAX_LENGTH;
  const number = promptNumber(view, prompt);
  const editing = view.myAnswers[prompt.id] !== undefined;
  const atLimit = clean.length >= QUIPGAME_ANSWER_MAX_LENGTH;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !open) return;
    if (!submitAnswer(prompt.id, clean)) return;
    const store = useQuipgameStore.getState();
    store.clearDraft(prompt.id);
    store.editPrompt(null);
  };

  return (
    <section className="card quip-write" aria-label="Write your answer" data-testid="quip-writing" data-prompt-id={prompt.id}>
      <p className="overlay__kicker" data-testid="write-progress" data-number={number} data-total={view.myPrompts.length}>
        {editing ? 'Editing answer' : 'Answer'} {number} of {view.myPrompts.length}
      </p>
      <div key={prompt.id} className="quip-prompt quip-prompt--slide" data-testid="write-prompt" data-prompt-id={prompt.id}>
        {prompt.text}
      </div>
      <form className="quip-write__form" onSubmit={submit}>
        <input
          ref={inputRef}
          className="input input--lg quip-write__input"
          type="text"
          value={draft}
          onChange={(e) => useQuipgameStore.getState().setDraft(prompt.id, e.target.value)}
          placeholder="Your funniest answer…"
          maxLength={QUIPGAME_ANSWER_MAX_LENGTH}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck
          aria-label={`Your answer to: ${prompt.text}`}
          aria-describedby={limitId}
          // Edit comes from the waiting card, where the form mounts fresh: focus it so the keyboard opens without a second tap.
          autoFocus={editing}
          disabled={!open}
          data-testid="write-input"
        />
        {/* The visible counter changes on every keystroke; a screen reader hears the limit instead, and once when it is reached. */}
        <span id={limitId} className="sr-only" aria-live="polite" data-testid="write-limit">
          {atLimit ? `Answer is at the ${QUIPGAME_ANSWER_MAX_LENGTH} character limit` : `Up to ${QUIPGAME_ANSWER_MAX_LENGTH} characters`}
        </span>
        <div className="quip-write__foot">
          <span className={`quip-write__counter${atLimit ? ' quip-write__counter--full' : ''}`} aria-hidden="true" data-testid="write-counter">
            {clean.length}/{QUIPGAME_ANSWER_MAX_LENGTH}
          </span>
          {editing && (
            <button type="button" className="btn btn--ghost" onClick={() => useQuipgameStore.getState().cancelEdit()} data-testid="write-cancel">
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn--primary btn--lg quip-write__submit" disabled={!valid || !open} data-testid="write-submit">
            {editing ? 'Update' : 'Submit'}
          </button>
        </div>
      </form>
      {status}
    </section>
  );
}

/** Late joiners watch the writing and vote once the answers are in. */
export function Spectating({ view }: { view: QuipgameView }) {
  return (
    <section className="card quip-write quip-write--waiting" aria-label="Watching" data-testid="quip-spectating">
      <p className="overlay__kicker">Watching this round</p>
      <h2 className="quip-write__title">The others are writing</h2>
      <p className="quip-write__text">You vote on their answers in a moment, and you write from the next round.</p>
      <p className="quip-write__status" role="status" data-testid="write-done" data-done={view.done} data-total={view.total}>
        {doneLine(view.done, view.total)}
      </p>
    </section>
  );
}
