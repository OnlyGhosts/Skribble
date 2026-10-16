import { useState, type ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { useLive } from '../lib/useLive';
import { registeredGame } from '../registry';
import { selectIsHost } from '../store/selectors';
import { usePlatformStore } from '../store/usePlatformStore';
import { BottomSheet } from './BottomSheet';
import { ConnectionPill } from './ConnectionPill';
import { EndGameButton, EndGameConfirm, ExitActions, LeaveConfirm, canEndGame, type ExitKind } from './GameExit';
import { BackIcon, FlagIcon, LogoutIcon, MenuIcon, UsersIcon } from './Icons';
import { PlayerChips } from './PlayerChips';
import { PreferenceRows, SettingsMenu, type MenuAction } from './Preferences';

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
  /** The phone's options sheet (theme, sound, the game's own rows, End game and Leave room). */
  menu: Toggle;
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
 * The options button is a small icon button on the first row of a phone; a desktop has the host's
 * End game and the gear (preferences, End game, Leave room) there instead of the options sheet.
 */
export function GameTopBar({ meta, room, isPhone, testId, className, status, statusTestId = 'round-indicator', statusData, clock, players, menu, middle, below, compact = false }: Props) {
  const game = registeredGame(room.gameId);
  const meId = useLive(usePlatformStore, (s) => s.playerId);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const [exit, setExit] = useState<ExitKind | null>(null);
  const closeExit = () => setExit(null);
  const hostCanEnd = canEndGame(room, isHost);
  const menuActions: MenuAction[] = [
    ...(hostCanEnd && !room.endRequested ? [{ label: 'End game', icon: <FlagIcon size={16} />, onSelect: () => setExit('end'), testId: 'menu-end-game', tone: 'danger' as const }] : []),
    { label: 'Leave room', icon: <LogoutIcon size={16} />, onSelect: () => setExit('leave'), testId: 'menu-leave-room' },
  ];
  return (
    <>
      <header className={`gbar card${isPhone ? ' gbar--phone' : ''}${compact ? ' gbar--compact' : ''}${middle ? ' gbar--middle' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} data-game={meta.id}>
        <div className="gbar__row">
          <button
            type="button"
            className="icon-btn gbar__btn gbar__back"
            onClick={() => setExit('leave')}
            aria-haspopup="dialog"
            aria-expanded={exit === 'leave'}
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
                {hostCanEnd && <EndGameButton room={room} open={exit === 'end'} onOpen={() => setExit('end')} />}
                <SettingsMenu actions={menuActions} />
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
      <BottomSheet open={exit === 'leave'} title="Leave room" onClose={closeExit} testId="leave-sheet" className="sheet--exit">
        <LeaveConfirm room={room} meId={meId} onCancel={closeExit} testId="game-leave" />
      </BottomSheet>
      <BottomSheet open={exit === 'end' && hostCanEnd} title="End game" onClose={closeExit} testId="end-sheet" className="sheet--exit">
        <EndGameConfirm room={room} onCancel={closeExit} testId="end-game" />
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

/**
 * The phone's options sheet behind the top bar's menu button: preferences, the game's own rows,
 * then the ways out (End game for the host, Leave room), each behind its confirm step.
 */
export function GameMenuSheet({ open, onClose, children }: { open: boolean; onClose(): void; children?: ReactNode }) {
  const room = useLive(usePlatformStore, (s) => s.room);
  const meId = useLive(usePlatformStore, (s) => s.playerId);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const [confirm, setConfirm] = useState<ExitKind | null>(null);
  const close = () => {
    setConfirm(null);
    onClose();
  };
  // A step whose action went away (the game ended, the host role moved) falls back to the menu.
  const step = confirm === 'end' && !canEndGame(room, isHost) ? null : confirm;
  return (
    <BottomSheet open={open} title={step === 'end' ? 'End game' : step === 'leave' ? 'Leave room' : 'Options'} onClose={close} testId="menu-sheet">
      <div className="menu-sheet">
        {step === 'end' ? (
          <EndGameConfirm room={room} onCancel={close} testId="end-game" />
        ) : step === 'leave' ? (
          <LeaveConfirm room={room} meId={meId} onCancel={() => setConfirm(null)} testId="game-leave" />
        ) : (
          <>
            <PreferenceRows />
            {children}
            <ExitActions room={room} isHost={isHost} onPick={setConfirm} />
          </>
        )}
      </div>
    </BottomSheet>
  );
}
