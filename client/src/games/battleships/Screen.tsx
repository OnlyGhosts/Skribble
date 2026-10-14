import type { CSSProperties } from 'react';
import type { BattleshipsSettings, BattleshipsView } from '@shared/games/battleships/protocol';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMark } from '../../platform/components/GameGlyph';
import { Chat } from '../../platform/components/Chat';
import { ConnectionPill } from '../../platform/components/ConnectionPill';
import { DiceIcon, LogoutIcon, MoreIcon, UsersIcon } from '../../platform/components/Icons';
import { PlayerList } from '../../platform/components/PlayerList';
import { PreferenceRows, SettingsMenu } from '../../platform/components/Preferences';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { leaveRoom } from '../../platform/net/actions';
import { useActiveGame } from '../../platform/store/selectors';
import { Board } from './components/Board';
import { ChatIcon, ListIcon, ShipIcon } from './components/Icons';
import { MoveNotice, MovePanel } from './components/MovePanel';
import { PlacementPanel } from './components/PlacementPanel';
import { ShotLog } from './components/ShotLog';
import { Tabs, panelId, tabId, type TabItem } from './components/Tabs';
import { FleetPills, TargetPanel } from './components/TargetPanel';
import { isShooter, isWatching, mySide, nameOf, resolveTab, sideLabel, sideOf } from './hooks';
import { turnKicker } from './lib/text';
import { useBattleships } from './store';

const meta = gameById('battleships');
/** The narrowest phones: the bar drops the game's name and counts shots as '#28'. */
export const NARROW_QUERY = '(max-width: 359px)';

/** The line under the top bar: what is going on and what the viewer should do about it. */
export function statusOf(room: RoomState, view: BattleshipsView, meId: string, holding: boolean): { kicker: string; text: string } {
  if (holding || view.paused) return { kicker: 'Paused', text: 'Waiting for players to come back…' };
  const watching = isWatching(view, meId);
  switch (view.phase) {
    case 'placing': {
      const side = mySide(view);
      if (!side) return { kicker: 'Placing', text: 'The fleets are taking their positions.' };
      if (side.ready) return { kicker: 'Placing', text: 'Your fleet is in position. Waiting for the others…' };
      if (side.captainId === meId) return { kicker: 'Placing', text: view.mode === 'teams' ? "You're the captain: place your team's ships." : 'Place your ships before the clock runs out.' };
      return { kicker: 'Placing', text: `${nameOf(room, side.captainId)} is placing your team's ships.` };
    }
    case 'playing':
    case 'moving': {
      const shooter = view.turn ? nameOf(room, view.turn.shooterId) : 'Someone';
      const team = view.mode === 'teams' && view.turn ? `Team ${view.turn.sideId}: ` : '';
      if (view.phase === 'moving') return isShooter(view, meId) ? { kicker: `You rolled a ${view.dice}`, text: 'Move a ship below the board, or keep them put.' } : { kicker: `${team}${shooter}`, text: 'may be moving a ship…' };
      if (isShooter(view, meId)) return { kicker: 'Your turn', text: 'Pick an enemy grid and tap a cell to aim.' };
      if (watching) return { kicker: `${team}${shooter}`, text: 'is taking aim. You are watching.' };
      return { kicker: `${team}${shooter}`, text: 'is taking aim…' };
    }
    case 'gameOver':
      return view.winnerSideId ? { kicker: 'Game over', text: `${sideLabel(room, view, view.winnerSideId)} wins with the last fleet afloat!` } : { kicker: 'Game over', text: 'No fleet is left afloat.' };
  }
}

/**
 * The Battleships screen: a compact top bar (turn, the clock, players, chat, options) over one
 * column that scrolls: the status line, the tabs (the own fleet and one per enemy grid), the grid
 * on show with its controls (the placement tray, Fire, the move window under the own board) and
 * the shot log in a sheet. Desktop adds the players and the log on the left and the chat on the
 * right; a phone on its side puts the tabs and the controls beside the board.
 */
export function BattleshipsScreen({ room, meId, isHost }: GameScreenProps<BattleshipsView, BattleshipsSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  useAppMode(isPhone);
  const sheet = useBattleships((s) => s.sheet);
  const openSheet = useBattleships((s) => s.openSheet);
  const tab = useBattleships((s) => s.tab);
  const selectTab = useBattleships((s) => s.selectTab);
  const highlight = useBattleships((s) => s.highlight);
  const closeSheet = () => openSheet(null);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const paused = holding || view.paused;
  const myTurn = isShooter(view, meId);
  const active = resolveTab(view, tab);
  const activeKey = active ?? 'mine';
  const target = active === null ? null : view.targets.find((t) => t.sideId === active) ?? null;
  const side = mySide(view);
  const status = statusOf(room, view, meId, holding);
  const endsAt = playing && !paused ? view.endsAt : null;
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const log = <ShotLog room={room} view={view} />;
  const style = { '--bs-accent': meta.accent } as CSSProperties;
  const moving = playing && view.phase === 'moving';
  const readyCount = view.sides.filter((s) => s.ready).length;

  const tabs: TabItem[] = [
    ...(view.myBoard ? [{ key: 'mine', label: view.mode === 'teams' ? 'Our fleet' : 'My fleet', data: { 'data-side': 'mine' } }] : []),
    ...view.targets.map((t): TabItem => {
      const alive = sideOf(view, t.sideId)?.alive ?? false;
      const turnHere = view.turn?.sideId === t.sideId;
      return {
        key: t.sideId,
        className: `${alive ? '' : 'bs-tab--out'}${turnHere ? ' bs-tab--turn' : ''}`.trim(),
        label: (
          <>
            {sideLabel(room, view, t.sideId)}
            <small>{view.phase === 'placing' ? (sideOf(view, t.sideId)?.ready ? 'ready' : '…') : alive ? `${t.shipsLeft}/${t.shipsTotal}` : 'out'}</small>
          </>
        ),
        data: { 'data-side': t.sideId, 'data-alive': String(alive) },
      };
    }),
  ];

  const playersButton = (
    <button type="button" className="bs__players-btn" onClick={() => openSheet('players')} aria-haspopup="dialog" aria-expanded={sheet === 'players'} aria-label={`Players (${room.players.length})`} data-testid="players-toggle">
      <UsersIcon size={18} />
      <span>{room.players.length}</span>
    </button>
  );

  return (
    <div
      className={`bs${isPhone ? ' bs--phone' : ''}`}
      style={style}
      data-testid="battleships-screen"
      data-phase={view.phase}
      data-mode={view.mode}
      data-turn-number={view.turnNumber}
      data-my-turn={myTurn ? 'true' : undefined}
      data-side={view.mySideId ?? undefined}
    >
      <header className="bs__top card" data-testid="battleships-header">
        <div className="bs__brand">
          {!isPhone && (
            <GameMark game={meta} size="sm" />
          )}
          <div className="bs__turn" data-testid="turn-indicator" data-turn={view.turnNumber}>
            <strong>{turnKicker(view.phase, view.turnNumber, narrow, isPhone)}</strong>
            {!narrow && <small>{meta.name}</small>}
          </div>
        </div>
        <div className="bs__clock">
          <Timer endsAt={endsAt} paused={paused} warnUnder={view.phase === 'placing' ? 10 : 5} tickUnder={myTurn && view.phase === 'playing' ? 5 : undefined} />
        </div>
        <div className="bs__side">
          {playersButton}
          {isPhone ? (
            <>
              <button type="button" className="icon-btn bs__icon-btn" onClick={() => openSheet('log')} aria-haspopup="dialog" aria-expanded={sheet === 'log'} aria-label="Shot log" data-testid="log-toggle">
                <ListIcon size={20} />
              </button>
              <button type="button" className="icon-btn bs__icon-btn" onClick={() => openSheet('chat')} aria-haspopup="dialog" aria-expanded={sheet === 'chat'} aria-label="Chat" data-testid="chat-toggle">
                <ChatIcon size={20} />
              </button>
              <button type="button" className="icon-btn bs__icon-btn" onClick={() => openSheet('menu')} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label="More options" data-testid="game-menu">
                <MoreIcon size={20} />
              </button>
            </>
          ) : (
            <>
              <ConnectionPill />
              <SettingsMenu />
              <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room" aria-label="Leave room">
                <LogoutIcon size={16} /> <span className="hide-mobile">Leave</span>
              </button>
            </>
          )}
        </div>
      </header>

      {!isPhone && (
        <aside className="bs__left">
          <section className="bs__players card" aria-label="Players">
            <div className="bs__players-body">{players}</div>
          </section>
          <section className="bs__log card" aria-label="Shot log">
            <h2 className="bs__log-title">Shot log</h2>
            <div className="bs__log-body">{log}</div>
          </section>
        </aside>
      )}

      <main className="bs__main" data-testid="battleships-main">
        <div className="bs__scroll" data-testid="battleships-column">
          <div className="bs__strip">
            <div className={`bs-status${myTurn && view.phase === 'playing' ? ' bs-status--mine' : ''}`} role="status" data-testid="status" data-kicker={status.kicker}>
              <strong>{status.kicker}</strong>
              <span>{status.text}</span>
              {view.phase === 'placing' && (
                <span className="bs-status__count" data-testid="ready-count" data-ready={readyCount} data-total={view.sides.length}>
                  {`${readyCount}/${view.sides.length} in position`}
                </span>
              )}
              {view.dice !== null && (
                <span className="bs-dice" aria-label={`Last roll: ${view.dice}`} data-testid="dice" data-value={view.dice}>
                  <DiceIcon size={14} /> {view.dice}
                </span>
              )}
            </div>
            {side && !side.alive && (
              <div className="banner bs-banner bs-banner--out" role="status" data-testid="eliminated-banner">
                Your fleet is sunk. Watch the rest of the battle from here.
              </div>
            )}
            {view.mode === 'teams' && (
              <ul className="bs-teams" aria-label="Teams" data-testid="teams">
                {view.sides.map((s) => (
                  <li key={s.id} className={`bs-teams__team${s.id === view.mySideId ? ' bs-teams__team--mine' : ''}${s.alive ? '' : ' bs-teams__team--out'}`} data-testid="team" data-team={s.id}>
                    <strong>Team {s.id}</strong>
                    <span>{s.memberIds.map((id) => nameOf(room, id)).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
            {moving && !myTurn && <MoveNotice room={room} view={view} paused={paused} />}
            <Tabs items={tabs} activeKey={activeKey} onSelect={(key) => selectTab(key === 'mine' ? null : key)} />
          </div>
          <div className="bs__panel" role="tabpanel" id={panelId(activeKey)} aria-labelledby={tabId(activeKey)} data-testid="tabpanel">
            {active === null && view.myBoard && view.phase === 'placing' && <PlacementPanel room={room} view={view} board={view.myBoard} meId={meId} />}
            {active === null && view.myBoard && view.phase !== 'placing' && (
              <section className="bs-own card" data-testid="own-fleet">
                <header className="bs-target__head">
                  <div className="bs-target__who">
                    <strong>{view.mode === 'teams' ? `Team ${view.mySideId}` : 'Your waters'}</strong>
                    <small data-testid="my-ships-left" data-left={side?.shipsLeft ?? 0}>
                      {side?.alive ? `${side.shipsLeft} of ${view.fleet.length} ships afloat` : 'Fleet sunk'}
                    </small>
                  </div>
                  <FleetPills fleet={view.fleet} sunkLengths={view.myBoard.ships.filter((s) => s.sunk).map((s) => s.length)} testId="my-fleet" />
                </header>
                <Board
                  size={view.boardSize}
                  shots={view.myBoard.shots}
                  ships={view.myBoard.ships.map((s) => ({ ...s, selected: moving && s.id === highlight }))}
                  fresh={view.lastShot && view.lastShot.targetId === view.mySideId ? view.lastShot : null}
                  testId="own-board"
                  label="Your board"
                />
              </section>
            )}
            {target && <TargetPanel room={room} view={view} target={target} meId={meId} holding={holding} />}
            {moving && myTurn && <MovePanel view={view} board={view.myBoard} meId={meId} paused={paused} />}
          </div>
        </div>
      </main>

      {!isPhone && (
        <aside className="bs__chat card" aria-label="Chat">
          <Chat />
        </aside>
      )}

      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      <BottomSheet open={sheet === 'log'} title="Shot log" onClose={closeSheet} testId="log-sheet">
        {log}
      </BottomSheet>
      {isPhone && (
        <>
          <BottomSheet open={sheet === 'chat'} title="Chat" onClose={closeSheet} testId="chat-sheet">
            <div className="bs__chat-sheet">
              <Chat />
            </div>
          </BottomSheet>
          <BottomSheet open={sheet === 'menu'} title="Options" onClose={closeSheet} testId="menu-sheet">
            <div className="menu-sheet">
              <PreferenceRows />
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
