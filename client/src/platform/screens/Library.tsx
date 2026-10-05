import { useEffect, useState } from 'react';
import { GAME_LIST, type GameMeta } from '@shared/platform/games';
import { ROOM_CODE_LENGTH, isValidRoomCode, roomCodeHint } from '@shared/platform/roomCode';
import { SITE_NAME, SITE_TAGLINE } from '@shared/platform/site';
import { CodeInput } from '../components/CodeInput';
import { ArrowRightIcon, SparkIcon, UsersIcon } from '../components/Icons';
import { SiteHeader } from '../components/SiteHeader';
import { enteredLength } from '../lib/codeInput';
import { useRoomPreview } from '../lib/useRoomPreview';
import { gamePath, navigate, roomPath } from '../router';
import { usePlatformStore } from '../store/usePlatformStore';

interface Props {
  /** A bare code from a legacy link, being resolved to its game. */
  resolvingCode?: string | null;
}

function GameCard({ game }: { game: GameMeta }) {
  const live = game.status === 'live';
  const body = (
    <>
      <span className="game-card__tile" style={{ background: game.accent }} aria-hidden="true">
        {game.icon}
      </span>
      <span className="game-card__body">
        <span className="game-card__name">{game.name}</span>
        <span className="game-card__tagline">{game.tagline}</span>
        <span className="game-card__meta">
          <UsersIcon size={14} /> {game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}-${game.maxPlayers}`} players
          {!live && <span className="pill game-card__soon">Coming soon</span>}
        </span>
      </span>
      {live && <ArrowRightIcon size={18} className="game-card__arrow" />}
    </>
  );
  if (!live) {
    return (
      <li className="game-card game-card--soon" data-testid="game-card" data-game={game.slug} aria-disabled="true">
        {body}
      </li>
    );
  }
  return (
    <li>
      <a
        className="game-card"
        href={gamePath(game)}
        data-testid="game-card"
        data-game={game.slug}
        onClick={(e) => {
          e.preventDefault();
          navigate(gamePath(game));
        }}
      >
        {body}
      </a>
    </li>
  );
}

/** The front page: pick a game, or type a friend's code and land in that game's room. */
export function Library({ resolvingCode = null }: Props) {
  const addToast = usePlatformStore((s) => s.addToast);
  const [code, setCode] = useState('');
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const preview = useRoomPreview(code);
  const games = GAME_LIST.filter((g) => g.status !== 'hidden');

  useEffect(() => {
    document.title = SITE_NAME;
  }, []);

  // A code that names a room takes you straight to that game's home with the code filled in.
  useEffect(() => {
    if (preview.status === 'ok' && preview.preview.exists) navigate(roomPath(preview.preview.gameId, code));
  }, [preview, code]);

  const onJoin = () => {
    if (!isValidRoomCode(code)) {
      setCodeHint(enteredLength(code) < ROOM_CODE_LENGTH ? `Enter the ${ROOM_CODE_LENGTH}-character code from your friend.` : roomCodeHint());
      return;
    }
    if (preview.status === 'ok' && !preview.preview.exists) {
      setCodeHint('No room with this code right now.');
      return;
    }
    if (preview.status === 'unavailable') {
      addToast('error', "Couldn't look up that room code. Check your connection and try again.");
      return;
    }
    // Still loading (or the preview resolved while we clicked): the legacy route resolves it.
    navigate(`/${code}`);
  };

  return (
    <div className="library">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero__title">
          Game night, <span className="hero__accent">anywhere.</span>
        </h1>
        <p className="hero__tagline">{SITE_TAGLINE}</p>
        {resolvingCode && (
          <div className="banner banner--info" role="status" data-testid="resolving-banner">
            <span className="spinner" aria-hidden="true" /> Looking up room <strong>{resolvingCode}</strong>
            <span className="ellipsis" aria-hidden="true" />
          </div>
        )}
      </section>

      <section className="card action-card library__join" aria-labelledby="library-join-heading">
        <div className="action-card__icon action-card__icon--join" aria-hidden="true">
          <UsersIcon size={22} />
        </div>
        <h2 className="card__title" id="library-join-heading">
          Join with a code
        </h2>
        <p className="card__text">Got a code from a friend? Type it here: it takes you to the right game.</p>
        <CodeInput
          value={code}
          onChange={(next) => {
            setCode(next);
            setCodeHint(null);
          }}
          onSubmit={onJoin}
          onInvalidChar={() => setCodeHint(roomCodeHint())}
          invalid={Boolean(codeHint)}
        />
        <div className="code-preview" aria-live="polite" data-testid="room-preview">
          {codeHint ? (
            <span className="field__error" data-testid="code-hint">
              {codeHint}
            </span>
          ) : preview.status === 'ok' && !preview.preview.exists ? (
            <span className="field__error">No room with this code right now.</span>
          ) : preview.status === 'loading' ? (
            <span className="field__hint">Looking up room…</span>
          ) : (
            <span className="field__hint">Codes use letters A–Z (never I, L or O) and digits 2–9.</span>
          )}
        </div>
        <button type="button" className="btn btn--secondary btn--lg btn--block" onClick={onJoin} data-testid="library-join">
          Join room
        </button>
      </section>

      <section className="library__games" aria-labelledby="games-heading">
        <h2 className="library__heading" id="games-heading">
          <SparkIcon size={18} /> Pick a game
        </h2>
        <ul className="game-grid" data-testid="game-grid">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
          <li className="game-card game-card--more" data-testid="game-card-more" aria-disabled="true">
            <span className="game-card__tile game-card__tile--more" aria-hidden="true">
              ✨
            </span>
            <span className="game-card__body">
              <span className="game-card__name">More games on the way</span>
              <span className="game-card__tagline">New games land here as they are built.</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
