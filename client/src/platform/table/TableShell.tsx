import type { CSSProperties, ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { BottomSheet } from '../components/BottomSheet';
import { GameMenuSheet, GameTopBar } from '../components/GameTopBar';

/** The phone sheets a table can show; one at a time. */
export type TableSheet = 'players' | 'menu';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Props {
  meta: GameMeta;
  /** The game's own class on the root (its stylesheet hangs off it). */
  className: string;
  testId: string;
  headerTestId: string;
  mainTestId: string;
  data?: DataAttrs;
  isPhone: boolean;
  /** The line under the game's name in the top bar (round or hand, and the phase). */
  status: ReactNode;
  statusTestId: string;
  statusData?: DataAttrs;
  /** The room, for the top bar's player chips and the players sheet. */
  room: RoomState;
  /** The players list, in its sheet. */
  players: ReactNode;
  sheet: TableSheet | null;
  onSheet(sheet: TableSheet | null): void;
  table: ReactNode;
  panel: ReactNode;
}

/**
 * A card table's screen: a top bar (what is being played, players, options; one row on a phone,
 * where every player is on the table), the table, and the control panel always in the same place:
 * docked under the table on a phone, in a left column on a desktop (table.css).
 */
export function TableShell({ meta, className, testId, headerTestId, mainTestId, data, isPhone, status, statusTestId, statusData, room, players, sheet, onSheet, table, panel }: Props) {
  const closeSheet = () => onSheet(null);
  const style = { '--table-accent': meta.accent } as CSSProperties;
  return (
    <div className={`tbl ${className}${isPhone ? ' tbl--phone' : ''}`} style={style} data-testid={testId} {...data}>
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId={headerTestId}
        className="tbl__top"
        status={status}
        statusTestId={statusTestId}
        statusData={statusData}
        players={{ open: sheet === 'players', onOpen: () => onSheet('players') }}
        compact={isPhone}
        menu={{ open: sheet === 'menu', onOpen: () => onSheet('menu') }}
      />

      <main className="tbl__table" data-testid={mainTestId}>
        {table}
      </main>

      <aside className="tbl__panel card" aria-label="Controls">
        {panel}
      </aside>

      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && <GameMenuSheet open={sheet === 'menu'} onClose={closeSheet} />}
    </div>
  );
}
