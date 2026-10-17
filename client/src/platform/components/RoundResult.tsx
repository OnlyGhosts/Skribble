import type { PlayerPublic } from '@shared/platform/protocol';
import { formatPoints } from '../lib/format';
import { Avatar } from './Avatar';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

export interface ResultRow {
  id: string;
  player: PlayerPublic | undefined;
  name: string;
  points: number;
  /** A small role tag after the name ("drawer", "spy"). */
  tag?: string;
  data?: DataAttrs;
}

/** Who scored this round or turn, highest first: avatar, name, an optional tag and the +points. */
export function ResultPoints({ rows, label, rowTestId, empty }: { rows: ResultRow[]; label: string; rowTestId?: string; empty: string }) {
  if (rows.length === 0) return <p className="overlay__hint result-empty">{empty}</p>;
  return (
    <ul className="result-points" aria-label={label}>
      {rows.map((row) => (
        <li key={row.id} className="result-points__row" data-testid={rowTestId} {...row.data}>
          {row.player && <Avatar avatar={row.player.avatar} size="sm" />}
          <span className="result-points__name">
            <span className="result-points__text">{row.name}</span>
            {row.tag && <span className="result-points__tag">{row.tag}</span>}
          </span>
          <span className="result-points__pts">{formatPoints(row.points)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Players with a positive score in `points`, highest first and then by seat. */
export function earnersOf(players: readonly PlayerPublic[], points: Record<string, number>): { player: PlayerPublic; points: number }[] {
  return players
    .map((player) => ({ player, points: points[player.id] ?? 0 }))
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.player.joinOrder - b.player.joinOrder);
}

/**
 * The foot of a result: what comes next. The countdown itself is the top bar's ring (one
 * countdown per screen); this says whether it is coming, held while the game waits for players,
 * or starting now that the time is up.
 */
export function ResultNext({ noun, paused, settling, testId }: { noun: string; paused: boolean; settling: boolean; testId: string }) {
  const state = paused ? 'paused' : settling ? 'settling' : 'running';
  return (
    <div className="overlay__footer result-next">
      <span data-testid={testId} data-countdown={state}>
        {paused ? `${noun} is paused` : settling ? `${noun} is starting` : `${noun} soon`}
      </span>
    </div>
  );
}
