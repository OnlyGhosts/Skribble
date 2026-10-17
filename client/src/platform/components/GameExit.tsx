import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { endGame, leaveRoom } from '../net/actions';
import { registeredGame } from '../registry';
import { EndIcon, LogoutIcon } from './Icons';

/** Which way out a confirm step is about. */
export type ExitKind = 'end' | 'leave';

/** Only the host ends a game, and only one that is running. */
export function canEndGame(room: RoomState | null, isHost: boolean): boolean {
  return isHost && room !== null && room.phase === 'playing';
}

/** What the host's End game does, under the question: the game's own word, or the default. */
export function endGameNote(room: RoomState): string {
  return registeredGame(room.gameId)?.endGameNote?.(room) ?? 'Everyone sees the scores so far.';
}

/** What leaving does, in a few words: the game goes on, unless too few players would be left. */
export function leaveNote(room: RoomState | null, meId: string | null): string {
  if (!room || room.phase !== 'playing') return "You’d need the code to come back in.";
  const me = room.players.find((p) => p.id === meId);
  if (!me?.participating) return 'The game goes on. You need the code to come back.';
  const left = room.players.filter((p) => p.participating && p.id !== me.id).length;
  if (left < gameById(room.gameId).minPlayers) return 'Too few would be left, so the game ends for everyone.';
  return 'The game goes on without you.';
}

interface ConfirmProps {
  room: RoomState | null;
  /** Back to where the step came from. */
  onCancel(): void;
  /** Prefix of the parts' test ids. */
  testId: string;
}

/** "End the game for everyone?" with what it does, End game and Keep playing. */
export function EndGameConfirm({ room, onCancel, testId }: ConfirmProps) {
  return (
    <div className="exit-confirm exit-confirm--end" role="group" aria-label="End the game?" data-testid={`${testId}-confirm`}>
      <span className="exit-confirm__icon" aria-hidden="true">
        <EndIcon size={22} />
      </span>
      <p className="exit-confirm__title">End the game for everyone?</p>
      {room && <p className="exit-confirm__note">{endGameNote(room)}</p>}
      <div className="exit-confirm__actions">
        <button
          type="button"
          className="btn btn--danger-solid"
          onClick={() => {
            endGame();
            onCancel();
          }}
          data-testid={`${testId}-yes`}
        >
          <EndIcon size={16} /> End game
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} data-testid={`${testId}-no`}>
          Keep playing
        </button>
      </div>
    </div>
  );
}

/** "Leave the room?" with what it does, Leave and Stay: the one confirmation in front of leaving a game. */
export function LeaveConfirm({ room, meId, onCancel, testId }: ConfirmProps & { meId: string | null }) {
  return (
    <div className="exit-confirm" role="group" aria-label="Leave the room?" data-testid={`${testId}-confirm`}>
      <span className="exit-confirm__icon" aria-hidden="true">
        <LogoutIcon size={22} />
      </span>
      <p className="exit-confirm__title">Leave the room?</p>
      <p className="exit-confirm__note">{leaveNote(room, meId)}</p>
      <div className="exit-confirm__actions">
        <button type="button" className="btn btn--danger" onClick={leaveRoom} data-testid={`${testId}-yes`}>
          <LogoutIcon size={16} /> Leave room
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} data-testid={`${testId}-no`}>
          Stay
        </button>
      </div>
    </div>
  );
}

/**
 * The ways out of a game as the options sheet's last rows: End game for the host (a serious
 * action, in the danger colour) and Leave room for everyone. Each opens its confirm step.
 */
export function ExitActions({ room, isHost, onPick }: { room: RoomState | null; isHost: boolean; onPick(kind: ExitKind): void }) {
  const ending = room?.endRequested === true;
  return (
    <div className="exit-actions" data-testid="exit-actions">
      {canEndGame(room, isHost) &&
        (ending ? (
          <p className="exit-action exit-action--end exit-action--pending" data-testid="end-game-requested">
            <span className="exit-action__icon" aria-hidden="true">
              <EndIcon size={18} />
            </span>
            <span className="exit-action__text">
              <strong>Ending soon</strong>
              <small>After the hand in play</small>
            </span>
          </p>
        ) : (
          <button type="button" className="exit-action exit-action--end" onClick={() => onPick('end')} data-testid="end-game">
            <span className="exit-action__icon" aria-hidden="true">
              <EndIcon size={18} />
            </span>
            <span className="exit-action__text">
              <strong>End game</strong>
              <small>Ends it for everyone</small>
            </span>
          </button>
        ))}
      <button type="button" className="exit-action" onClick={() => onPick('leave')} data-testid="leave-room">
        <span className="exit-action__icon" aria-hidden="true">
          <LogoutIcon size={18} />
        </span>
        <span className="exit-action__text">
          <strong>Leave room</strong>
          <small>Only you leave</small>
        </span>
      </button>
    </div>
  );
}

/** The desktop top bar's End game, for the host: opens the confirm step; reads as a note once asked for. */
export function EndGameButton({ room, onOpen, open }: { room: RoomState; onOpen(): void; open: boolean }) {
  if (room.endRequested) {
    return (
      <span className="gbar-end gbar-end--pending" data-testid="end-game-requested">
        <EndIcon size={15} /> Ending soon
      </span>
    );
  }
  return (
    <button type="button" className="btn btn--sm gbar-end" onClick={onOpen} aria-haspopup="dialog" aria-expanded={open} data-testid="end-game">
      <EndIcon size={15} /> End game
    </button>
  );
}
