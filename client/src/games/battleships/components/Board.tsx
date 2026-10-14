import type { CSSProperties } from 'react';
import { cellKey, cellLabel, segmentAt } from '@shared/games/battleships/fleet';
import type { CellMark, ShipView, ShotEvent } from '@shared/games/battleships/protocol';

export interface BoardShip extends Pick<ShipView, 'id' | 'x' | 'y' | 'length' | 'horizontal'> {
  /** Per segment from (x, y); damage travels with a ship that moves. */
  damage?: readonly boolean[];
  sunk?: boolean;
  /** The ship in hand while placing, or the one picked to move. */
  selected?: boolean;
}

/** Where a ship picked to move would go: drawn over the board, red when it may not stop there. */
export interface BoardGhost {
  ship: BoardShip;
  problem: string | null;
}

interface Props {
  size: number;
  shots: Record<string, CellMark>;
  /** The viewer's own ships (never an opponent's: the server sends none). */
  ships?: readonly BoardShip[];
  /** Cells painted red: a rejected drop while placing. */
  invalid?: readonly string[];
  /** The cell awaiting its confirming tap. */
  aimed?: string | null;
  /** The latest shot, animated when it landed on this board. */
  fresh?: ShotEvent | null;
  /** A ship's planned move, over the ship where it lies now. */
  ghost?: BoardGhost | null;
  /** Interactive cells; without it the board is a plain picture. */
  onCell?(x: number, y: number): void;
  /** Cells a tap may not change (shot already, or the viewer is not up): still shown, not buttons that do anything. */
  disabledCell?(x: number, y: number): boolean;
  testId: string;
  label: string;
}

/** 'B2, your 3-ship, hit': what a screen reader hears for a cell. A damaged segment that moved off its shot square says so. */
export function cellDescription(x: number, y: number, ship: BoardShip | undefined, mark: CellMark | undefined): string {
  const parts = [cellLabel(x, y)];
  if (ship) parts.push(`your ${ship.length}-ship`);
  if (mark) parts.push(mark);
  else if (ship && damagedAt(ship, x, y)) parts.push('damaged');
  return parts.join(', ');
}

function damagedAt(ship: BoardShip, x: number, y: number): boolean {
  const i = segmentAt(ship, x, y);
  return i >= 0 && (ship.damage?.[i] ?? false);
}

function placement(s: BoardShip, size: number): CSSProperties {
  return {
    left: `${(s.x / size) * 100}%`,
    top: `${(s.y / size) * 100}%`,
    width: `${((s.horizontal ? s.length : 1) / size) * 100}%`,
    height: `${((s.horizontal ? 1 : s.length) / size) * 100}%`,
  };
}

/** A hull drawn as its segments, so a damaged one shows wherever the ship has gone. */
function Segments({ ship }: { ship: BoardShip }) {
  return (
    <>
      {Array.from({ length: ship.length }, (_, i) => (
        <span key={i} className="bs-ship__seg" data-damaged={ship.damage?.[i] ? 'true' : undefined} />
      ))}
    </>
  );
}

/**
 * One grid, used for the own fleet (ships drawn over the cells) and for every target (shots
 * only). Column letters run along the top, row numbers sit in the first column's cells, so the
 * grid itself takes the whole width: ten cells of 36px fit a 390px phone, fourteen shrink to fit.
 * Each board row is a `row` of `gridcell`s laid out through `display: contents`, so the grid stays
 * one CSS grid.
 */
export function Board({ size, shots, ships = [], invalid = [], aimed = null, fresh = null, ghost = null, onCell, disabledCell, testId, label }: Props) {
  const style = { '--bs-size': size } as CSSProperties;
  const shipCell: Record<string, BoardShip> = {};
  for (const s of ships) for (let i = 0; i < s.length; i++) shipCell[cellKey(s.horizontal ? s.x + i : s.x, s.horizontal ? s.y : s.y + i)] = s;
  const freshKey = fresh ? cellKey(fresh.x, fresh.y) : null;
  const rows = Array.from({ length: size }, (_, y) => y);
  return (
    <div className={`bs-board${onCell ? ' bs-board--live' : ''}`} style={style} role="grid" aria-label={label} data-testid={testId} data-size={size}>
      <div className="bs-board__cols" aria-hidden="true">
        {Array.from({ length: size }, (_, x) => (
          <span key={x}>{String.fromCharCode(65 + x)}</span>
        ))}
      </div>
      <div className="bs-board__grid">
        {rows.map((y) => (
          <div key={y} className="bs-board__row" role="row" data-testid="board-row">
            {Array.from({ length: size }, (_, x) => {
              const key = cellKey(x, y);
              const mark = shots[key];
              const ship = shipCell[key];
              const state = invalid.includes(key) ? 'invalid' : aimed === key ? 'aimed' : undefined;
              const disabled = !onCell || (disabledCell?.(x, y) ?? false);
              return (
                <button
                  key={key}
                  type="button"
                  className="bs-cell"
                  role="gridcell"
                  aria-label={cellDescription(x, y, ship, mark)}
                  aria-selected={aimed === key ? true : undefined}
                  disabled={disabled}
                  onClick={onCell ? () => onCell(x, y) : undefined}
                  data-testid="cell"
                  data-x={x}
                  data-y={y}
                  data-mark={mark}
                  data-ship={ship?.id}
                  data-damaged={ship && damagedAt(ship, x, y) ? 'true' : undefined}
                  data-state={state}
                  data-fresh={freshKey === key ? fresh?.result : undefined}
                >
                  {x === 0 && (
                    <span className="bs-cell__row" aria-hidden="true">
                      {y + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {ships.map((s) => (
          <span
            key={s.id}
            className={`bs-ship${s.horizontal ? '' : ' bs-ship--down'}${s.sunk ? ' bs-ship--sunk' : ''}${s.selected ? ' bs-ship--selected' : ''}${ghost?.ship.id === s.id ? ' bs-ship--origin' : ''}`}
            style={placement(s, size)}
            aria-hidden="true"
            data-testid="board-ship"
            data-ship-id={s.id}
            data-length={s.length}
            data-sunk={s.sunk ? 'true' : undefined}
            data-selected={s.selected ? 'true' : undefined}
          >
            <Segments ship={s} />
          </span>
        ))}
        {ghost && (
          <span
            className={`bs-ship bs-ship--ghost${ghost.ship.horizontal ? '' : ' bs-ship--down'}${ghost.problem ? ' is-blocked' : ''}`}
            style={placement(ghost.ship, size)}
            aria-hidden="true"
            data-testid="ghost-ship"
            data-ship-id={ghost.ship.id}
            data-x={ghost.ship.x}
            data-y={ghost.ship.y}
            data-horizontal={String(ghost.ship.horizontal)}
            data-blocked={ghost.problem ? 'true' : undefined}
          >
            <Segments ship={ghost.ship} />
          </span>
        )}
      </div>
    </div>
  );
}
