import { usePlatformStore } from '../store/usePlatformStore';

import type { ConnectionStatus } from '../store/usePlatformStore';

/** What the pill says for a socket state; null while connected (no pill at all). */
export function connectionLabel(status: ConnectionStatus): string | null {
  if (status === 'connected') return null;
  return status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
}

/**
 * Nothing while the socket is connected. While it is not (first connect, reconnecting, offline)
 * a small pill says so, so a player knows why nothing responds. The first connect only shows it
 * after a short CSS delay, so a normal page load never flashes it.
 */
export function ConnectionPill() {
  const status = usePlatformStore((s) => s.connection);
  const label = connectionLabel(status);
  if (label === null) return null;
  return (
    <span className={`conn-pill conn-pill--${status}`} role="status" aria-label={label} data-testid="connection-status" data-status={status}>
      <span className="conn-pill__dot" aria-hidden="true" />
      <span className="conn-pill__label">{label}</span>
    </span>
  );
}
