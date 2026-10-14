import type { BlackjackActions, BlackjackSettings, HandView } from '@shared/games/blackjack/protocol';
import { double, hit, split, stand } from '../actions';
import { actionReason } from '../lib/text';

interface Props {
  actions: BlackjackActions;
  hand: HandView | undefined;
  chips: number;
  settings: BlackjackSettings;
  myTurn: boolean;
  /** False once the game has ended: nothing is sent. */
  playing: boolean;
  /** The socket is up; a move cannot leave the phone otherwise. */
  connected: boolean;
}

const MOVES: ReadonlyArray<{ key: keyof BlackjackActions; id: string; label: string; onClick(): void; primary?: boolean }> = [
  { key: 'canHit', id: 'hit', label: 'Hit', onClick: hit, primary: true },
  { key: 'canStand', id: 'stand', label: 'Stand', onClick: stand },
  { key: 'canDouble', id: 'double', label: 'Double', onClick: double },
  { key: 'canSplit', id: 'split', label: 'Split', onClick: split },
];

/** Hit, Stand, Double and Split: big targets, greyed out with the reason when a move is not on offer. */
export function Actions({ actions, hand, chips, settings, myTurn, playing, connected }: Props) {
  const enabled = playing && connected;
  return (
    <div className="bj-actions" role="group" aria-label="Your moves" data-testid="actions" data-my-turn={myTurn}>
      {MOVES.map((move) => {
        const reason = !playing ? 'Game over' : !connected ? 'Reconnecting…' : actionReason(move.key, actions, hand, chips, settings, myTurn);
        const can = enabled && actions[move.key];
        return (
          <button
            key={move.id}
            type="button"
            className={`btn bj-action${move.primary ? ' btn--primary' : ' btn--secondary'}`}
            onClick={move.onClick}
            disabled={!can}
            aria-label={reason ? `${move.label}: ${reason}` : move.label}
            data-testid={`action-${move.id}`}
            data-reason={reason || undefined}
          >
            <span className="bj-action__label">{move.label}</span>
            {reason && <span className="bj-action__reason">{reason}</span>}
          </button>
        );
      })}
    </div>
  );
}
