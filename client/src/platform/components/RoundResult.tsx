import type { PlayerPublic } from '@shared/platform/protocol';
import { formatPoints } from '../lib/format';
import { Avatar } from './Avatar';
import { Timer } from './Timer';

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
 * The foot of a result: what comes next and its countdown. Paused while the game holds for
 * players; once the time is up and the server's next step is a beat away, it says so instead of
 * sitting on a red "0".
 */
export function ResultNext({ noun, endsAt, paused, settling, testId }: { noun: string; endsAt: number | null; paused: boolean; settling: boolean; testId: string }) {
  const state = paused ? 'paused' : settling ? 'settling' : 'running';
  return (
    <div className="overlay__footer result-next">
      <span data-testid={testId} data-countdown={state}>
        {paused ? `${noun} is paused` : settling ? `${noun} is starting` : `${noun} in`}
      </span>
      <Timer endsAt={endsAt} size="md" warnUnder={0} paused={paused} settling={settling} />
    </div>
  );
}
