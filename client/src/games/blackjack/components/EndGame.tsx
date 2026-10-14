import type { BlackjackPhase } from '@shared/games/blackjack/protocol';
import { endGame } from '../actions';
import { useBlackjack, useBlackjackStore } from '../store';
import { StopIcon } from './Icons';

interface Props {
  /** The menu sheet's full-width row, or the desktop header's small button. */
  variant: 'menu' | 'header';
  phase: BlackjackPhase;
  /** Already asked for: the game ends once the hand in play settles. */
  requested: boolean;
}

/** Host only: End game, then a confirmation. During a hand the game ends once it settles; between hands at once (bets go back). */
export function EndGameControl({ variant, phase, requested }: Props) {
  const confirming = useBlackjack((s) => s.confirmEnd);
  const setConfirm = useBlackjackStore.getState().setConfirmEnd;
  if (phase === 'ending' || phase === 'gameOver') return null;
  if (requested) {
    return (
      <span className={`bj-end-note bj-end-note--${variant}`} data-testid="end-game-requested">
        Ends after this hand
      </span>
    );
  }
  if (!confirming) {
    return (
      <button type="button" className={`btn btn--ghost ${variant === 'menu' ? 'btn--block' : 'btn--sm'} bj-end`} onClick={() => setConfirm(true)} data-testid="end-game">
        <StopIcon size={16} /> End game
      </button>
    );
  }
  const duringHand = phase === 'acting';
  const question = variant === 'menu' ? (duringHand ? 'End the game after this hand?' : 'End the game now? Bets on the table go back.') : duringHand ? 'End after this hand?' : 'End now?';
  return (
    <div className={`bj-end-confirm bj-end-confirm--${variant}`} role="group" aria-label="End the game?" data-testid="end-game-confirm">
      <span className="bj-end-confirm__text">{question}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)} data-testid="end-game-cancel">
        Keep playing
      </button>
      <button type="button" className="btn btn--danger btn--sm" onClick={endGame} data-testid="end-game-yes">
        End game
      </button>
    </div>
  );
}
