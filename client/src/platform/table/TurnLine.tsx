import type { ReactNode } from 'react';

/** How the line reads: lime when it is on me, lilac while someone else (or the dealer) plays, red when I am out, quiet otherwise. */
export type TurnTone = 'go' | 'other' | 'bad' | 'quiet';

interface Props {
  text: string;
  tone: TurnTone;
  /** The game's own state name, for data-state. */
  state: string;
  /** A quieter second part: who is next, the last move, how many bets are in, where I stand. */
  sub?: string;
  subTestId?: string;
  /** The turn clock, where the game has one (Poker). */
  clock?: ReactNode;
}

/**
 * The one line on a table that says what is happening, under its ribbon: whose turn it is (or how
 * the hand ended), with a quieter second part. A new line slides in.
 */
export function TurnLine({ text, tone, state, sub, subTestId = 'turn-sub', clock }: Props) {
  return (
    <p key={text} className={`tbl-turn tbl-turn--${tone}`} data-testid="table-turn" data-state={state}>
      {clock && <span className="tbl-turn__clock">{clock}</span>}
      <span className="tbl-turn__text">{text}</span>
      {sub && (
        <span className="tbl-turn__sub" data-testid={subTestId}>
          {sub}
        </span>
      )}
    </p>
  );
}
