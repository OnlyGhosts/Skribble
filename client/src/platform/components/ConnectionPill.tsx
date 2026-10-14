import { useEffect, useState } from 'react';
import { usePlatformStore } from '../store/usePlatformStore';

import type { ConnectionStatus } from '../store/usePlatformStore';

/** The very first connect is usually instant: its pill only shows if it drags on this long. */
export const FIRST_CONNECT_GRACE_MS = 1200;

/** What the pill says for a socket state; null while connected (no pill at all). */
export function connectionLabel(status: ConnectionStatus): string | null {
  if (status === 'connected') return null;
  return status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
}

/** The label on show: none while connected, and none for a first connect still inside its grace. */
export function shownConnectionLabel(status: ConnectionStatus, graceOver: boolean): string | null {
  if (status === 'connecting' && !graceOver) return null;
  return connectionLabel(status);
}

/**
 * Nothing while the socket is connected. While it is not (first connect, reconnecting, offline)
 * a small pill says so, so a player knows why nothing responds. The first connect waits out a
 * short grace in JS (not a CSS animation, which reduced motion would cut to nothing), so a normal
 * page load never flashes it.
 */
export function ConnectionPill() {
  const status = usePlatformStore((s) => s.connection);
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (status !== 'connecting') return;
    setGraceOver(false);
    const timer = window.setTimeout(() => setGraceOver(true), FIRST_CONNECT_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label = shownConnectionLabel(status, graceOver);
  if (label === null) return null;
  return (
    <span className={`conn-pill conn-pill--${status}`} role="status" aria-label={label} data-testid="connection-status" data-status={status}>
      <span className="conn-pill__dot" aria-hidden="true" />
      <span className="conn-pill__label">{label}</span>
    </span>
  );
}
