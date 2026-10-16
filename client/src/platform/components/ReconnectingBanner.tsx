import { usePlatformStore, type ConnectionStatus } from '../store/usePlatformStore';
import { SLOW_LABEL } from './ConnectionPill';

/** The banner's text for a socket state; null while connected and answering (no banner). */
export function reconnectLabel(status: ConnectionStatus, slow = false): string | null {
  switch (status) {
    case 'connected':
      return slow ? SLOW_LABEL : null;
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
 * goes again). It also shows while the socket is up but the server has gone quiet on a move (a
 * weak or switching network), so a wait never looks like a freeze. Hidden otherwise; the lobby
 * and the home screen show the pill instead.
 */
export function ReconnectingBanner() {
  const connection = usePlatformStore((s) => s.connection);
  const slow = usePlatformStore((s) => s.slow);
  const label = reconnectLabel(connection, slow);
  if (label === null) return null;
  return (
    <div className="reconnect-banner" role="status" aria-live="polite" data-testid="reconnecting-banner" data-status={connection === 'connected' ? 'slow' : connection}>
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}
