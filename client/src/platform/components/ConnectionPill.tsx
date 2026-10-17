import { useEffect, useState } from 'react';
import { noOrphan } from '../lib/format';
import { usePlatformStore } from '../store/usePlatformStore';

import type { ConnectionStatus } from '../store/usePlatformStore';

/** The very first connect is usually instant: its pill only shows if it drags on this long. */
export const FIRST_CONNECT_GRACE_MS = 1200;

/** What the pill says while connected but the server has gone quiet on what was sent. */
export const SLOW_LABEL = 'Slow connection';

/** What the connection notice says while a server restart is under way (the pill has less room). */
export const RESTARTING_LABEL = noOrphan('The server is restarting. Your game will carry on.');
/** The short form, for the pill and the table games' status line. */
export const RESTARTING_PILL_LABEL = 'Server restarting…';

/** What the pill says for a socket state; null while connected and answering (no pill at all). */
export function connectionLabel(status: ConnectionStatus, slow = false): string | null {
  if (status === 'connected') return slow ? SLOW_LABEL : null;
  if (status === 'restarting') return RESTARTING_PILL_LABEL;
  return status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
}

/** The label on show: none while connected and answering, and none for a first connect still inside its grace. */
export function shownConnectionLabel(status: ConnectionStatus, graceOver: boolean, slow = false): string | null {
  if (status === 'connecting' && !graceOver) return null;
  return connectionLabel(status, slow);
}

/**
 * Nothing while the socket is connected and the server answers. While it is not (first connect, reconnecting, offline)
 * a small pill says so, so a player knows why nothing responds. The first connect waits out a
 * short grace in JS (not a CSS animation, which reduced motion would cut to nothing), so a normal
 * page load never flashes it.
 */
export function ConnectionPill() {
  const status = usePlatformStore((s) => s.connection);
  const slow = usePlatformStore((s) => s.slow);
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (status !== 'connecting') return;
    setGraceOver(false);
    const timer = window.setTimeout(() => setGraceOver(true), FIRST_CONNECT_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label = shownConnectionLabel(status, graceOver, slow);
  if (label === null) return null;
  const shown = status === 'connected' ? 'slow' : status;
  return (
    <span className={`conn-pill conn-pill--${shown}`} role="status" aria-label={label} data-testid="connection-status" data-status={shown}>
      <span className="conn-pill__dot" aria-hidden="true" />
      <span className="conn-pill__label">{label}</span>
    </span>
  );
}
