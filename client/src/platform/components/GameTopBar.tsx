import type { ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import { leaveRoom } from '../net/actions';
import { BottomSheet } from './BottomSheet';
import { ConnectionPill } from './ConnectionPill';
import { GameMark } from './GameGlyph';
import { ChatIcon, LogoutIcon, MenuIcon, UsersIcon } from './Icons';
import { PreferenceRows, SettingsMenu } from './Preferences';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Toggle {
  open: boolean;
  onOpen(): void;
}

interface Props {
  meta: GameMeta;
  isPhone: boolean;
  testId: string;
  /** The game layout's own class for the bar (its grid placement). */
  className?: string;
  /** The line under the game's name: round, turn or hand. */
  status: ReactNode;
  /** Test id and data attributes of the name and status block ('round-indicator' by default). */
  statusTestId?: string;
  statusData?: DataAttrs;
  /** The timer ring. */
  clock?: ReactNode;
  players: Toggle & { count: number; label?: string };
  /** Left out where the chat is already on screen (a desktop chat column, Scribble's guess feed). */
  chat?: Toggle;
  /** The phone's options sheet (theme, sound, the game's host controls, Leave). */
  menu: Toggle;
  /** Extra buttons before the players button (Battleships' shot log). */
  extra?: ReactNode;
  /** Desktop only: host controls beside Leave (End game). */
  actions?: ReactNode;
  /** Desktop: the middle of the bar (Scribble's word). */
  middle?: ReactNode;
  /** A second row inside the bar (Scribble's word on a phone). */
  below?: ReactNode;
}

/**
 * Every game's compact top bar: options, the game's name with the round under it, the timer
 * ring, players and chat. Phones open options from the left; a desktop has its settings,
 * connection state and Leave on the right instead.
 */
export function GameTopBar({ meta, isPhone, testId, className, status, statusTestId = 'round-indicator', statusData, clock, players, chat, menu, extra, actions, middle, below }: Props) {
  const playersLabel = players.label ?? 'Players';
  return (
    <header className={`gbar card${isPhone ? ' gbar--phone' : ''}${middle ? ' gbar--middle' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} data-game={meta.id}>
      <div className="gbar__row">
        {isPhone ? (
          <button type="button" className="icon-btn gbar__btn gbar__menu" onClick={menu.onOpen} aria-haspopup="dialog" aria-expanded={menu.open} aria-label="Options" data-testid="game-menu">
            <MenuIcon size={22} />
          </button>
        ) : (
          <GameMark game={meta} size="sm" />
        )}
        <div className="gbar__title" data-testid={statusTestId} {...statusData}>
          <strong className="gbar__name">{meta.name}</strong>
          <small className="gbar__status">{status}</small>
        </div>
        {middle && <div className="gbar__middle">{middle}</div>}
        {clock && <div className="gbar__clock">{clock}</div>}
        <div className="gbar__side">
          {extra}
          <button
            type="button"
            className="gbar__players"
            onClick={players.onOpen}
            aria-haspopup="dialog"
            aria-expanded={players.open}
            aria-label={`${playersLabel} (${players.count})`}
            data-testid="players-toggle"
          >
            <UsersIcon size={18} />
            <span>{players.count}</span>
          </button>
          {chat && (
            <button type="button" className="icon-btn gbar__btn" onClick={chat.onOpen} aria-haspopup="dialog" aria-expanded={chat.open} aria-label="Chat" data-testid="chat-toggle">
              <ChatIcon size={20} />
            </button>
          )}
          {!isPhone && (
            <>
              <ConnectionPill />
              <SettingsMenu />
              {actions}
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </div>
      {below}
    </header>
  );
}

/** The phone's options sheet behind the top bar's menu button: preferences, the game's own rows, Leave room. */
export function GameMenuSheet({ open, onClose, children }: { open: boolean; onClose(): void; children?: ReactNode }) {
  return (
    <BottomSheet open={open} title="Options" onClose={onClose} testId="menu-sheet">
      <div className="menu-sheet">
        <PreferenceRows />
        {children}
        <button type="button" className="btn btn--ghost btn--block menu-sheet__leave" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave room
        </button>
      </div>
    </BottomSheet>
  );
}
