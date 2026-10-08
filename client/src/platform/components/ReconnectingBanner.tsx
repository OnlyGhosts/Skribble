import { usePlatformStore, type ConnectionStatus } from '../store/usePlatformStore';

/** The banner's text for a socket state; null while connected (no banner). */
export function reconnectLabel(status: ConnectionStatus): string | null {
  switch (status) {
    case 'connected':
      return null;
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
  }
}

/**
 * A small pill pinned to the top of a game screen while the socket is down. The phone screens
 * keep the connection pill inside their menu sheet, so without this a dropped player would only
 * see a screen that stopped moving (the "connection lost" toast comes after a few seconds and
 * goes again). Hidden while connected; the lobby and the home screen show the pill instead.
 */
export function ReconnectingBanner() {
  const connection = usePlatformStore((s) => s.connection);
  const label = reconnectLabel(connection);
  if (label === null) return null;
  return (
    <div className="reconnect-banner" role="status" aria-live="polite" data-testid="reconnecting-banner" data-status={connection}>
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}
