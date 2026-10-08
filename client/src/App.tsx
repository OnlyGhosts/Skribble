import { useEffect } from 'react';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { PodiumOverlay } from './platform/components/PodiumOverlay';
import { Toasts } from './platform/components/Toasts';
import { WaitingOverlay } from './platform/components/WaitingOverlay';
import { DARK_SCHEME_QUERY } from './platform/lib/media';
import { setSoundEnabled, unlockAudio } from './platform/lib/sound';
import { fetchPreview } from './platform/lib/useRoomPreview';
import { useViewport } from './platform/lib/useViewport';
import { wakeLock } from './platform/lib/wakeLock';
import { socket } from './platform/net/socket';
import { registeredGame } from './platform/registry';
import { codeFromLocation, navigate, roomPath, startRouter, useRouter } from './platform/router';
import { startRouteSync } from './platform/routeSync';
import { GameHome } from './platform/screens/GameHome';
import { Library } from './platform/screens/Library';
import { Lobby } from './platform/screens/Lobby';
import { selectIsHost } from './platform/store/selectors';
import { usePlatformStore } from './platform/store/usePlatformStore';

const THEME_COLORS = { light: '#6c5ce7', dark: '#15142b' } as const;

function useTheme(): void {
  const theme = usePlatformStore((s) => s.prefs.theme);
  useEffect(() => {
    const mq = window.matchMedia(DARK_SCHEME_QUERY);
    const apply = () => {
      const resolved = theme ?? (mq.matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
    };
    apply();
    if (theme !== null) return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/**
 * Mirrors the room into the address bar ('/:slug/:CODE') and the title. The other direction
 * (navigating away leaves the room) is routeSync's; moving the URL after a leave is resetRoom's.
 */
function useUrlSync(): void {
  const code = usePlatformStore((s) => s.room?.code ?? null);
  const gameId = usePlatformStore((s) => s.room?.gameId ?? null);
  useEffect(() => {
    if (!code || !gameId) return;
    navigate(roomPath(gameId, code), { replace: codeFromLocation() === code });
    document.title = `${gameById(gameId).name} · room ${code}`;
  }, [code, gameId]);
}

function useSound(): void {
  const sound = usePlatformStore((s) => s.prefs.sound);
  useEffect(() => setSoundEnabled(sound), [sound]);
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
}

/** Keeps the screen awake while in a room (lobby, playing, ended): a locked phone drops its socket and misses its turn. */
function useWakeLock(inRoom: boolean): void {
  useEffect(() => {
    if (!inRoom) return;
    wakeLock.hold();
    return () => wakeLock.release();
  }, [inRoom]);
}

/** A legacy bare-code link: the preview says which game the room runs, then the URL becomes '/:slug/:CODE'. */
function LegacyCode({ code }: { code: string }) {
  const addToast = usePlatformStore((s) => s.addToast);
  useEffect(() => {
    const controller = new AbortController();
    fetchPreview(code, controller.signal)
      .then((preview) => {
        if (controller.signal.aborted) return;
        if (preview?.exists) {
          navigate(roomPath(preview.gameId, code), { replace: true });
          return;
        }
        addToast('warning', `There is no room with code ${code} right now.`);
        navigate('/', { replace: true });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        addToast('error', "Couldn't look up that room code. Check your connection and try again.");
        navigate('/', { replace: true });
      });
    return () => controller.abort();
  }, [code, addToast]);
  return <Library resolvingCode={code} />;
}

function UnknownRoute() {
  const addToast = usePlatformStore((s) => s.addToast);
  useEffect(() => {
    addToast('warning', 'That page does not exist; here is the library instead.');
    navigate('/', { replace: true });
  }, [addToast]);
  return <Library />;
}

/** Inside a room: the platform lobby, or the game's own screen with the platform podium once it ended. */
function RoomScreen({ room }: { room: RoomState }) {
  const meId = usePlatformStore((s) => s.playerId);
  const isHost = usePlatformStore(selectIsHost);
  const game = registeredGame(room.gameId);
  if (!game) return null;
  if (room.phase === 'lobby') return <Lobby room={room} game={game} />;
  const Screen = game.Screen;
  return (
    <>
      <Screen key={room.code} room={room} meId={meId ?? ''} isHost={isHost} />
      {room.phase === 'playing' && room.waiting && <WaitingOverlay room={room} waiting={room.waiting} isHost={isHost} />}
      {room.phase === 'ended' && <PodiumOverlay room={room} isHost={isHost} />}
    </>
  );
}

export function App() {
  useEffect(() => {
    socket.start();
    const stopRouter = startRouter();
    const stopSync = startRouteSync();
    return () => {
      stopRouter();
      stopSync();
    };
  }, []);
  useTheme();
  useViewport();
  useUrlSync();
  useSound();

  const room = usePlatformStore((s) => s.room);
  useWakeLock(room !== null);
  const route = useRouter((s) => s.route);

  let screen;
  if (room) screen = <RoomScreen room={room} />;
  else if (route.kind === 'game') screen = <GameHome key={route.game.id} game={route.game} code={route.code} />;
  else if (route.kind === 'code') screen = <LegacyCode code={route.code} />;
  else if (route.kind === 'unknown') screen = <UnknownRoute />;
  else screen = <Library />;

  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
