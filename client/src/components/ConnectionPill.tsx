import { useGameStore } from '../store/useGameStore';

const LABELS = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
} as const;

export function ConnectionPill() {
  const status = useGameStore((s) => s.connection);
  return (
    <span className={`conn-pill conn-pill--${status}`} role="status" data-testid="connection-status" data-status={status}>
      <span className="conn-pill__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
