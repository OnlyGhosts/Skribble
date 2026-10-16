import type { ReactNode } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Props {
  /** `mine`: my own hand; `other`: another player's; `none`: nobody's yet. */
  variant: 'mine' | 'other' | 'none';
  label: string;
  /** Whose hand it is, in the left column: their face (the chips fly from `anchor`) and name. */
  who?: { avatar: AvatarData; connected: boolean; name: string; anchor?: string } | null;
  /** Under the name: the stake (a "Bet 10" pill), the dealer button. */
  owner?: ReactNode;
  /** The hand, big, in the middle. */
  children?: ReactNode;
  /** The right column: my own hand small on another player's turn, the last move. */
  aside?: ReactNode;
  data?: DataAttrs;
}

/**
 * The stage at the bottom of a calm table, the same place and size all game long: whose hand it
 * is and the stake on it on the left, the hand big in the middle, a small extra on the right.
 */
export function TableStage({ variant, label, who, owner, children, aside, data }: Props) {
  return (
    <section className={`tbl-stage tbl-stage--${variant}`} aria-label={label} data-testid="hand-stage" {...data}>
      <div className={`tbl-stage__owner${variant === 'other' ? ' is-turn' : ''}`}>
        {who && (
          <span className="tbl-stage__face" data-table-anchor={who.anchor}>
            <Avatar avatar={who.avatar} size="sm" dimmed={!who.connected} />
          </span>
        )}
        {who && <span className="tbl-stage__name">{who.name}</span>}
        {owner}
      </div>
      <div className="tbl-stage__centre">{children}</div>
      <div className="tbl-stage__aside">{aside}</div>
    </section>
  );
}
