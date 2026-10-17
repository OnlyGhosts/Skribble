import { useEffect, useState } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH } from '@shared/platform/constants';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { SITE_NAME } from '@shared/platform/site';
import { AvatarPicker } from '../components/AvatarPicker';
import { BottomSheet } from '../components/BottomSheet';
import { GamePicker } from '../components/GamePicker';
import { CopyIcon, EditIcon, LinkIcon, LogoutIcon, PlayIcon, ShareIcon } from '../components/Icons';
import { PlayerList } from '../components/PlayerList';
import { ReadyControls } from '../components/ReadyControls';
import { SettingsPanel } from '../components/SettingsPanel';
import { SiteHeader } from '../components/SiteHeader';
import type { AnyGameClientModule } from '../game';
import { copyText } from '../lib/clipboard';
import { canStart, listNames, notReadyPlayers, readyLine, readyPlayers } from '../lib/party';
import { useLive } from '../lib/useLive';
import { leaveRoom, startGame, updateProfile } from '../net/actions';
import { inviteLink } from '../router';
import { selectIsHost, selectMe } from '../store/selectors';
import { usePlatformStore } from '../store/usePlatformStore';

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
}

export function Lobby({ room, game }: Props) {
  const me = useLive(usePlatformStore, selectMe);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const playerId = useLive(usePlatformStore, (s) => s.playerId);
  const addToast = usePlatformStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const meta = gameById(room.gameId);

  // The home page was likely scrolled to its join form (or the game was): start the lobby at the code.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const host = room.players.find((p) => p.id === room.hostId);
  const changeLook = (
    <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)} aria-haspopup="dialog" aria-expanded={editing} data-testid="edit-profile">
      <EditIcon size={18} /> Change my look
    </button>
  );
  const link = inviteLink(meta, room.code);

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    addToast(ok ? 'success' : 'error', ok ? `${label} copied` : `Couldn’t copy the ${label.toLowerCase()}. Select it and copy it yourself.`);
  };

  /** The native share sheet where it exists (phones); otherwise the link lands on the clipboard. */
  const share = async () => {
    const data: ShareData = { title: SITE_NAME, text: `Join my room on ${SITE_NAME}. Code: ${room.code}.`, url: link };
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
    <div className={`lobby${isHost ? '' : ' lobby--guest'}`} data-testid="lobby">
      <div className="lobby__body">
        {/* The room's header: one bar holding the logo, the code and its buttons on a wider screen; a phone stacks the logo over the code card. */}
        <div className="lobby__top">
          <SiteHeader
            menuActions={[
              { label: 'Copy invite link', icon: <LinkIcon size={18} />, onSelect: () => void copy(link, 'Invite link'), testId: 'copy-link' },
              { label: 'Leave room', icon: <LogoutIcon size={18} />, onSelect: leaveRoom, testId: 'leave-room' },
            ]}
          />

          <section className="room-card" aria-label="Room code" data-testid="room-bar">
            <div className="room-card__code">
              <span className="room-card__label" aria-hidden="true">
                Room code
              </span>
              <span className="room-card__value" data-testid="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>
                {room.code.split('').map((ch, i) => (
                  <span key={i} className="room-card__char">
                    {ch}
                  </span>
                ))}
              </span>
            </div>
            <button type="button" className="room-card__btn" onClick={() => void copy(room.code, 'Code')} aria-label="Copy code" data-testid="copy-code">
              <CopyIcon size={20} />
              <span>Copy</span>
            </button>
            <button type="button" className="room-card__btn" onClick={() => void share()} aria-label="Share invite" data-testid="share-invite">
              <ShareIcon size={20} />
              <span>Share</span>
            </button>
          </section>
        </div>

        {/* Only the host sees the settings: everyone else sees what is next, who is here and their own buttons. */}
        <div className={`lobby__grid${isHost ? '' : ' lobby__grid--guest'}`}>
          <div className="lobby__col">
            <GamePicker room={room} isHost={isHost} />

            <section className="lobby__players" aria-labelledby="players-heading">
              <h2 className="sr-only" id="players-heading">
                Players
              </h2>
              <span className="sr-only" data-testid="player-count" data-ready={readyPlayers(room).length} data-players={room.players.length}>
                {readyLine(room)}
              </span>
              <PlayerList room={room} meId={playerId} isHost={isHost} mode="lobby" game={game} />
            </section>
          </div>

          {isHost && (
            <div className="lobby__col">
              <section className="card lobby__settings" aria-labelledby="settings-heading">
                <div className="card__head">
                  <h2 className="card__title" id="settings-heading">
                    Settings
                  </h2>
                </div>
                <SettingsPanel room={room} game={game} />
              </section>
            </div>
          )}
        </div>
      </div>

      <div className="lobby__footer" data-testid="lobby-footer">
        <div className="lobby__footer-inner">
          {isHost && <StartControls room={room} />}
          {me && <ReadyControls me={me} extra={changeLook} />}
          {!isHost && (
            <p className="lobby__waiting" data-testid="waiting-for-host">
              Waiting for {host?.name ?? 'the host'} to start {meta.name}
              <span className="ellipsis" aria-hidden="true" />
            </p>
          )}
        </div>
      </div>

      {me && (
        <BottomSheet open={editing} title="Change my look" onClose={() => setEditing(false)} testId="profile-sheet" className="sheet--narrow sheet--dialog">
          <ProfileEditor me={{ name: me.name, avatar: me.avatar }} onClose={() => setEditing(false)} />
        </BottomSheet>
      )}
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
            {listNames(notReady.map((p) => p.name))} {notReady.length === 1 ? "isn’t" : "aren’t"} ready yet and would sit this one out.
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
          Start · {ready} ready
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
        className="btn btn--primary btn--block"
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
