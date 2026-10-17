import { describe, expect, it } from 'vitest';
import { CHOOSE_TIME_SECONDS } from '../../../shared/games/scribble/constants.js';
import { AWAY_NOTICE_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { GAME_IDS, type GameId } from '../../../shared/platform/games.js';
import type { BlackjackData } from '../../games/blackjack/module.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import type { ScribbleData } from '../../games/scribble/state.js';
import { POINTS_UNDONE_TEXT, RESTARTED_TURN_TEXT } from '../../games/scribble/turns.js';
import { moduleFor } from './module.js';
import { EPOCH_WINDOW_MS, restoreRoomData, shiftEpochTimes } from './restore.js';
import type { PlatformRoomData } from './state.js';
import { START, ctxAt, endGame, sim, standings, startGame, type Sim } from './testHarness.js';
import { gameDeadline, nextDeadline, pendingDeadlines } from './time.js';

const DOWNTIME = 90_000;

/** The room in `s` as a checkpoint issued now would carry it, brought back DOWNTIME later. */
function restoreLater(s: Sim): { data: PlatformRoomData; issuedAt: number; restoredAt: number; effects: ReturnType<typeof restoreRoomData>['effects'] } {
  const issuedAt = s.now;
  const restoredAt = issuedAt + DOWNTIME;
  const { data, effects } = restoreRoomData(JSON.parse(JSON.stringify(s.data)) as PlatformRoomData, issuedAt, ctxAt(restoredAt, s.ids));
  return { data, issuedAt, restoredAt, effects };
}

/** Every seat comes back through its token, as the phones do after the restart. */
function rejoinAll(s: Sim): void {
  for (const p of s.data.players) s.apply({ type: 'rejoin', token: p.token, connectionId: `again-${p.name}` });
}

/** Runs the clocks until the game is over (the host ends one that never ends on its own). */
function playToEnd(s: Sim, gameId: GameId): void {
  if (GAME_TEST_FIXTURES[gameId].endsByHost) endGame(s, s.data.hostId);
  for (let i = 0; i < 500 && s.data.phase === 'playing'; i++) {
    const at = nextDeadline(s.data);
    if (at === null) break;
    s.now = Math.max(s.now, at);
    s.tick();
  }
}

describe('shiftEpochTimes', () => {
  it('moves times near the checkpoint and leaves every other number alone', () => {
    const value = { endsAt: START + 5000, list: [START - 1000, 3, START], remainingMs: 480_000, chips: 100_000, far: START + EPOCH_WINDOW_MS + 1, label: 'x', none: null };
    expect(shiftEpochTimes(value, START, 7)).toEqual({ ...value, endsAt: START + 5007, list: [START - 993, 3, START + 7] });
  });
});

describe.each(GAME_IDS)('restoring a %s room from a checkpoint', (gameId) => {
  it('keeps every seat, token, score and the host, with every seat disconnected and its grace starting now', () => {
    const s = sim(gameId);
    startGame(s, ['Alice', 'Bob', 'Cara']);
    const { data, restoredAt } = restoreLater(s);
    expect(data.code).toBe(s.data.code);
    expect(data.hostId).toBe(s.data.hostId);
    expect(data.returningHostId).toBeNull();
    expect(data.phase).toBe('playing');
    expect(data.players.map((p) => [p.id, p.token, p.score, p.joinOrder, p.participating])).toEqual(s.data.players.map((p) => [p.id, p.token, p.score, p.joinOrder, p.participating]));
    for (const p of data.players) {
      expect(p).toMatchObject({ connected: false, connectionId: null, disconnectedAt: restoredAt, awayNoticeAt: restoredAt + AWAY_NOTICE_MS });
    }
    expect(pendingDeadlines(data).filter((d) => d.kind === 'reconnectExpiry').map((d) => d.at)).toEqual(data.players.map(() => restoredAt + RECONNECT_GRACE_MS));
  });

  it("moves the game's clock on by the downtime", () => {
    const s = sim(gameId);
    startGame(s, ['Alice', 'Bob', 'Cara']);
    const before = gameDeadline(s.data);
    const { data, issuedAt } = restoreLater(s);
    if (moduleFor(gameId).restored) return; // Scribble restarts the turn instead (below).
    expect(data.game).toEqual(shiftEpochTimes(s.data.game, issuedAt, DOWNTIME));
    expect(gameDeadline(data)).toBe(before === null ? null : before + DOWNTIME);
  });

  it('plays on to the end once the phones are back', () => {
    const s = sim(gameId);
    const ids = startGame(s, ['Alice', 'Bob', 'Cara']);
    const scores = s.data.players.map((p) => p.score);
    const { data, restoredAt } = restoreLater(s);
    s.data = data;
    s.now = restoredAt + 1000;
    rejoinAll(s);
    expect(s.data.players.every((p) => p.connected)).toBe(true);
    expect(s.data.players.map((p) => p.score)).toEqual(scores);
    // Back within the away notice: for the game nothing happened.
    expect(s.data.players.every((p) => p.awayNoticeAt === null)).toBe(true);
    playToEnd(s, gameId);
    expect(s.data.phase).toBe('lobby');
    expect(standings(s)?.map((e) => e.playerId).sort()).toEqual([...ids].sort());
  });
});

describe('restoring rooms', () => {
  it('keeps the lobby, its settings and the last results', () => {
    const s = sim('template');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    endGame(s, alice);
    s.platform(alice, { t: 'updateSettings', settings: { contentMode: 'unhinged' } });
    const { data } = restoreLater(s);
    expect(data.phase).toBe('lobby');
    expect(data.settings).toEqual(s.data.settings);
    expect(data.results).toEqual(s.data.results);
    expect(data.players.every((p) => !p.connected && p.awayNoticeAt === null)).toBe(true);
  });

  it('keeps a player already away on the grace they had, moved on by the downtime', () => {
    const s = sim('blackjack');
    const [, bob] = startGame(s, ['Alice', 'Bob', 'Cara']);
    s.drop(bob);
    const droppedAt = s.now;
    s.advance(30_000);
    const { data } = restoreLater(s);
    expect(data.players.find((p) => p.id === bob)).toMatchObject({ connected: false, disconnectedAt: droppedAt + DOWNTIME, awayNoticeAt: null });
  });

  it('moves a Blackjack results pause on by the downtime', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'bet', amount: 10 });
    s.game(bob, { t: 'bet', amount: 10 });
    s.game(alice, { t: 'stand' });
    s.game(bob, { t: 'stand' });
    const game = s.data.game as BlackjackData;
    expect(game.phase.kind).toBe('results');
    const { data } = restoreLater(s);
    expect((data.game as BlackjackData).phase).toEqual({ kind: 'results', endsAt: (game.phase as { endsAt: number }).endsAt + DOWNTIME });
  });

  it("restarts a Scribble turn caught mid-drawing: same drawer, fresh words and canvas, the turn's points taken back", () => {
    const s = sim('scribble');
    const [alice, bob, cara] = startGame(s, ['Alice', 'Bob', 'Cara']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.platform(bob, { t: 'chat', text: 'apple' });
    const before = s.data.game as ScribbleData;
    expect(before.turn?.points[bob]).toBeGreaterThan(0);
    const { data, restoredAt, effects } = restoreLater(s);
    const game = data.game as ScribbleData;
    expect(game.phase).toEqual({ kind: 'choosing', endsAt: restoredAt + CHOOSE_TIME_SECONDS * 1000 });
    expect(game.turn).toMatchObject({ drawerId: alice, word: '', guessed: [alice], points: {} });
    expect(game.turnIndex).toBe(before.turnIndex);
    expect(game.canvasId).not.toBe(before.canvasId);
    expect(effects).toEqual([{ type: 'side', name: 'reset', stamp: game.canvasId }]);
    expect(data.players.map((p) => p.score)).toEqual([0, 0, 0]);
    expect(data.players.find((p) => p.id === cara)?.score).toBe(0);
    // The chat says why the drawer is choosing again and the score went down; phones see it on their welcome.
    expect(data.chat.at(-1)).toMatchObject({ kind: 'system', text: `${RESTARTED_TURN_TEXT} ${POINTS_UNDONE_TEXT}` });
  });

  it('says why a Scribble turn with no points yet starts again', () => {
    const s = sim('scribble');
    startGame(s, ['Alice', 'Bob', 'Cara']);
    const { data } = restoreLater(s);
    expect(data.chat.at(-1)).toMatchObject({ kind: 'system', text: RESTARTED_TURN_TEXT });
  });

  it('gives a Scribble turn whose drawer was already away to the next player', () => {
    const s = sim('scribble');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Cara']);
    s.drop(alice);
    const { data } = restoreLater(s);
    expect((data.game as ScribbleData).turn?.drawerId).toBe(bob);
    expect((data.game as ScribbleData).phase.kind).toBe('choosing');
  });

  it('leaves a Scribble summary as it was, its clock moved on', () => {
    const s = sim('scribble');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.now = gameDeadline(s.data) ?? s.now;
    while ((s.data.game as ScribbleData).phase.kind === 'drawing') {
      s.now = gameDeadline(s.data) ?? s.now;
      s.tick();
    }
    const summary = s.data.game as ScribbleData;
    expect(summary.phase.kind).toBe('turnEnd');
    const { data, effects } = restoreLater(s);
    expect(data.game).toEqual(shiftEpochTimes(summary, s.now, DOWNTIME));
    expect(effects).toEqual([]);
  });
});
