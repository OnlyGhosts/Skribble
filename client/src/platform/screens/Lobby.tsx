import { useEffect, useRef, useState } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH } from '@shared/platform/constants';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { SITE_NAME } from '@shared/platform/site';
import { AvatarPicker } from '../components/AvatarPicker';
import { Chat } from '../components/Chat';
import { GamePicker } from '../components/GamePicker';
import { CopyIcon, EditIcon, LinkIcon, LogoutIcon, PlayIcon, SendIcon } from '../components/Icons';
import { PlayerList } from '../components/PlayerList';
import { ReadyControls } from '../components/ReadyControls';
import { SettingsPanel } from '../components/SettingsPanel';
import { SiteHeader } from '../components/SiteHeader';
import type { AnyGameClientModule } from '../game';
import { copyText } from '../lib/clipboard';
import { canStart, listNames, notReadyPlayers, readyLine, readyPlayers } from '../lib/party';
import { leaveRoom, startGame, updateProfile } from '../net/actions';
import { inviteLink } from '../router';
import { selectIsHost, selectMe } from '../store/selectors';
import { usePlatformStore } from '../store/usePlatformStore';

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
}

export function Lobby({ room, game }: Props) {
  const me = usePlatformStore(selectMe);
  const isHost = usePlatformStore(selectIsHost);
  const playerId = usePlatformStore((s) => s.playerId);
  const addToast = usePlatformStore((s) => s.addToast);
  const playAgainPending = usePlatformStore((s) => s.playAgainPending);
  const setPlayAgainPending = usePlatformStore((s) => s.setPlayAgainPending);
  const [editing, setEditing] = useState(false);
  const startRef = useRef<HTMLDivElement | null>(null);
  const meta = gameById(room.gameId);

  // The home page was likely scrolled to its join form; start the lobby at the code. After "Play
  // again" the host lands at the Start button instead.
  useEffect(() => {
    if (playAgainPending) {
      startRef.current?.scrollIntoView({ block: 'center' });
      setPlayAgainPending(false);
      return;
    }
    window.scrollTo(0, 0);
  }, [playAgainPending, setPlayAgainPending]);

  const host = room.players.find((p) => p.id === room.hostId);
  const link = inviteLink(meta, room.code);

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    addToast(ok ? 'success' : 'error', ok ? `${label} copied to clipboard` : `Couldn't copy the ${label.toLowerCase()} — select it manually.`);
  };

  /** The native share sheet where it exists (phones); otherwise the link lands on the clipboard. */
  const share = async () => {
    const data: ShareData = { title: `${meta.name} · ${SITE_NAME}`, text: `Join my ${meta.name} party with code ${room.code}`, url: link };
    if (typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the user closed the sheet
      }
    }
    await copy(link, 'Invite link');
  };

  return (
    <div className="lobby">
      <SiteHeader crumb={meta.name}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave
        </button>
      </SiteHeader>

      <GamePicker room={room} isHost={isHost} />

      <section className="card code-card" aria-labelledby="code-heading">
        <div className="code-card__text">
          <h1 className="code-card__title" id="code-heading">
            Invite your friends
          </h1>
          <p className="card__text">Share this code — or the link — and they'll land right here. The party stays together between games.</p>
        </div>
        <div className="code-card__code" data-testid="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>
          {room.code.split('').map((ch, i) => (
            <span key={i} className="code-card__char">
              {ch}
            </span>
          ))}
        </div>
        <div className="code-card__actions">
          <button type="button" className="btn btn--primary" onClick={() => void copy(room.code, 'Code')} data-testid="copy-code">
            <CopyIcon size={16} /> Copy code
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void copy(link, 'Invite link')} data-testid="copy-link">
            <LinkIcon size={16} /> Copy invite link
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void share()} data-testid="share-invite">
            <SendIcon size={16} /> Share invite
          </button>
        </div>
      </section>

      <div className="lobby__grid">
        <section className="card lobby__players" aria-labelledby="players-heading">
          <div className="card__head">
            <h2 className="card__title" id="players-heading">
              Players
            </h2>
            <span className="pill" data-testid="player-count" data-ready={readyPlayers(room).length} data-players={room.players.length}>
              {readyLine(room)}
            </span>
          </div>
          <PlayerList room={room} meId={playerId} isHost={isHost} mode="lobby" game={game} />
          {me && <ReadyControls me={me} context="lobby" />}
          {me && (
            <div className="profile-edit">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing} data-testid="edit-profile">
                <EditIcon size={16} /> {editing ? 'Done' : 'Change my look'}
              </button>
              {editing && <ProfileEditor me={{ name: me.name, avatar: me.avatar }} onClose={() => setEditing(false)} />}
            </div>
          )}
          <div className="lobby__start" ref={startRef}>
            {isHost ? (
              <StartControls room={room} />
            ) : (
              <p className="lobby__waiting" data-testid="waiting-for-host">
                Waiting for {host?.name ?? 'the host'} to start {meta.name}
                <span className="ellipsis" aria-hidden="true" />
              </p>
            )}
          </div>
        </section>

        <section className="card lobby__settings" aria-labelledby="settings-heading">
          <div className="card__head">
            <h2 className="card__title" id="settings-heading">
              {meta.name} settings
            </h2>
            {isHost && <span className="pill pill--accent">You're the host</span>}
          </div>
          <SettingsPanel room={room} isHost={isHost} game={game} />
        </section>

        <section className="card lobby__chat" aria-label="Lobby chat">
          <div className="card__head">
            <h2 className="card__title">Chat</h2>
          </div>
          <Chat />
        </section>
      </div>
    </div>
  );
}

/**
 * The host's Start: enabled once enough players are ready, with a hint naming who still is not.
 * Starting while some could still ready up asks first, since they would sit the game out.
 */
function StartControls({ room }: { room: RoomState }) {
  const meta = gameById(room.gameId);
  const [confirming, setConfirming] = useState(false);
  const ready = readyPlayers(room).length;
  const notReady = notReadyPlayers(room);
  const startable = canStart(room, meta);
  useEffect(() => {
    if (notReady.length === 0) setConfirming(false);
  }, [notReady.length]);

  const onStart = () => {
    if (notReady.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startGame();
  };

  return (
    <>
      {confirming ? (
        <div className="start-confirm" role="group" aria-label="Start with players not ready" data-testid="start-confirm">
          <p className="start-confirm__text">
            Not everyone is ready — {listNames(notReady.map((p) => p.name))} {notReady.length === 1 ? "isn't" : "aren't"} ready yet and would sit this one out.
          </p>
          <div className="start-confirm__actions">
            <button type="button" className="btn btn--primary" onClick={onStart} data-testid="start-anyway">
              <PlayIcon size={16} /> Start anyway
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)} data-testid="start-wait">
              Wait for them
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onStart} disabled={!startable} data-testid="start-game" data-ready={ready}>
          <PlayIcon size={18} /> Start · {ready} ready
        </button>
      )}
      {!startable && (
        <p className="field__hint" data-testid="start-hint">
          {meta.name} needs at least {meta.minPlayers} ready {meta.minPlayers === 1 ? 'player' : 'players'}.{notReady.length > 0 && ` Not ready yet: ${listNames(notReady.map((p) => p.name))}.`}
        </p>
      )}
    </>
  );
}

function ProfileEditor({ me, onClose }: { me: { name: string; avatar: AvatarData }; onClose(): void }) {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const clean = name.replace(/\s+/g, ' ').trim();
  return (
    <div className="profile-editor" data-testid="profile-editor">
      <div className="field">
        <label className="field__label" htmlFor="lobby-name">
          Name
        </label>
        <input
          id="lobby-name"
          className="input"
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="nickname"
          autoCorrect="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <AvatarPicker value={avatar} onChange={setAvatar} compact />
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={!clean}
        onClick={() => {
          updateProfile(clean !== me.name ? clean : undefined, avatar);
          onClose();
        }}
        data-testid="save-profile"
      >
        Save
      </button>
    </div>
  );
}
