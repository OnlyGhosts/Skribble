import { usePlatformStore } from '../store/usePlatformStore';

const LABELS = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
} as const;

export function ConnectionPill() {
  const status = usePlatformStore((s) => s.connection);
  return (
    <span className={`conn-pill conn-pill--${status}`} role="status" aria-label={LABELS[status]} data-testid="connection-status" data-status={status}>
      <span className="conn-pill__dot" aria-hidden="true" />
      <span className="conn-pill__label">{LABELS[status]}</span>
    </span>
  );
}
