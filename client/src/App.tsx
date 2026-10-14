import { useEffect } from 'react';
import type { RoomState } from '@shared/platform/protocol';
import { SITE_NAME } from '@shared/platform/site';
import { PodiumOverlay } from './platform/components/PodiumOverlay';
import { ReconnectingBanner } from './platform/components/ReconnectingBanner';
import { Toasts } from './platform/components/Toasts';
import { WaitingOverlay } from './platform/components/WaitingOverlay';
import { loadPlatformSoundsAfterGesture } from './platform/lib/platformSounds';
import { setSoundEnabled, unlockAudio, type AnySoundBank } from './platform/lib/sound';
import { DEFAULT_THEME } from './platform/lib/storage';
import { useViewport } from './platform/lib/useViewport';
import { wakeLock } from './platform/lib/wakeLock';
import { socket } from './platform/net/socket';
import { registeredGame } from './platform/registry';
import { codeFromLocation, navigate, roomPath, startRouter, useRouter } from './platform/router';
import { startRouteSync } from './platform/routeSync';
import { Home } from './platform/screens/Home';
import { Lobby } from './platform/screens/Lobby';
import { selectIsHost } from './platform/store/selectors';
import { usePlatformStore } from './platform/store/usePlatformStore';

/** The browser chrome colour per theme: the page colour of each. */
const THEME_COLORS = { dark: '#141514', light: '#f5f6ef' } as const;

/** Dark unless the toggle chose light; the operating system preference is not consulted. */
function useTheme(): void {
  const theme = usePlatformStore((s) => s.prefs.theme);
  useEffect(() => {
    const resolved = theme ?? DEFAULT_THEME;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
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
    document.title = `${SITE_NAME} · ${code}`;
  }, [code, gameId]);
}

function useSound(): void {
  const sound = usePlatformStore((s) => s.prefs.sound);
  useEffect(() => setSoundEnabled(sound), [sound]);
  useEffect(() => {
    loadPlatformSoundsAfterGesture();
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

/** '/:slug': the per-game landing pages are gone; a game is picked inside the room. */
function GameRedirect() {
  useEffect(() => {
    navigate('/', { replace: true });
  }, []);
  return <Home code={null} game={null} />;
}

function UnknownRoute() {
  const addToast = usePlatformStore((s) => s.addToast);
  useEffect(() => {
    addToast('warning', 'That page does not exist; here is the front door instead.');
    navigate('/', { replace: true });
  }, [addToast]);
  return <Home code={null} game={null} />;
}

/** A game's sounds start loading when its screen mounts, not before anyone plays it. */
function useGameSounds(bank: AnySoundBank | undefined, onScreen: boolean): void {
  useEffect(() => {
    if (onScreen) bank?.load();
  }, [bank, onScreen]);
}

/** Inside a room: the platform lobby, or the game's own screen with the platform podium once it ended. */
function RoomScreen({ room }: { room: RoomState }) {
  const meId = usePlatformStore((s) => s.playerId);
  const isHost = usePlatformStore(selectIsHost);
  const game = registeredGame(room.gameId);
  useGameSounds(game?.sounds, room.phase !== 'lobby');
  if (!game) return null;
  if (room.phase === 'lobby') return <Lobby room={room} game={game} />;
  const Screen = game.Screen;
  return (
    <>
      <Screen key={room.code} room={room} meId={meId ?? ''} isHost={isHost} />
      {room.phase === 'playing' && room.waiting && <WaitingOverlay room={room} waiting={room.waiting} isHost={isHost} meId={meId} />}
      {room.phase === 'ended' && <PodiumOverlay room={room} meId={meId} isHost={isHost} />}
      <ReconnectingBanner />
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
  else if (route.kind === 'game') screen = <GameRedirect />;
  else if (route.kind === 'unknown') screen = <UnknownRoute />;
  else screen = <Home code={route.code} game={route.game} />;

  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
