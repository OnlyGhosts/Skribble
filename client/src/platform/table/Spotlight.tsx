import type { ReactNode } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import type { Tone } from './Outcome';

/**
 * What the spotlight is on: a player's turn (`turn`, or `mine` on my own), the dealer playing,
 * the bets going down, how my round ended, or nothing to follow (a hold, the end).
 */
export type SpotlightKind = 'turn' | 'mine' | 'dealer' | 'bets' | 'result' | 'idle';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Props {
  /** Who or what is in it; a new subject slides in (at once under reduced motion). */
  subject: string;
  kind: SpotlightKind;
  /** The outline: lime on a turn, an outcome's colour on a result. */
  tone: Tone;
  who?: { id: string; name: string; avatar: AvatarData; connected: boolean } | null;
  /** "Pia's turn", "Your turn", "Dealer's turn". */
  label: string;
  /** Under the label: the stack, the bet, the last move. */
  meta?: ReactNode;
  /** Who plays after this turn. */
  next?: string | null;
  /** The turn clock. */
  clock: ReactNode;
  /** The hand being played, large. */
  children?: ReactNode;
  data?: DataAttrs;
}

/**
 * Centre stage: the hand being played right now, large, with its owner, the turn clock and who is
 * next. Its outline and label say whose turn it is before anything else on the screen does.
 */
export function Spotlight({ subject, kind, tone, who, label, meta, next, clock, children, data }: Props) {
  return (
    <section className={`tbl-spot tbl-spot--${kind} tbl-spot--tone-${tone}`} aria-label="Spotlight" data-testid="spotlight" data-subject={subject} data-kind={kind} data-player-id={who?.id} {...data}>
      <div className="tbl-spot__head">
        <div key={subject} className="tbl-spot__who tbl-spot-in">
          {who && (
            <span className="tbl-spot__face" data-table-anchor={`seat:${who.id}`}>
              <Avatar avatar={who.avatar} size="md" dimmed={!who.connected} />
            </span>
          )}
          <span className="tbl-spot__titles">
            <strong className="tbl-spot__label" data-testid="spot-label">
              {label}
            </strong>
            {(meta || next) && (
              <span className="tbl-spot__sub">
                {meta}
                {next && (
                  <span className="tbl-spot__next" data-testid="spot-next">
                    Next: {next}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
        <div className="tbl-spot__clock">{clock}</div>
      </div>
      {children && (
        <div key={subject} className="tbl-spot__body tbl-spot-in">
          {children}
        </div>
      )}
    </section>
  );
}
