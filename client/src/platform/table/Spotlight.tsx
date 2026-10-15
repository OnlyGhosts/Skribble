import type { ReactNode } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import type { Tone } from './Outcome';

/**
 * What the spotlight is on: a player's turn (`turn`, or `mine` on my own), the dealer playing,
 * the bets going down, how a hand ended, or nothing to follow (a hold, the end).
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
  /** `row`: one hand, beside the stake and who is next (saves height); `stack`: under them (split hands, the bets). */
  layout?: 'row' | 'stack';
  data?: DataAttrs;
}

/** A name this short ("Ada", "Quinn") is never cut: "A…'s turn" says nothing. */
export const SHORT_NAME = 6;

/**
 * Centre stage: the hand being played right now, large, with its owner, the turn clock and who is
 * next. Its outline and label say whose turn it is before anything else on the screen does.
 */
export function Spotlight({ subject, kind, tone, who, label, meta, next, clock, children, layout = 'stack', data }: Props) {
  // A long name gives way before the rest of the label: "Christoph…'s turn"; a short one never does.
  const split = who && label.startsWith(who.name) ? who.name.length : label.length;
  const short = split <= SHORT_NAME;
  return (
    <section className={`tbl-spot tbl-spot--${kind} tbl-spot--tone-${tone} tbl-spot--${layout}`} aria-label="Spotlight" data-testid="spotlight" data-subject={subject} data-kind={kind} data-player-id={who?.id} {...data}>
      <div key={`who:${subject}`} className="tbl-spot__who tbl-spot-in">
        {who && (
          <span className="tbl-spot__face" data-table-anchor={`seat:${who.id}`}>
            <Avatar avatar={who.avatar} size="md" dimmed={!who.connected} />
          </span>
        )}
        <strong className="tbl-spot__label" data-testid="spot-label">
          <span className={`tbl-spot__name${short ? ' tbl-spot__name--short' : ''}`}>{label.slice(0, split)}</span>
          {split < label.length && <span className="tbl-spot__rest">{label.slice(split)}</span>}
        </strong>
      </div>
      {(meta || next) && (
        <div key={`sub:${subject}`} className="tbl-spot__sub tbl-spot-in">
          {meta}
          {next && (
            <span className="tbl-spot__next" data-testid="spot-next">
              Next: {next}
            </span>
          )}
        </div>
      )}
      <div className="tbl-spot__clock">{clock}</div>
      {children && (
        <div key={`body:${subject}`} className="tbl-spot__body tbl-spot-in">
          {children}
        </div>
      )}
    </section>
  );
}
