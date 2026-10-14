import type { BattleshipsRoomState, BattleshipsView, OwnBoardView } from '@shared/games/battleships/protocol';
import { CheckIcon, SparkIcon } from '../../../platform/components/Icons';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { autoPlace, placeReady, rotateShip, tapOwnCell } from '../actions';
import { mySide, nameOf } from '../hooks';
import { layoutOf, unplaced } from '../lib/placement';
import { useBattleships } from '../store';
import { Board, type BoardShip } from './Board';
import { RotateIcon } from './Icons';

interface Props {
  room: BattleshipsRoomState;
  view: BattleshipsView;
  board: OwnBoardView;
  meId: string;
}

/**
 * The captain lays the fleet out: a tray of ships to pick from, a tap on the board to drop the
 * one in hand (a rejected spot flashes red), a rotate button, auto-place and Ready. Teammates
 * watch the captain's layout take shape on the same board.
 */
export function PlacementPanel({ room, view, board, meId }: Props) {
  const draft = useBattleships((s) => s.draft);
  const selectedShipId = useBattleships((s) => s.selectedShipId);
  const horizontal = useBattleships((s) => s.horizontal);
  const invalid = useBattleships((s) => s.invalid);
  const pickShip = useBattleships((s) => s.pickShip);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const side = mySide(view);
  const captain = side?.captainId === meId;
  const canEdit = captain && !board.ready && !view.paused;
  const lengths = view.fleet;
  const tray = unplaced(draft, lengths);
  const complete = layoutOf(draft, lengths) !== null;
  // Teammates see the server's copy of the captain's layout; the captain sees their own draft.
  const ships: BoardShip[] = canEdit
    ? Object.values(draft).map((s) => ({ ...s, selected: s.id === selectedShipId }))
    : board.ships.map((s) => ({ id: s.id, x: s.x, y: s.y, length: s.length, horizontal: s.horizontal }));
  const inHand = selectedShipId ? (draft[selectedShipId]?.length ?? lengths[Number(selectedShipId.slice(1))]) : undefined;
  const state = board.ready ? 'ready' : captain ? 'placing' : 'watching';

  return (
    <section className="bs-place card" data-testid="placement" data-state={state} data-ships-placed={Object.keys(draft).length}>
      {canEdit ? (
        <>
          <div className="bs-tray" role="group" aria-label="Ships to place" data-testid="tray">
            {tray.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`bs-tray__ship${s.id === selectedShipId ? ' is-selected' : ''}`}
                onClick={() => pickShip(s.id === selectedShipId ? null : s.id)}
                aria-pressed={s.id === selectedShipId}
                aria-label={`Ship of ${s.length}`}
                data-testid="tray-ship"
                data-ship-id={s.id}
                data-length={s.length}
              >
                {Array.from({ length: s.length }, (_, i) => (
                  <span key={i} className="bs-tray__seg" aria-hidden="true" />
                ))}
              </button>
            ))}
            {tray.length === 0 && (
              <span className="bs-tray__empty" data-testid="tray-empty">
                Every ship is on the board. Tap one to pick it up again.
              </span>
            )}
          </div>
          <p className="bs-place__hint" data-testid="place-hint">
            {inHand !== undefined ? `Tap a cell for the ${inHand}-ship (${horizontal ? 'across' : 'down'}).` : 'Pick a ship from the tray, then tap where it goes.'}
          </p>
        </>
      ) : (
        <p className="bs-place__hint" data-testid="place-hint">
          {board.ready ? 'Your fleet is in position. Waiting for the others…' : `${nameOf(room, side?.captainId)} is placing your team's ships…`}
        </p>
      )}
      <Board
        size={view.boardSize}
        shots={{}}
        ships={ships}
        invalid={invalid}
        onCell={canEdit ? (x, y) => tapOwnCell(x, y, view.boardSize, lengths) : undefined}
        testId="own-board"
        label="Your board"
      />
      {canEdit && (
        <div className="bs-place__actions">
          <button type="button" className="btn btn--secondary" onClick={() => rotateShip(view.boardSize, lengths)} data-testid="rotate" aria-label={`Rotate: ${horizontal ? 'across' : 'down'}`}>
            <RotateIcon size={16} /> {horizontal ? 'Across' : 'Down'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={autoPlace} disabled={!connected} data-testid="auto-place">
            <SparkIcon size={16} /> Auto-place
          </button>
          <button type="button" className="btn btn--primary" onClick={() => placeReady(lengths)} disabled={!connected || !complete} data-testid="place-ready">
            <CheckIcon size={16} /> Ready
          </button>
        </div>
      )}
      {invalid.length > 0 && (
        <p className="bs-place__error" role="alert" data-testid="place-error">
          That ship does not fit there: {invalid.map((k) => k.split(',').map(Number)).map(([x, y]) => `${String.fromCharCode(65 + x)}${y + 1}`).join(', ') || 'off the board'}.
        </p>
      )}
    </section>
  );
}
