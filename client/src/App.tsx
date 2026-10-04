import { useEffect, useRef } from 'react';
import { leaveRoom } from './net/actions';
import { socket } from './net/socket';
import { vibrate } from './lib/haptics';
import { playCue, setSoundEnabled, unlockAudio } from './lib/sound';
import { codeFromLocation, pushRoomUrl, resetUrl } from './lib/url';
import { useViewport } from './lib/useViewport';
import { selectIsDrawer, selectMe, useGameStore } from './store/useGameStore';
import { Toasts } from './components/Toasts';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';

const BASE_TITLE = 'Skribble — draw & guess with friends';

function useTheme(): void {
  const theme = useGameStore((s) => s.prefs.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme ?? (mq.matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#15142b' : '#6c5ce7');
    };
    apply();
    if (theme !== null) return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Mirrors the room into the address bar and leaves the room when the user navigates away from it. */
function useUrlSync(): void {
  const code = useGameStore((s) => s.room?.code ?? null);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (code) {
      pushRoomUrl(code);
      document.title = `Skribble — room ${code}`;
    } else {
      if (previous.current !== null) resetUrl();
      document.title = BASE_TITLE;
    }
    previous.current = code;
  }, [code]);

  useEffect(() => {
    const onPop = () => {
      const room = useGameStore.getState().room;
      if (room && codeFromLocation() !== room.code) leaveRoom();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

function useSoundEffects(): void {
  const sound = useGameStore((s) => s.prefs.sound);
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

  useEffect(
    () =>
      useGameStore.subscribe((state, prev) => {
        const phase = state.room?.phase;
        const prevPhase = prev.room?.phase;
        if (phase && phase.kind === 'choosing' && phase.drawerId === state.playerId) {
          const wasMyChoosing = prevPhase?.kind === 'choosing' && prevPhase.drawerId === phase.drawerId;
          if (!wasMyChoosing) playCue('yourTurn');
        }
        if (phase?.kind === 'turnEnd' && prevPhase?.kind !== 'turnEnd') playCue('turnEnd');
        if (state.chat !== prev.chat) {
          const last = state.chat[state.chat.length - 1];
          const prevLast = prev.chat[prev.chat.length - 1];
          if (last && last.kind === 'correct' && last.id !== prevLast?.id) playCue('correct');
        }
        // A little buzz when this player cracks the word (the drawer is marked as guessed too; skip them).
        if (
          phase?.kind === 'drawing' &&
          prevPhase?.kind === 'drawing' &&
          !selectIsDrawer(state) &&
          selectMe(state)?.guessedThisTurn &&
          !selectMe(prev)?.guessedThisTurn
        ) {
          vibrate(30);
        }
      }),
    [],
  );
}

export function App() {
  useEffect(() => socket.start(), []);
  useTheme();
  useViewport();
  useUrlSync();
  useSoundEffects();

  const room = useGameStore((s) => s.room);

  return (
    <>
      {room === null ? <Home /> : room.phase.kind === 'lobby' ? <Lobby room={room} /> : <Game room={room} />}
      <Toasts />
    </>
  );
}
