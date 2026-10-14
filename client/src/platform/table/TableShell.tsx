import type { CSSProperties, ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import { BottomSheet } from '../components/BottomSheet';
import { Chat } from '../components/Chat';
import { ConnectionPill } from '../components/ConnectionPill';
import { GameMark } from '../components/GameGlyph';
import { LogoutIcon, MoreIcon, UsersIcon } from '../components/Icons';
import { PreferenceRows, SettingsMenu } from '../components/Preferences';
import { leaveRoom } from '../net/actions';
import { BubbleIcon } from './Icons';

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
  /** The block beside the game mark: what is being played and a small line under it. */
  heading: ReactNode;
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
export function TableShell({ meta, className, testId, headerTestId, mainTestId, data, isPhone, heading, clock, playerCount, players, sheet, onSheet, endControl, table, panel }: Props) {
  const closeSheet = () => onSheet(null);
  const style = { '--table-accent': meta.accent } as CSSProperties;
  return (
    <div className={`tbl ${className}${isPhone ? ' tbl--phone' : ''}`} style={style} data-testid={testId} {...data}>
      <header className="tbl__top card" data-testid={headerTestId}>
        <div className="tbl__brand">
          {!isPhone && <GameMark game={meta} size="sm" />}
          {heading}
        </div>
        <div className="tbl__clock">{clock}</div>
        <div className="tbl__side">
          <button type="button" className="tbl__players-btn" onClick={() => onSheet('players')} aria-haspopup="dialog" aria-expanded={sheet === 'players'} aria-label={`Players (${playerCount})`} data-testid="players-toggle">
            <UsersIcon size={18} />
            <span>{playerCount}</span>
          </button>
          {isPhone ? (
            <>
              <button type="button" className="icon-btn tbl__icon-btn" onClick={() => onSheet('chat')} aria-haspopup="dialog" aria-expanded={sheet === 'chat'} aria-label="Chat" data-testid="chat-toggle">
                <BubbleIcon size={20} />
              </button>
              <button type="button" className="icon-btn tbl__icon-btn" onClick={() => onSheet('menu')} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label="More options" data-testid="game-menu">
                <MoreIcon size={20} />
              </button>
            </>
          ) : (
            <>
              <ConnectionPill />
              <SettingsMenu />
              {endControl('header')}
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </header>

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
          <BottomSheet open={sheet === 'menu'} title="Options" onClose={closeSheet} testId="menu-sheet">
            <div className="menu-sheet">
              <PreferenceRows />
              {endControl('menu')}
              <button type="button" className="btn btn--ghost btn--block menu-sheet__leave" onClick={leaveRoom} data-testid="leave-room">
                <LogoutIcon size={16} /> Leave room
              </button>
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
