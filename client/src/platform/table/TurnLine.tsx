import type { ReactNode } from 'react';
import type { StatusTone } from './ControlPanel';

interface Props {
  text: string;
  tone: StatusTone;
  /** The game's own state name, for data-state. */
  state: string;
  /** A quieter second part: who is next, the last move, how many bets are in. */
  sub?: string;
  subTestId?: string;
  /** The turn clock, where the game has one (Poker). */
  clock?: ReactNode;
}

/**
 * The short line under a table's ribbon that says whose turn it is (or how the hand ended), in
 * the tone of the panel's status line. A new line slides in.
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
