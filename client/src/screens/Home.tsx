import { useEffect, useRef, useState } from 'react';
import { randomAvatar, type Avatar as AvatarData } from '@shared/avatar';
import { MIN_PLAYERS_TO_START, NAME_MAX_LENGTH } from '@shared/constants';
import { isValidRoomCode, roomCodeHint, ROOM_CODE_LENGTH } from '@shared/roomCode';
import { createRoom, joinRoom } from '../net/actions';
import { loadAvatar, loadName, saveAvatar, saveName } from '../lib/storage';
import { codeFromLocation } from '../lib/url';
import { useGameStore } from '../store/useGameStore';
import { AvatarPicker } from '../components/AvatarPicker';
import { CodeInput } from '../components/CodeInput';
import { ConnectionPill } from '../components/ConnectionPill';
import { LinkIcon, PencilIcon, SparkIcon, UsersIcon } from '../components/Icons';
import { SoundToggle, ThemeToggle } from '../components/ThemeToggle';
import { useRoomPreview } from './useRoomPreview';

type Intent = 'create' | 'join';

export function Home() {
  const connection = useGameStore((s) => s.connection);
  const joinPending = useGameStore((s) => s.joinPending);
  const joinError = useGameStore((s) => s.joinError);
  const rejoining = useGameStore((s) => s.rejoining);
  const clearJoinError = useGameStore((s) => s.clearJoinError);

  const [name, setName] = useState(loadName);
  const [avatar, setAvatar] = useState<AvatarData>(() => loadAvatar() ?? randomAvatar());
  const [code, setCode] = useState(() => codeFromLocation() ?? '');
  const [invitedCode] = useState(() => codeFromLocation());
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const preview = useRoomPreview(code);

  useEffect(() => saveName(name), [name]);
  useEffect(() => saveAvatar(avatar), [avatar]);
  useEffect(() => {
    const onPop = () => {
      const fromUrl = codeFromLocation();
      if (fromUrl) setCode(fromUrl);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (invitedCode) nameRef.current?.focus();
  }, [invitedCode]);

  const requireName = (): string | null => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) {
      setNameError('Pick a name first so friends know who you are.');
      nameRef.current?.focus();
      return null;
    }
    setNameError(null);
    return clean;
  };

  const onCreate = () => {
    const clean = requireName();
    if (!clean) return;
    setIntent('create');
    createRoom(clean, avatar);
  };

  const onJoin = () => {
    const clean = requireName();
    if (!clean) return;
    if (!isValidRoomCode(code)) {
      setCodeHint(code.length < ROOM_CODE_LENGTH ? `Enter the ${ROOM_CODE_LENGTH}-character code from your friend.` : roomCodeHint());
      return;
    }
    setCodeHint(null);
    setIntent('join');
    joinRoom(code, clean, avatar);
  };

  const onCodeChange = (next: string) => {
    setCode(next);
    setCodeHint(null);
    if (joinError) clearJoinError();
  };

  const waitingForConnection = joinPending && connection !== 'connected';
  const pendingLabel = waitingForConnection ? 'Waiting for connection…' : null;
  const errorFor = (which: Intent) => (joinError && (intent ?? 'join') === which ? joinError.message : null);

  return (
    <div className="home">
      <header className="home__bar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <PencilIcon size={20} />
          </span>
          <span className="brand__name">Skribble</span>
        </div>
        <div className="home__bar-actions">
          <ConnectionPill />
          <SoundToggle />
          <ThemeToggle />
        </div>
      </header>

      <section className="hero">
        <h1 className="hero__title">
          Draw. Guess. <span className="hero__accent">Laugh.</span>
        </h1>
        <p className="hero__tagline">
          A friendlier skribbl: private rooms, live drawing, smart hints — and a 4-character code that's actually easy to read out loud.
        </p>
        {rejoining && (
          <div className="banner banner--info" role="status" data-testid="rejoining-banner">
            <span className="spinner" aria-hidden="true" /> Rejoining your room<span className="ellipsis" aria-hidden="true" />
          </div>
        )}
        {!rejoining && invitedCode && (
          <div className="banner banner--invite" role="status" data-testid="invite-banner">
            <LinkIcon size={16} /> You've been invited to room <strong>{invitedCode}</strong>. Pick a name and jump in!
          </div>
        )}
      </section>

      <section className="card profile" aria-labelledby="profile-heading">
        <h2 className="card__title" id="profile-heading">
          Your look
        </h2>
        <div className="profile__grid">
          <div className="field">
            <label className="field__label" htmlFor="home-name">
              Name
            </label>
            <input
              id="home-name"
              ref={nameRef}
              className={`input input--lg${nameError ? ' is-invalid' : ''}`}
              data-testid="home-name"
              type="text"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              placeholder="What should we call you?"
              autoComplete="nickname"
              autoCorrect="off"
              enterKeyHint="done"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'home-name-error' : 'home-name-hint'}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
            {nameError ? (
              <p className="field__error" id="home-name-error" role="alert">
                {nameError}
              </p>
            ) : (
              <p className="field__hint" id="home-name-hint">
                Up to {NAME_MAX_LENGTH} characters. Remembered on this device.
              </p>
            )}
          </div>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
      </section>

      <div className="home__actions">
        <section className="card action-card" aria-labelledby="create-heading">
          <div className="action-card__icon action-card__icon--create" aria-hidden="true">
            <SparkIcon size={22} />
          </div>
          <h2 className="card__title" id="create-heading">
            Create a private room
          </h2>
          <p className="card__text">You become the host: tweak the rounds, draw time and custom words, then share the code.</p>
          <ul className="feature-list" aria-label="What you get">
            <li>Up to 20 players, private by default</li>
            <li>Custom word lists and letter hints</li>
            <li>Rejoin automatically after a dropped connection</li>
          </ul>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            data-testid="home-create"
            onClick={onCreate}
            disabled={joinPending}
            aria-busy={joinPending && intent === 'create'}
          >
            {joinPending && intent === 'create' ? (
              <>
                <span className="spinner spinner--light" aria-hidden="true" /> {pendingLabel ?? 'Creating…'}
              </>
            ) : (
              'Create private room'
            )}
          </button>
          {errorFor('create') && (
            <p className="field__error" role="alert" data-testid="create-error">
              {errorFor('create')}
            </p>
          )}
        </section>

        <section className="card action-card" aria-labelledby="join-heading">
          <div className="action-card__icon action-card__icon--join" aria-hidden="true">
            <UsersIcon size={22} />
          </div>
          <h2 className="card__title" id="join-heading">
            Join with a code
          </h2>
          <p className="card__text">Type the 4 characters your friend shared, or paste their invite link.</p>
          <CodeInput
            value={code}
            onChange={onCodeChange}
            onSubmit={onJoin}
            onInvalidChar={() => setCodeHint(roomCodeHint())}
            disabled={joinPending}
            invalid={Boolean(codeHint) || Boolean(errorFor('join'))}
          />
          <div className="code-preview" aria-live="polite" data-testid="room-preview">
            {codeHint ? (
              <span className="field__error" data-testid="code-hint">
                {codeHint}
              </span>
            ) : preview.status === 'ok' ? (
              <PreviewText preview={preview.preview} />
            ) : preview.status === 'loading' ? (
              <span className="field__hint">Looking up room…</span>
            ) : (
              <span className="field__hint">Codes use letters A–Z (never I, L or O) and digits 2–9.</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--lg btn--block"
            data-testid="home-join"
            onClick={onJoin}
            disabled={joinPending}
            aria-busy={joinPending && intent === 'join'}
          >
            {joinPending && intent === 'join' ? (
              <>
                <span className="spinner spinner--light" aria-hidden="true" /> {pendingLabel ?? 'Joining…'}
              </>
            ) : (
              'Join room'
            )}
          </button>
          {errorFor('join') && (
            <p className="field__error" role="alert" data-testid="join-error">
              {errorFor('join')}
            </p>
          )}
        </section>
      </div>

      <section className="howto" aria-labelledby="howto-heading">
        <h2 className="howto__title" id="howto-heading">
          How to play
        </h2>
        <ol className="howto__steps">
          <li className="howto__step">
            <span className="howto__num">1</span>
            <strong>Gather {MIN_PLAYERS_TO_START}+ friends.</strong> Create a room and share the code or link.
          </li>
          <li className="howto__step">
            <span className="howto__num">2</span>
            <strong>Take turns drawing.</strong> Pick one of the offered words and sketch it before the clock runs out.
          </li>
          <li className="howto__step">
            <span className="howto__num">3</span>
            <strong>Guess in the chat.</strong> Faster guesses score more; close guesses get a nudge.
          </li>
          <li className="howto__step">
            <span className="howto__num">4</span>
            <strong>Climb the podium.</strong> Drawers earn points when the room guesses right.
          </li>
        </ol>
      </section>
    </div>
  );
}

function PreviewText({ preview }: { preview: NonNullable<ReturnType<typeof useRoomPreview>['preview']> }) {
  if (!preview.exists) return <span className="field__error">No room with this code right now.</span>;
  const players = `${preview.players}/${preview.maxPlayers} players`;
  if (!preview.joinable) {
    return <span className="field__error">{preview.inProgress ? `Game in progress — joining is closed. (${players})` : `Room is full. (${players})`}</span>;
  }
  return (
    <span className="field__ok">
      {players} · {preview.inProgress ? 'game in progress, you can still join' : 'waiting in the lobby'}
    </span>
  );
}
