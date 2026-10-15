import { leaveRoom } from '../net/actions';
import { LogoutIcon } from './Icons';

/**
 * "Leave the party?" with Leave and Stay: the one confirmation in front of leaving from a game
 * (the top bar's back arrow) or the podium's options. `testId` prefixes the parts' test ids.
 */
export function LeaveConfirm({ onStay, testId }: { onStay(): void; testId: string }) {
  return (
    <div className="start-confirm" role="group" aria-label="Confirm leaving the party" data-testid={`${testId}-confirm`}>
      <p className="start-confirm__text">Leave the party? You'd need the code to come back in.</p>
      <div className="start-confirm__actions">
        <button type="button" className="btn btn--danger" onClick={leaveRoom} data-testid={`${testId}-yes`}>
          <LogoutIcon size={16} /> Leave party
        </button>
        <button type="button" className="btn btn--ghost" onClick={onStay} data-testid={`${testId}-no`}>
          Stay
        </button>
      </div>
    </div>
  );
}
