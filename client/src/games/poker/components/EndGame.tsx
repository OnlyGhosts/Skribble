import { endGame } from '../actions';
import { usePoker, usePokerStore } from '../store';
import { StopIcon } from './Icons';

interface Props {
  /** The menu sheet's full-width row, or the desktop header's small button. */
  variant: 'menu' | 'header';
}

/** Host only: End game, then a confirmation (the hand in play is void and every stake goes back). */
export function EndGameControl({ variant }: Props) {
  const confirming = usePoker((s) => s.confirmEnd);
  const setConfirm = usePokerStore.getState().setConfirmEnd;
  if (!confirming) {
    return (
      <button type="button" className={`btn btn--ghost ${variant === 'menu' ? 'btn--block' : 'btn--sm'} pk-end`} onClick={() => setConfirm(true)} data-testid="end-game">
        <StopIcon size={16} /> End game
      </button>
    );
  }
  return (
    <div className={`pk-end-confirm pk-end-confirm--${variant}`} role="group" aria-label="End the game?" data-testid="end-game-confirm">
      <span className="pk-end-confirm__text">{variant === 'menu' ? 'End the game now? Bets in this hand go back.' : 'End now?'}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)} data-testid="end-game-cancel">
        Keep playing
      </button>
      <button type="button" className="btn btn--danger btn--sm" onClick={endGame} data-testid="end-game-yes">
        End game
      </button>
    </div>
  );
}
