import { useState, type ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { leaveRoom } from '../net/actions';
import { registeredGame } from '../registry';
import { BottomSheet } from './BottomSheet';
import { ConnectionPill } from './ConnectionPill';
import { BackIcon, LogoutIcon, MenuIcon, UsersIcon } from './Icons';
import { LeaveConfirm } from './LeaveConfirm';
import { PlayerChips } from './PlayerChips';
import { PreferenceRows, SettingsMenu } from './Preferences';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Toggle {
  open: boolean;
  onOpen(): void;
}

interface Props {
  meta: GameMeta;
  /** The room, for the player chips. */
  room: RoomState;
  isPhone: boolean;
  testId: string;
  /** The game layout's own class for the bar (its grid placement). */
  className?: string;
  /** Right of the game's name: the round, turn or hand. */
  status: ReactNode;
  /** Test id and data attributes of the status ('round-indicator' by default). */
  statusTestId?: string;
  statusData?: DataAttrs;
  /** The timer ring, at the end of the players row. */
  clock?: ReactNode;
  /** The players sheet the chips open. */
  players: Toggle & { label?: string };
  /** The phone's options sheet (theme, sound, the game's host controls, Leave). */
  menu: Toggle;
  /** Desktop only: host controls beside the gear (End game). */
  actions?: ReactNode;
  /** Desktop: between the name and the round (Scribble's word). */
  middle?: ReactNode;
  /** A last row inside the bar (Scribble's word on a phone). */
  below?: ReactNode;
  /**
   * One row only (a card table on a phone, whose players are all on the table; The Spy Game on a
   * phone, which lists its players below): the player chips give way to a players button with the
   * count, and the clock, if any, sits small in the row.
   */
  compact?: boolean;
}

/**
 * Every game's top bar, as on the brand board: a back arrow (leaving asks first), the game's name
 * large and the round on the right, then a row of player chips with the timer ring at its end.
 * The options button is a small icon button on the first row of a phone; a desktop has the gear and
 * the host's controls there instead of the options sheet.
 */
export function GameTopBar({ meta, room, isPhone, testId, className, status, statusTestId = 'round-indicator', statusData, clock, players, menu, actions, middle, below, compact = false }: Props) {
  const game = registeredGame(room.gameId);
  const [leaving, setLeaving] = useState(false);
  return (
    <>
      <header className={`gbar card${isPhone ? ' gbar--phone' : ''}${compact ? ' gbar--compact' : ''}${middle ? ' gbar--middle' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} data-game={meta.id}>
        <div className="gbar__row">
          <button
            type="button"
            className="icon-btn gbar__btn gbar__back"
            onClick={() => setLeaving(true)}
            aria-haspopup="dialog"
            aria-expanded={leaving}
            aria-label="Leave game"
            data-testid="game-back"
          >
            <BackIcon size={24} />
          </button>
          <strong className="gbar__name">{meta.name}</strong>
          {middle && <div className="gbar__middle">{middle}</div>}
          <span className="gbar__status" data-testid={statusTestId} {...statusData}>
            {status}
          </span>
          <div className="gbar__side">
            {compact && clock && <div className="gbar__clock gbar__clock--row">{clock}</div>}
            {compact && (
              <button
                type="button"
                className="icon-btn gbar__btn gbar__count"
                onClick={players.onOpen}
                aria-haspopup="dialog"
                aria-expanded={players.open}
                aria-label={`${players.label ?? 'Players'} (${room.players.length})`}
                data-testid="players-toggle"
              >
                <UsersIcon size={18} />
                <span className="gbar__count-n">{room.players.length}</span>
              </button>
            )}
            {isPhone ? (
              <button type="button" className="icon-btn gbar__btn" onClick={menu.onOpen} aria-haspopup="dialog" aria-expanded={menu.open} aria-label="Options" data-testid="game-menu">
                <MenuIcon size={20} />
              </button>
            ) : (
              <>
                <ConnectionPill />
                {actions}
                <SettingsMenu />
              </>
            )}
          </div>
        </div>
        {!compact && (
          <div className="gbar__people">
            <PlayerChips room={room} game={game} open={players.open} onOpen={players.onOpen} label={players.label ?? 'Players'} />
            {clock && <div className="gbar__clock">{clock}</div>}
          </div>
        )}
        {below}
      </header>
      <BottomSheet open={leaving} title="Leave" onClose={() => setLeaving(false)} testId="leave-sheet">
        <LeaveConfirm onStay={() => setLeaving(false)} testId="game-leave" />
      </BottomSheet>
    </>
  );
}

/**
 * The part of a status the narrowest phones leave out so the game's name stays whole: wrap
 * "Round " in it and "Round 1/5" reads "1/5" there.
 */
export function Wide({ children }: { children: ReactNode }) {
  return <span className="gbar__wide">{children}</span>;
}

/** "Round 1/5" (just "1/5" on the narrowest phones). */
export function RoundStatus({ round, total }: { round: number; total: number }) {
  return (
    <>
      <Wide>Round </Wide>
      {round}/{total}
    </>
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
