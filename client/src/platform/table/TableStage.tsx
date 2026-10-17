import type { ReactNode } from 'react';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Props {
  /** `mine`: my own hand; `other`: the hand in play when I am not dealt in; `none`: nobody's. */
  variant: 'mine' | 'other' | 'none';
  label: string;
  /** The hand, big, in the middle; its stake (or its owner's name) rides on it, by its total. */
  children?: ReactNode;
  data?: DataAttrs;
}

/**
 * The stage at the bottom of a calm table, the same place and size all game long: the hand that
 * matters to me, big and centred, with nothing in columns beside it.
 */
export function TableStage({ variant, label, children, data }: Props) {
  return (
    <section className={`tbl-stage tbl-stage--${variant}`} aria-label={label} data-testid="hand-stage" {...data}>
      {children}
    </section>
  );
}
