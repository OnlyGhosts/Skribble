import { useEffect, type CSSProperties } from 'react';
import type { BattleshipsSettings, BattleshipsView } from '@shared/games/battleships/protocol';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { Chat } from '../../platform/components/Chat';
import { GameMenuSheet, GameTopBar } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, prefersReducedMotion, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { backToChoice, chooseFire, chooseMove, pickShipToMove, type MoveContext } from './actions';
import { Board, type BoardGhost } from './components/Board';
import { Die } from './components/Die';
import { ListIcon } from './components/Icons';
import { MovePanel } from './components/MovePanel';
import { PlacementPanel } from './components/PlacementPanel';
import { ShotLog } from './components/ShotLog';
import { Tabs, panelId, tabId, type TabItem } from './components/Tabs';
import { FleetPills, TargetPanel } from './components/TargetPanel';
import { TurnChoice } from './components/TurnChoice';
import { isShooter, isWatching, mySide, nameOf, resolveTab, sideLabel, sideOf, targetForTurn, turnKey, turnModeOf } from './hooks';
import { confirmProblem, ghostOf, moveUnavailable } from './lib/moveDraft';
import { turnKicker } from './lib/text';
import { useBattleships, useBattleshipsStore, type RollStage, type TurnMode } from './store';

const meta = gameById('battleships');

/** How long the die tumbles, and how long "rolled a 4" stays up before "is deciding". */
export const ROLL_MS = 700;
export const ROLLED_MS = 1200;

function squares(n: number): string {
  return `${n} ${n === 1 ? 'square' : 'squares'}`;
}

/** What the viewer is doing with their turn and how far the roll's reveal has got. */
export interface TurnState {
  mode: TurnMode;
  stage: RollStage | null;
}

/** The line under the top bar: what is going on and what the viewer should do about it. */
export function statusOf(room: RoomState, view: BattleshipsView, meId: string, holding: boolean, turn: TurnState = { mode: 'fire', stage: null }): { kicker: string; text: string } {
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
    case 'playing': {
      const roll = view.turn?.roll ?? null;
      if (isShooter(view, meId)) {
        if (roll === null || turn.mode === 'fire') return { kicker: 'Your turn', text: 'Pick an enemy grid and tap a cell to aim.' };
        if (turn.stage === 'rolling') return { kicker: 'Your turn', text: 'Rolling the die…' };
        if (turn.mode === 'move') return { kicker: 'Your turn', text: `Move a ship up to ${squares(roll)}, or turn it.` };
        return { kicker: 'Your turn', text: `You rolled a ${roll}. Fire or move?` };
      }
      const shooter = view.turn ? nameOf(room, view.turn.shooterId) : 'Someone';
      const team = view.mode === 'teams' && view.turn ? `Team ${view.turn.sideId}: ` : '';
      const kicker = `${team}${shooter}`;
      if (roll === null) return { kicker, text: watching ? 'is taking aim. You are watching.' : 'is taking aim…' };
      if (turn.stage === 'rolling') return { kicker, text: 'is rolling the die…' };
      if (turn.stage === 'rolled') return { kicker, text: `rolled a ${roll}.` };
      if (view.myBoard?.plan && view.turn?.sideId === view.mySideId) return { kicker, text: 'is moving one of your ships…' };
      return { kicker, text: 'is deciding…' };
    }
    case 'gameOver':
      return view.winnerSideId ? { kicker: 'Game over', text: `${sideLabel(room, view, view.winnerSideId)} wins with the last fleet afloat!` } : { kicker: 'Game over', text: 'No fleet is left afloat.' };
  }
}

function setStageIf(key: string, stage: RollStage): void {
  const store = useBattleshipsStore.getState();
  if (store.roll.key === key && store.roll.stage !== 'deciding') store.setRollStage(key, stage);
}

/**
 * Plays the roll's reveal once per turn for every viewer: the die tumbles, lands ("rolled a 4"),
 * then the shooter is shown deciding. Reduced motion lands the die at once.
 */
function useRollStage(view: BattleshipsView | null): RollStage | null {
  const key = view ? turnKey(view) : '';
  const roll = view?.phase === 'playing' ? (view.turn?.roll ?? null) : null;
  const stage = useBattleships((s) => (s.roll.key === key ? s.roll.stage : 'rolling'));
  useEffect(() => {
    if (roll === null || key === '') return;
    const store = useBattleshipsStore.getState();
    const current = store.roll.key === key ? store.roll.stage : null;
    if (current === 'deciding') return;
    const reduced = prefersReducedMotion();
    if (current === null) store.setRollStage(key, reduced ? 'rolled' : 'rolling');
    const landAt = current === 'rolled' || reduced ? 0 : ROLL_MS;
    const timers = [window.setTimeout(() => setStageIf(key, 'rolled'), landAt), window.setTimeout(() => setStageIf(key, 'deciding'), landAt + ROLLED_MS)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [key, roll]);
  return roll === null ? null : stage;
}

/**
 * The Battleships screen: a compact top bar (turn, the clock, players, chat, options) over one
 * column that scrolls: the status line with the turn's die, the tabs (the own fleet and one per
 * enemy grid), the shooter's Fire or Move choice, the grid on show with its controls (the
 * placement tray, Fire, the move controls under the own board) and the shot log in a sheet. Desktop adds the players and the log on the left and the chat on the
 * right; a phone on its side puts the tabs and the controls beside the board.
 */
export function BattleshipsScreen({ room, meId, isHost }: GameScreenProps<BattleshipsView, BattleshipsSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const sheet = useBattleships((s) => s.sheet);
  const openSheet = useBattleships((s) => s.openSheet);
  const tab = useBattleships((s) => s.tab);
  const selectTab = useBattleships((s) => s.selectTab);
  const draft = useBattleships((s) => s.turn);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const closeSheet = () => openSheet(null);
  const stage = useRollStage(room.game);

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
  const mode = turnModeOf(view, draft);
  const status = statusOf(room, view, meId, holding, { mode, stage });
  const endsAt = playing && !paused ? view.endsAt : null;
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const log = <ShotLog room={room} view={view} />;
  const style = { '--bs-accent': meta.accent } as CSSProperties;
  const roll = view.phase === 'playing' ? (view.turn?.roll ?? null) : null;
  const board = view.myBoard;
  const moveCtx: MoveContext | null =
    board && roll !== null ? { ships: board.ships, size: view.boardSize, shots: board.shots, roll, share: (side?.memberIds.length ?? 0) > 1 } : null;
  const live = myTurn && view.phase === 'playing' && !paused;
  const choosing = live && moveCtx !== null && mode === 'choose';
  const moving = live && moveCtx !== null && mode === 'move';
  const moveBlocked = moveCtx && view.turn ? moveUnavailable(view.turn.canMove, side?.movedLastTurn ?? false, moveCtx.ships, moveCtx.size, moveCtx.shots, moveCtx.roll) : null;
  // The ship picked to move and its ghost: the shooter's own draft, or for a teammate the plan the shooter shares.
  const plan = moving ? { shipId: draft.shipId, move: draft.move } : !myTurn && view.turn?.sideId === view.mySideId ? (board?.plan ?? null) : null;
  const planned = plan && board ? (board.ships.find((s) => s.id === plan.shipId) ?? null) : null;
  const ghost: BoardGhost | null =
    planned && plan?.move && moveCtx ? { ship: ghostOf(planned, plan.move), problem: confirmProblem(moveCtx.ships, planned.id, plan.move, moveCtx.size, moveCtx.shots, moveCtx.roll) } : null;
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

  return (
    <div
      className={`bs${isPhone ? ' bs--phone' : ''}`}
      style={style}
      data-testid="battleships-screen"
      data-phase={view.phase}
      data-mode={view.mode}
      data-turn-number={view.turnNumber}
      data-my-turn={myTurn ? 'true' : undefined}
      data-turn-mode={myTurn && view.phase === 'playing' ? mode : undefined}
      data-side={view.mySideId ?? undefined}
    >
      <GameTopBar
        meta={meta}
        isPhone={isPhone}
        testId="battleships-header"
        className="bs__top"
        status={turnKicker(view.phase, view.turnNumber)}
        statusTestId="turn-indicator"
        statusData={{ 'data-turn': view.turnNumber }}
        clock={<Timer endsAt={endsAt} paused={paused} warnUnder={view.phase === 'placing' ? 10 : 5} tickUnder={myTurn && view.phase === 'playing' ? 5 : undefined} />}
        players={{ count: room.players.length, open: sheet === 'players', onOpen: () => openSheet('players') }}
        chat={isPhone ? { open: sheet === 'chat', onOpen: () => openSheet('chat') } : undefined}
        menu={{ open: sheet === 'menu', onOpen: () => openSheet('menu') }}
      />

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
              <p className="bs-status__line">
                <strong>{status.kicker}</strong> <span data-testid="status-text">{status.text}</span>
              </p>
              {view.phase === 'placing' && (
                <span className="bs-status__count" data-testid="ready-count" data-ready={readyCount} data-total={view.sides.length}>
                  {`${readyCount}/${view.sides.length} in position`}
                </span>
              )}
              {roll !== null && <Die value={roll} rolling={stage === 'rolling'} testId="dice" />}
              {isPhone && view.phase !== 'placing' && (
                <button type="button" className="icon-btn bs-status__log" onClick={() => openSheet('log')} aria-haspopup="dialog" aria-expanded={sheet === 'log'} aria-label="Shot log" data-testid="log-toggle">
                  <ListIcon size={20} />
                </button>
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
            <Tabs items={tabs} activeKey={activeKey} onSelect={(key) => selectTab(key === 'mine' ? null : key)} />
          </div>
          <div className="bs__panel" role="tabpanel" id={panelId(activeKey)} aria-labelledby={tabId(activeKey)} data-testid="tabpanel">
            {choosing && roll !== null && (
              <TurnChoice roll={roll} stage={stage ?? 'deciding'} moveBlocked={moveBlocked} onFire={() => chooseFire(targetForTurn(view, active))} onMove={chooseMove} />
            )}
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
                  ships={view.myBoard.ships.map((s) => ({ ...s, selected: s.id === planned?.id }))}
                  fresh={view.lastShot && view.lastShot.targetId === view.mySideId ? view.lastShot : null}
                  ghost={ghost}
                  onCell={moving && moveCtx ? (x, y) => pickShipToMove(x, y, moveCtx) : undefined}
                  testId="own-board"
                  label="Your board"
                />
              </section>
            )}
            {target && (
              <TargetPanel room={room} view={view} target={target} meId={meId} holding={holding} aiming={mode === 'fire'} onBack={moveCtx && view.moveOrFire ? () => backToChoice(moveCtx) : undefined} />
            )}
            {moving && moveCtx && active === null && <MovePanel draft={draft} ctx={moveCtx} connected={connected} />}
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
          <GameMenuSheet open={sheet === 'menu'} onClose={closeSheet} />
        </>
      )}
    </div>
  );
}
