import { useEffect, useRef, useState, type FormEvent } from 'react';
import { randomAvatar, type Avatar as AvatarData } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH } from '@shared/platform/constants';
import { GAME_LIST, gameById, type GameMeta } from '@shared/platform/games';
import { ROOM_CODE_LENGTH, isValidRoomCode, roomCodeHint } from '@shared/platform/roomCode';
import { SITE_NAME } from '@shared/platform/site';
import { AvatarPicker } from '../components/AvatarPicker';
import { CodeInput, type CodeInputHandle } from '../components/CodeInput';
import { AlertIcon, LinkIcon } from '../components/Icons';
import { SiteHeader } from '../components/SiteHeader';
import { enteredLength, padCode } from '../lib/codeInput';
import type { JoinErrorCode } from '../lib/format';
import { loadAvatar, loadName, saveAvatar, saveName } from '../lib/storage';
import { useRoomPreview, type RoomPreview } from '../lib/useRoomPreview';
import { createRoom, joinRoom } from '../net/actions';
import { usePlatformStore } from '../store/usePlatformStore';

type Intent = 'create' | 'join';

/** A rejoin still not answered after this long (server unreachable) gives the form back. */
export const REJOIN_FORM_DELAY_MS = 15_000;

/**
 * What the front door shows: the rejoining spinner while a resumable seat is being tried, the
 * form with a note once that has dragged on past REJOIN_FORM_DELAY_MS (the spinner goes: one or
 * the other, never both), or the plain form.
 */
export function homeView(rejoining: boolean, rejoinStale: boolean): 'rejoining' | 'stale' | 'form' {
  if (!rejoining) return 'form';
  return rejoinStale ? 'stale' : 'rejoining';
}

/**
 * The game a new party starts on: the first live game of the registry, or the one '?game=' asked
 * for (hidden games included, for development and tests). The host picks another in the lobby.
 */
export function initialGame(preferred: GameMeta | null = null): GameMeta {
  return preferred ?? GAME_LIST.find((g) => g.status === 'live') ?? GAME_LIST[0];
}

/** The box to focus after a failed submit: the first empty one, or the first box when the code is complete but wrong. */
export function firstInvalidBox(code: string): number {
  const empty = padCode(code).findIndex((ch) => !ch);
  return empty < 0 ? 0 : empty;
}

/**
 * Where the focus goes once the server has refused a join: the first invalid box when the code
 * itself was the problem, otherwise (full, in progress, offline, timed out) the Join button, so
 * one Enter retries and a keyboard or screen-reader user never lands on <body> when the name
 * step that had the focus unmounts.
 */
export function focusAfterRefusal(error: JoinErrorCode, code: string): number | 'join' {
  return error === 'INVALID_CODE' || error === 'ROOM_NOT_FOUND' ? firstInvalidBox(code) : 'join';
}

/** A name as it goes on the wire: collapsed whitespace, trimmed; empty means "ask". */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

interface Props {
  /** A code from the address bar (invite link, legacy bare code): filled in, with the focus on Join. */
  code: string | null;
  /** The game Create starts the party on when the address bar names one ('?game=slug'). */
  game: GameMeta | null;
}

/**
 * The front door: one column and two paths, nothing else (no tagline, no footer). Join a room
 * with the four boxes, or create one.
 * Both need a name and an avatar for the real create/join handlers; a saved name skips the
 * "Who's playing?" step, a first visit sees it after the tap. Create starts the party on the
 * first live game; the host picks the game in the lobby.
 */
export function Home({ code: linkedCode, game: linkedGame }: Props) {
  const connection = usePlatformStore((s) => s.connection);
  const joinPending = usePlatformStore((s) => s.joinPending);
  const joinError = usePlatformStore((s) => s.joinError);
  const rejoining = usePlatformStore((s) => s.rejoining);
  const clearJoinError = usePlatformStore((s) => s.clearJoinError);

  const [name, setName] = useState(loadName);
  const [avatar, setAvatar] = useState<AvatarData>(() => loadAvatar() ?? randomAvatar());
  const [code, setCode] = useState(linkedCode ?? '');
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [step, setStep] = useState<'home' | 'name'>('home');
  const codeRef = useRef<CodeInputHandle | null>(null);
  const joinRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const preview = useRoomPreview(code);
  // The code as it was when a server error lands (later edits must not refocus the boxes).
  const latestCode = useRef(code);
  latestCode.current = code;

  // A seat we can resume is tried first; the form only shows when that fails (or drags on).
  const [rejoinStale, setRejoinStale] = useState(false);
  useEffect(() => {
    setRejoinStale(false);
    if (!rejoining) return;
    const timer = window.setTimeout(() => setRejoinStale(true), REJOIN_FORM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [rejoining]);
  const view = homeView(rejoining, rejoinStale);

  useEffect(() => {
    document.title = SITE_NAME;
  }, []);

  // An invite link fills the boxes; one tap (or Enter) joins.
  useEffect(() => {
    if (!linkedCode) return;
    setCode(linkedCode);
    setCodeHint(null);
    setStep('home');
  }, [linkedCode]);
  useEffect(() => {
    if (linkedCode && view !== 'rejoining') joinRef.current?.focus();
  }, [linkedCode, view]);

  // A join refused by the server: back to the boxes, code kept, focus on the first invalid one
  // or on Join room (once they are mounted again, when the refusal came during the name step).
  // A refused create stays on the name step, where the error shows under the button.
  const pendingFocus = useRef<number | 'join' | null>(null);
  useEffect(() => {
    if (!joinError || intent !== 'join') return;
    pendingFocus.current = focusAfterRefusal(joinError.code, latestCode.current);
    setStep('home');
  }, [joinError, intent]);
  useEffect(() => {
    if (step !== 'home' || pendingFocus.current === null || !codeRef.current) return;
    if (pendingFocus.current === 'join') joinRef.current?.focus();
    else codeRef.current.focus(pendingFocus.current);
    pendingFocus.current = null;
  }, [step, joinError]);

  useEffect(() => {
    if (step === 'name') nameRef.current?.focus();
  }, [step]);

  const submit = (which: Intent, clean: string) => {
    saveName(clean);
    saveAvatar(avatar);
    setIntent(which);
    if (which === 'create') createRoom(initialGame(linkedGame).id, clean, avatar);
    else joinRoom(code, clean, avatar);
  };

  /** Join: the code must be complete and well-formed before anything is sent; then the name, then the request. */
  const onJoin = () => {
    if (joinPending) return;
    if (!isValidRoomCode(code)) {
      setCodeHint(enteredLength(code) < ROOM_CODE_LENGTH ? `Enter all ${ROOM_CODE_LENGTH} characters of the code.` : roomCodeHint());
      codeRef.current?.focus(firstInvalidBox(code));
      return;
    }
    setCodeHint(null);
    if (joinError) clearJoinError();
    const clean = cleanName(name);
    if (!clean) {
      setIntent('join');
      setStep('name');
      return;
    }
    submit('join', clean);
  };

  const onCreate = () => {
    if (joinPending) return;
    if (joinError) clearJoinError();
    const clean = cleanName(name);
    if (!clean) {
      setIntent('create');
      setStep('name');
      return;
    }
    submit('create', clean);
  };

  const onNameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName(name);
    if (!clean) {
      setNameError('Pick a name so your friends know who you are.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    submit(intent ?? 'create', clean);
  };

  const onCodeChange = (next: string) => {
    setCode(next);
    setCodeHint(null);
    if (joinError) clearJoinError();
  };

  const waitingForConnection = joinPending && connection !== 'connected';
  const pendingLabel = (verb: string) => (waitingForConnection ? 'Waiting for connection…' : verb);
  const errorFor = (which: Intent) => (joinError && (intent ?? 'join') === which ? joinError.message : null);
  const joinErrorText = codeHint ?? errorFor('join');
  const busy = (which: Intent) => joinPending && intent === which;

  return (
    <div className="home">
      <SiteHeader hero />

      <main className="home__main">
        <h1 className="sr-only">{SITE_NAME}</h1>

        {view === 'rejoining' && (
          <div className="banner banner--info home__banner" role="status" data-testid="rejoining-banner">
            <span className="spinner" aria-hidden="true" /> Rejoining your room<span className="ellipsis" aria-hidden="true" />
          </div>
        )}
        {view === 'stale' && (
          <div className="banner banner--info home__banner" role="status" data-testid="rejoin-stale-banner">
            <LinkIcon size={16} /> Your old seat is not answering. You can join {linkedCode ? <strong>{linkedCode}</strong> : 'the room'} again below.
          </div>
        )}

        {view !== 'rejoining' && step === 'home' && (
          <div className="home__start">
            <section className="home__join" aria-labelledby="join-heading" data-testid="join-panel">
              <h2 className="home__title" id="join-heading">
                Join a room
              </h2>
              <form
                className="home__form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  onJoin();
                }}
              >
                <div className="field code-field">
                  <CodeInput
                    ref={codeRef}
                    value={code}
                    onChange={onCodeChange}
                    onSubmit={onJoin}
                    onInvalidChar={() => setCodeHint(roomCodeHint())}
                    disabled={joinPending}
                    invalid={Boolean(joinErrorText)}
                    describedBy="code-status"
                  />
                  <div className="code-preview" id="code-status" aria-live="polite" data-testid="room-preview">
                    {joinErrorText ? (
                      <span className="field__error" data-testid={codeHint ? 'code-hint' : 'join-error'}>
                        <AlertIcon size={16} />
                        {joinErrorText}
                      </span>
                    ) : preview.status === 'ok' && preview.preview.exists ? (
                      <PreviewText preview={preview.preview} />
                    ) : null}
                  </div>
                </div>
                <button ref={joinRef} type="submit" className="btn btn--primary btn--block home__btn" data-testid="home-join" disabled={joinPending} aria-busy={busy('join')}>
                  {busy('join') ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> {pendingLabel('Joining…')}
                    </>
                  ) : (
                    'Join'
                  )}
                </button>
              </form>
            </section>

            <div className="home__create" data-testid="create-panel">
              <button type="button" className="btn btn--secondary btn--block home__btn" data-testid="home-create" onClick={onCreate} disabled={joinPending} aria-busy={busy('create')}>
                {busy('create') ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> {pendingLabel('Creating…')}
                  </>
                ) : (
                  'Create a room'
                )}
              </button>
              {errorFor('create') && (
                <p className="field__error" role="alert" data-testid="create-error">
                  <AlertIcon size={16} />
                  {errorFor('create')}
                </p>
              )}
            </div>
          </div>
        )}

        {view !== 'rejoining' && step === 'name' && (
          <section className="card panel panel--who" aria-labelledby="who-heading" data-testid="name-step">
            <div className="panel__head">
              <h2 className="panel__title" id="who-heading">
                Who's playing?
              </h2>
              <p className="panel__text">
                {intent === 'join' ? (
                  <>
                    Joining room <strong className="panel__code">{code}</strong>
                  </>
                ) : (
                  "You'll host the room."
                )}
              </p>
            </div>
            <form className="panel__form" noValidate onSubmit={onNameSubmit}>
              <div className="field">
                <label className="field__label" htmlFor="home-name">
                  Name
                </label>
                <input
                  id="home-name"
                  ref={nameRef}
                  className={`input${nameError ? ' is-invalid' : ''}`}
                  data-testid="home-name"
                  type="text"
                  value={name}
                  maxLength={NAME_MAX_LENGTH}
                  placeholder="What should we call you?"
                  autoComplete="nickname"
                  autoCorrect="off"
                  enterKeyHint="go"
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'home-name-error' : 'home-name-hint'}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                />
                {nameError ? (
                  <p className="field__error" id="home-name-error" role="alert">
                    <AlertIcon size={16} />
                    {nameError}
                  </p>
                ) : (
                  <p className="field__hint" id="home-name-hint">
                    Up to {NAME_MAX_LENGTH} characters. Saved on this device.
                  </p>
                )}
              </div>
              <AvatarPicker value={avatar} onChange={setAvatar} />
              <div className="panel__actions">
                <button type="submit" className="btn btn--primary panel__action" data-testid="home-continue" disabled={joinPending} aria-busy={joinPending}>
                  {joinPending ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> {pendingLabel(intent === 'join' ? 'Joining…' : 'Creating…')}
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
                <button type="button" className="btn btn--secondary" data-testid="home-back" onClick={() => setStep('home')} disabled={joinPending}>
                  Back
                </button>
              </div>
              {errorFor('create') && (
                <p className="field__error" role="alert" data-testid="create-error">
                  <AlertIcon size={16} />
                  {errorFor('create')}
                </p>
              )}
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

/** A quiet line about the room the code names: who is there and what they are playing. */
function PreviewText({ preview }: { preview: RoomPreview }) {
  if (!preview.exists) return null;
  const players = `${preview.players} ${preview.players === 1 ? 'player' : 'players'} in the party`;
  if (!preview.joinable) {
    return <span className="field__error">{preview.inProgress ? `Game in progress, joining is closed. (${players})` : `Room is full. (${players})`}</span>;
  }
  return (
    <span className="field__ok">
      {players} · {gameById(preview.gameId).name}
      {preview.inProgress ? ' in progress, you can still join' : ''}
    </span>
  );
}
