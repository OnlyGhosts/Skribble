import type { CSSProperties, ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import { BottomSheet } from '../components/BottomSheet';
import { Chat } from '../components/Chat';
import { GameMenuSheet, GameTopBar } from '../components/GameTopBar';

/** The phone sheets a table can show; one at a time. */
export type TableSheet = 'players' | 'chat' | 'menu';

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
  /** The turn clock in the middle of the bar. */
  clock: ReactNode;
  playerCount: number;
  /** The players list, in its sheet. */
  players: ReactNode;
  sheet: TableSheet | null;
  onSheet(sheet: TableSheet | null): void;
  /** The host's End game, in the menu sheet (phone) or the bar (desktop). */
  endControl(variant: 'menu' | 'header'): ReactNode;
  table: ReactNode;
  panel: ReactNode;
}

/**
 * A card table's screen: a compact top bar (what is being played, the turn clock, players, chat,
 * options), the table, and the control panel always in the same place: under the table on a
 * phone, in a left column on a desktop with the chat on the right (table.css).
 */
export function TableShell({ meta, className, testId, headerTestId, mainTestId, data, isPhone, status, statusTestId, statusData, clock, playerCount, players, sheet, onSheet, endControl, table, panel }: Props) {
  const closeSheet = () => onSheet(null);
  const style = { '--table-accent': meta.accent } as CSSProperties;
  return (
    <div className={`tbl ${className}${isPhone ? ' tbl--phone' : ''}`} style={style} data-testid={testId} {...data}>
      <GameTopBar
        meta={meta}
        isPhone={isPhone}
        testId={headerTestId}
        className="tbl__top"
        status={status}
        statusTestId={statusTestId}
        statusData={statusData}
        clock={clock}
        players={{ count: playerCount, open: sheet === 'players', onOpen: () => onSheet('players') }}
        chat={isPhone ? { open: sheet === 'chat', onOpen: () => onSheet('chat') } : undefined}
        menu={{ open: sheet === 'menu', onOpen: () => onSheet('menu') }}
        actions={endControl('header')}
      />

      <main className="tbl__table" data-testid={mainTestId}>
        {table}
      </main>

      <aside className="tbl__panel card" aria-label="Controls">
        {panel}
      </aside>

      {!isPhone && (
        <aside className="tbl__chat card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Players (${playerCount})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="tbl__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <GameMenuSheet open={sheet === 'menu'} onClose={closeSheet}>
            {endControl('menu')}
          </GameMenuSheet>
        </>
      )}
    </div>
  );
}
