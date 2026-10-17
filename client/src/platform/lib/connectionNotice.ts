import { create } from 'zustand';
import { noOrphan } from './format';
import { usePlatformStore, type ConnectionStatus } from '../store/usePlatformStore';

/** A drop shorter than this (a hosting cut, a network switch) comes and goes without a word. */
export const NOTICE_DELAY_MS = 2000;

/** What the site's one connection notice says: a plain title, and a second line when it helps. */
export interface Notice {
  status: 'connecting' | 'reconnecting' | 'restarting' | 'slow';
  title: string;
  detail: string | null;
}

/** What the notice says while a server restart is under way: the game is on its way back. */
export const RESTARTING_TITLE = 'The server is restarting.';
export const RESTARTING_DETAIL = noOrphan('Your game will carry on.');

/**
 * The notice for a socket state, or null while connected and answering. `slow` is an open socket
 * whose server has gone quiet on what was sent: it already waited before it was raised.
 */
export function noticeFor(status: ConnectionStatus, slow: boolean, inRoom: boolean): Notice | null {
  const detail = inRoom ? 'Your place in the room is kept.' : null;
  if (status === 'connecting') return { status, title: 'Connecting…', detail: null };
  if (status === 'reconnecting') return { status, title: 'Reconnecting…', detail };
  if (status === 'restarting') return { status, title: RESTARTING_TITLE, detail: RESTARTING_DETAIL };
  return slow ? { status: 'slow', title: 'Waiting for the server…', detail } : null;
}

export const useConnectionNotice = create<{ notice: Notice | null }>()(() => ({ notice: null }));

/**
 * Keeps `useConnectionNotice` in step with the socket: a notice only once the connection has been
 * down for NOTICE_DELAY_MS (a slow server at once, since that waited already, and a restart at
 * once, since the server said so), gone the moment it is back. Returns the unsubscribe.
 */
export function startConnectionNotice(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let late = false;
  const update = () => {
    const s = usePlatformStore.getState();
    const down = s.connection !== 'connected';
    if (!down) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      late = false;
    } else if (!late && timer === null) {
      timer = setTimeout(() => {
        timer = null;
        late = true;
        update();
      }, NOTICE_DELAY_MS);
    }
    const notice = down && !late && s.connection !== 'restarting' ? null : noticeFor(s.connection, s.slow, s.room !== null);
    const prev = useConnectionNotice.getState().notice;
    if (prev?.status !== notice?.status || prev?.detail !== notice?.detail) useConnectionNotice.setState({ notice });
  };
  update();
  const stop = usePlatformStore.subscribe(update);
  return () => {
    stop();
    if (timer !== null) clearTimeout(timer);
    useConnectionNotice.setState({ notice: null });
  };
}
