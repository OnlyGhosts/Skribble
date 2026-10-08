import { useEffect, useRef, useState } from 'react';
import { randomAvatar, type Avatar as AvatarData } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH } from '@shared/platform/constants';
import { gameById, type GameMeta } from '@shared/platform/games';
import { ROOM_CODE_LENGTH, isValidRoomCode, roomCodeHint } from '@shared/platform/roomCode';
import { SITE_NAME } from '@shared/platform/site';
import { AvatarPicker } from '../components/AvatarPicker';
import { CodeInput } from '../components/CodeInput';
import { LinkIcon, SparkIcon, UsersIcon } from '../components/Icons';
import { SiteHeader } from '../components/SiteHeader';
import { enteredLength } from '../lib/codeInput';
import { loadAvatar, loadName, saveAvatar, saveName } from '../lib/storage';
import { useRoomPreview, type RoomPreview } from '../lib/useRoomPreview';
import { createRoom, joinRoom } from '../net/actions';
import { usePlatformStore } from '../store/usePlatformStore';

type Intent = 'create' | 'join';

/** A rejoin still not answered after this long (server unreachable) gives the join form back. */
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

interface Props {
  game: GameMeta;
  /** A code from the URL (join link): prefilled, with the invite banner. */
  code: string | null;
}

/** A game's front door: name and avatar, create a room, or join one with a code. */
export function GameHome({ game, code: invitedCode }: Props) {
  const connection = usePlatformStore((s) => s.connection);
  const joinPending = usePlatformStore((s) => s.joinPending);
  const joinError = usePlatformStore((s) => s.joinError);
  const rejoining = usePlatformStore((s) => s.rejoining);
  const clearJoinError = usePlatformStore((s) => s.clearJoinError);

  const [name, setName] = useState(loadName);
  const [avatar, setAvatar] = useState<AvatarData>(() => loadAvatar() ?? randomAvatar());
  const [code, setCode] = useState(invitedCode ?? '');
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const preview = useRoomPreview(code);
  // A seat we can resume is tried first; the form only shows when that fails (or drags on).
  const [rejoinStale, setRejoinStale] = useState(false);
  useEffect(() => {
    setRejoinStale(false);
    if (!rejoining) return;
    const timer = window.setTimeout(() => setRejoinStale(true), REJOIN_FORM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [rejoining]);
  const home = homeView(rejoining, rejoinStale);
  const showForm = home !== 'rejoining';

  useEffect(() => saveName(name), [name]);
  useEffect(() => saveAvatar(avatar), [avatar]);
  useEffect(() => {
    document.title = `${game.name} · ${SITE_NAME}`;
  }, [game]);
  useEffect(() => {
    if (invitedCode) {
      setCode(invitedCode);
      nameRef.current?.focus();
    }
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
    createRoom(game.id, clean, avatar);
  };

  const onJoin = () => {
    const clean = requireName();
    if (!clean) return;
    if (!isValidRoomCode(code)) {
      setCodeHint(enteredLength(code) < ROOM_CODE_LENGTH ? `Enter the ${ROOM_CODE_LENGTH}-character code from your friend.` : roomCodeHint());
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
      <SiteHeader crumb={game.name} />

      <section className="hero game-hero">
        <span className="game-hero__tile" style={{ background: game.accent }} aria-hidden="true">
          {game.icon}
        </span>
        <h1 className="hero__title">{game.name}</h1>
        <p className="hero__lead">{game.tagline}</p>
        <p className="hero__tagline">{game.description}</p>
        {home === 'rejoining' && (
          <div className="banner banner--info" role="status" data-testid="rejoining-banner">
            <span className="spinner" aria-hidden="true" /> Rejoining your room<span className="ellipsis" aria-hidden="true" />
          </div>
        )}
        {home === 'stale' && (
          <div className="banner banner--info" role="status" data-testid="rejoin-stale-banner">
            <LinkIcon size={16} /> Your old seat is not answering. You can join {invitedCode ? <strong>{invitedCode}</strong> : 'the room'} again below.
          </div>
        )}
        {home === 'form' && invitedCode && (
          <div className="banner banner--invite" role="status" data-testid="invite-banner">
            <LinkIcon size={16} /> You've been invited to room <strong>{invitedCode}</strong>. Pick a name and jump in!
          </div>
        )}
      </section>

      {showForm && (
        <>
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
              <p className="card__text">You become the host: tweak the settings, then share the code or the link.</p>
              <ul className="feature-list" aria-label="What you get">
                <li>Up to {game.maxPlayers} players, private by default</li>
                <li>A 4-character code that is easy to read out loud</li>
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
                  <PreviewText preview={preview.preview} game={game} />
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
        </>
      )}

      <section className="howto" aria-labelledby="howto-heading">
        <h2 className="howto__title" id="howto-heading">
          How to play
        </h2>
        <ol className="howto__steps">
          {game.howToPlay.map((step, i) => (
            <li key={step} className="howto__step">
              <span className="howto__num">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function PreviewText({ preview, game }: { preview: RoomPreview; game: GameMeta }) {
  if (!preview.exists) return <span className="field__error">No room with this code right now.</span>;
  const players = `${preview.players}/${preview.maxPlayers} players`;
  if (!preview.joinable) {
    return <span className="field__error">{preview.inProgress ? `Game in progress — joining is closed. (${players})` : `Room is full. (${players})`}</span>;
  }
  // Codes are shared across games: a code typed here may belong to another game, and that is where it leads.
  const otherGame = preview.gameId !== game.id ? gameById(preview.gameId) : null;
  return (
    <span className="field__ok">
      {players} · {preview.inProgress ? 'game in progress, you can still join' : 'waiting in the lobby'}
      {otherGame && ` · a ${otherGame.name} room`}
    </span>
  );
}
