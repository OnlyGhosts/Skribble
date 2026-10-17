import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { CanvasAction, DrawOp, ScribbleClientMessage, ScribbleRoomState } from '@shared/games/scribble/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { scribbleClient } = await import('./module');
const { useScribbleStore } = await import('./store');
const { scribbleCanvas, myDrawingTurn } = await import('./canvas');
const { DrawQueue } = await import('../../platform/canvas');
const { GuessInput } = await import('./components/GuessInput');
const { WordDisplay } = await import('./components/WordDisplay');
const { ScribbleSettingsFields } = await import('./components/SettingsFields');
const { ScribbleScreen } = await import('./Screen');
const { guessBoxLine } = await import('./lib/format');
const { GuessBox } = await import('./components/GuessBox');
const { GuessFeed } = await import('./components/GuessFeed');
const { chatLine, player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const { drawingPhase, inTurn, resetScribbleStore } = await import('./test/fixtures');

const stroke = (id: number): CanvasAction => ({ kind: 'stroke', id, tool: 'brush', color: '#000000', size: 6, points: [1, 1, 2, 2], done: true });
const scribble = () => useScribbleStore.getState();
const canvas = () => scribbleCanvas.store.getState();
const platform = () => usePlatformStore.getState();

/** Feeds a welcome or snapshot the way the socket does: store first, then the module hooks. */
function enter(roomState: ScribbleRoomState, playerId = 'bob', extra?: unknown): void {
  const prev = platform().playerId === playerId ? platform().room : null;
  platform().handleServerMessage(welcome(playerId, roomState, `tok-${playerId}`, extra));
  scribbleClient.onWelcome?.(extra);
  scribbleClient.onRoom?.(roomState, prev);
}

function snapshot(roomState: ScribbleRoomState): void {
  const prev = platform().room;
  platform().handleServerMessage({ t: 'room', room: roomState });
  scribbleClient.onRoom?.(roomState, prev);
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

beforeEach(() => {
  resetStore();
  resetScribbleStore();
  setLocation('/');
  registerGames(registryOf(scribbleClient));
});

describe('welcome and the guess draft', () => {
  const turn = () => inTurn(drawingPhase('host'));

  it('restores the canvas from welcome.extra and keeps a half-typed guess across a rejoin into the same turn', () => {
    enter(turn(), 'bob', { canvas: [stroke(1)] });
    expect(canvas().canvas).toHaveLength(1);
    scribble().setGuessDraft('ab');
    enter(turn(), 'bob', { canvas: [stroke(1), stroke(2)] });
    expect(scribble().guessDraft).toBe('ab');
    expect(canvas().canvas).toHaveLength(2);
  });

  it('clears the draft when the rejoin lands in another turn or seat', () => {
    enter(turn());
    scribble().setGuessDraft('ab');
    enter(inTurn(drawingPhase('bob'), { turn: 2 }));
    expect(scribble().guessDraft).toBe('');

    scribble().setGuessDraft('cd');
    enter(inTurn(drawingPhase('bob'), { turn: 2 }), 'carol');
    expect(scribble().guessDraft).toBe('');
  });

  it('starts every turn and the lobby on a blank canvas and an empty draft', () => {
    enter(turn(), 'bob', { canvas: [stroke(1)] });
    scribble().setGuessDraft('ab');
    snapshot(inTurn({ kind: 'choosing', drawerId: 'bob', endsAt: Date.now() + 15_000 }, { turn: 2 }));
    expect(canvas().canvas).toEqual([]);
    expect(scribble().guessDraft).toBe('');
    canvas().appendOps([{ k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 }]);
    snapshot(room() as ScribbleRoomState);
    expect(canvas().canvas).toEqual([]);
  });
});

describe('undo and clear', () => {
  const turn = (drawerId: string) => inTurn(drawingPhase(drawerId));

  it('the drawer applies undo locally and ignores the echo, so a stroke started meanwhile survives', () => {
    enter(turn('bob'));
    canvas().appendOps([
      { k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 },
      { k: 'end', id: 1 },
      { k: 'start', id: 2, tool: 'brush', color: '#000000', size: 6, x: 5, y: 5 },
      { k: 'end', id: 2 },
    ]);
    const epoch = canvas().canvasEpoch;
    canvas().undo(); // what undoStroke() does when the undo was sent
    expect(canvas().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1]);
    expect(canvas().canvasEpoch).toBe(epoch + 1);

    // The drawer starts stroke 3 before the server's echo arrives.
    canvas().appendOps([{ k: 'start', id: 3, tool: 'brush', color: '#000000', size: 6, x: 9, y: 9 }]);
    expect(scribbleClient.onServerMessage?.({ t: 'undo' })).toBe(true);
    expect(canvas().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1, 3]);
    scribbleClient.onServerMessage?.({ t: 'clear' });
    expect(canvas().canvas).toHaveLength(2);
  });

  it('a guesser applies the broadcast undo, clear and resync', () => {
    enter(turn('host'), 'bob', { canvas: [stroke(1), stroke(2)] });
    scribbleClient.onServerMessage?.({ t: 'undo' });
    expect(canvas().canvas).toHaveLength(1);
    scribbleClient.onServerMessage?.({ t: 'clear' });
    expect(canvas().canvas).toHaveLength(0);
    scribbleClient.onServerMessage?.({ t: 'canvas', actions: [stroke(7)] });
    expect(canvas().canvas).toHaveLength(1);
    expect(scribbleClient.onServerMessage?.({ t: 'somethingElse' })).toBe(false);
  });
});

describe('drawing through an outage', () => {
  const ops: DrawOp[] = [
    { k: 'start', id: 0, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 },
    { k: 'move', id: 0, pts: [2, 2, 3, 3] },
    { k: 'end', id: 0 },
  ];
  const turn = () => inTurn(drawingPhase('bob', { word: 'apple' }));

  function queueFor(open: { value: boolean }) {
    const sent: ScribbleClientMessage[] = [];
    const queue = new DrawQueue({ send: (m) => (open.value ? (sent.push(m), true) : false), isOpen: () => open.value }, () => myDrawingTurn(platform()));
    return { queue, sent };
  }

  it('keeps the drawer’s ops while the socket is down and sends them after rejoining the same turn', () => {
    vi.useFakeTimers();
    const open = { value: false };
    const { queue, sent } = queueFor(open);
    enter(turn());
    queue.queue(ops);
    queue.flush();
    expect(sent).toEqual([]);
    open.value = true;
    enter(turn());
    canvas().appendOps(queue.resume(myDrawingTurn(platform()), []));
    expect(sent).toEqual([{ t: 'draw', ops }]);
    expect(canvas().canvas).toHaveLength(1);
    vi.useRealTimers();
  });

  it('discards the parked ops when the turn has moved on', () => {
    const open = { value: false };
    const { queue, sent } = queueFor(open);
    enter(turn());
    queue.queue(ops);
    queue.flush();
    open.value = true;
    const next = inTurn(drawingPhase('host'), { turn: 2 });
    enter(next);
    expect(queue.resume(myDrawingTurn(platform()), [])).toEqual([]);
    expect(sent).toEqual([]);
    expect(canvas().canvas).toHaveLength(0);
  });

  it('sends again what went out on a dead socket and never reached the server, and only that', () => {
    vi.useFakeTimers();
    // The socket looks open the whole time: the ops are sent, but the link was dead.
    const { queue, sent } = queueFor({ value: true });
    enter(turn());
    const second: DrawOp[] = [
      { k: 'start', id: 1, tool: 'brush', color: '#ff0000', size: 6, x: 5, y: 5 },
      { k: 'move', id: 1, pts: [6, 6, 7, 7, 8, 8] },
      { k: 'end', id: 1 },
    ];
    queue.queue([...ops, ...second, { k: 'fill', x: 1, y: 2, color: '#00ff00' }]);
    queue.flush();
    expect(sent).toHaveLength(1);
    // The welcome's canvas has stroke 0 whole and stroke 1 cut after its first move point.
    const history: CanvasAction[] = [
      { kind: 'stroke', id: 0, tool: 'brush', color: '#000000', size: 6, points: [1, 1, 2, 2, 3, 3], done: true },
      { kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [5, 5, 6, 6] },
    ];
    enter(turn());
    const restored = queue.resume(myDrawingTurn(platform()), history);
    expect(restored).toEqual([{ k: 'move', id: 1, pts: [7, 7, 8, 8] }, { k: 'end', id: 1 }, { k: 'fill', x: 1, y: 2, color: '#00ff00' }]);
    expect(sent.at(-1)).toEqual({ t: 'draw', ops: restored });
    // Nothing missing: nothing sent.
    const whole: CanvasAction[] = [
      history[0],
      { kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [5, 5, 6, 6, 7, 7, 8, 8], done: true },
      { kind: 'fill', x: 1, y: 2, color: '#00ff00' },
    ];
    const full = queue.resume(myDrawingTurn(platform()), whole);
    expect(full).toEqual([]);
    vi.useRealTimers();
  });

  it('forgets an undone or cleared stroke: it is never brought back after a rejoin', () => {
    vi.useFakeTimers();
    const { queue } = queueFor({ value: true });
    enter(turn());
    queue.queue(ops);
    queue.flush();
    queue.undone();
    expect(queue.resume(myDrawingTurn(platform()), [])).toEqual([]);
    queue.queue(ops);
    queue.flush();
    queue.cleared();
    expect(queue.resume(myDrawingTurn(platform()), [])).toEqual([]);
    vi.useRealTimers();
  });

  it('merges consecutive move ops of one stroke into one message', () => {
    vi.useFakeTimers();
    const { queue, sent } = queueFor({ value: true });
    queue.queue([ops[0], { k: 'move', id: 0, pts: [2, 2] }, { k: 'move', id: 0, pts: [3, 3] }]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([{ t: 'draw', ops: [ops[0], { k: 'move', id: 0, pts: [2, 2, 3, 3] }] }]);
    vi.useRealTimers();
  });
});

describe('player list hooks', () => {
  it('badges the drawer and the players who guessed, and tints the guessers’ rows', () => {
    const state = inTurn(drawingPhase('host'), { players: { host: { guessedThisTurn: true, turnPoints: 40 }, bob: { guessedThisTurn: true, turnPoints: 120 } } });
    const host = player('host');
    const bob = player('bob');
    expect(renderToString(createElement('div', null, scribbleClient.playerBadge?.(state, host)))).toContain('player__badge--drawer');
    expect(renderToString(createElement('div', null, scribbleClient.playerBadge?.(state, bob)))).toContain('player__badge--guessed');
    expect(scribbleClient.playerClassName?.(state, host)).toBeUndefined();
    expect(scribbleClient.playerClassName?.(state, bob)).toBe('player--guessed');
    expect(renderToString(createElement('div', null, scribbleClient.playerMeta?.(state, bob)))).toContain('+120');
  });
});

describe('the guess box and the guess feed', () => {
  const players = [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('rae', { joinOrder: 3, participating: false, sittingOut: true })];
  const solved = () => inTurn(drawingPhase('host'), { players: { bob: { guessedThisTurn: true, turnPoints: 0 } } }, { players });

  it('gives only an unsolved guesser the tiles; the drawer, a solver and a spectator read one short line instead', () => {
    for (const [id, tiles] of [['host', false], ['bob', false], ['carol', true], ['rae', false]] as const) {
      enter(solved(), id);
      const html = renderToString(createElement(GuessBox));
      expect(html.includes('data-testid="guess-input"'), id).toBe(tiles);
      expect(html.includes('data-testid="guess-idle"'), id).toBe(!tiles);
    }
    expect(guessBoxLine('drawing', true, true)).toBe('Guesses show up here');
    expect(guessBoxLine('drawing', false, true)).toBe('You got it! Others are still guessing');
    // A spectator of the whole game reads the same line in every phase.
    for (const phase of ['choosing', 'drawing', 'turnEnd']) expect(guessBoxLine(phase, false, false, false)).toBe("You’re watching. You can play the next game.");
    expect(guessBoxLine('choosing', true, false)).toBe('Pick a word to draw');
    expect(guessBoxLine('choosing', false, false)).toBe('Get ready to guess');
    expect(guessBoxLine('turnEnd', false, false)).toBe('Next turn soon');
  });

  it("lists this game’s guesses and lines, never the lines from before it started or the notices", () => {
    enter(room({ players }) as ScribbleRoomState, 'bob');
    for (const id of [1, 2]) platform().handleServerMessage({ t: 'chat', message: chatLine(id, 'system') });
    // The game starts on screen (its start lines share its start time): what was said before it stays out of the feed.
    snapshot(inTurn(drawingPhase('host'), { startedAt: 2, players: { bob: { guessedThisTurn: true, turnPoints: 0 } } }, { players }));
    expect(scribble().feedFrom).toBe(2);
    platform().handleServerMessage({ t: 'chat', message: { ...chatLine(3, 'chat', 'apple'), playerId: 'carol', name: 'Carol' } });
    platform().handleServerMessage({ t: 'chat', message: chatLine(4, 'close', "'aple' is close!") });
    platform().handleServerMessage({ t: 'chat', message: chatLine(5, 'correct', 'Carol guessed the word!') });
    platform().handleServerMessage({ t: 'chat', message: chatLine(6, 'notice', 'Ann is now the host') });
    platform().handleServerMessage({ t: 'chat', message: chatLine(7, 'hint', 'The word was: pear') });
    const html = renderToString(createElement(GuessFeed));
    expect([...html.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1])).toEqual(['chat', 'close', 'correct', 'hint']);
    expect(html).toContain('Carol');
    expect(html).not.toContain('line 1');
    // The notice popped up as a toast instead.
    expect(platform().toasts.map((t) => t.text)).toContain('Ann is now the host');
  });

  it("shows a welcome into a running game only this game’s lines, never the lobby’s or an earlier game’s", () => {
    const game = inTurn(drawingPhase('host'), { startedAt: 5, players: { bob: { guessedThisTurn: true, turnPoints: 0 } } }, { players });
    const history = [chatLine(2, 'system', 'Hana joined'), chatLine(4, 'chat', 'old guess'), chatLine(5, 'system', 'The game has started!'), chatLine(8, 'chat', 'banana'), chatLine(9, 'notice', 'Old news')];
    platform().handleServerMessage({ ...welcome('rae', game), chat: history });
    scribbleClient.onRoom?.(game, null);
    expect(scribble().feedFrom).toBe(5);
    const html = renderToString(createElement(GuessFeed));
    expect(html).toContain('banana');
    for (const before of ['Hana joined', 'old guess', 'The game has started!']) expect(html).not.toContain(before);
    expect(html).not.toContain('Old news');
    expect(platform().toasts).toHaveLength(0);
  });
});

describe('guess tiles for assistive tech and narrow bars', () => {
  it('keeps the input enabled while reconnecting and disables only Send', () => {
    usePlatformStore.setState({ connection: 'reconnecting' });
    const html = renderToString(createElement(GuessInput, { mask: '_____' }));
    expect(tagWith(html, 'guess-input')).not.toContain('disabled');
    expect(tagWith(html, 'guess-send')).toContain('disabled');
  });

  it('describes the word shape and revealed hints to the real input', () => {
    usePlatformStore.setState({ connection: 'connected' });
    const html = renderToString(createElement(GuessInput, { mask: 'a__l_' }));
    expect(tagWith(html, 'guess-input')).toContain('aria-describedby="guess-input-description"');
    expect(html).toContain('5 letters. Revealed: A blank blank L blank.');
  });

  it('tells each tile group how many letters it holds so the tiles can shrink to fit', () => {
    const html = renderToString(createElement(GuessInput, { mask: '__________ ___-_' }));
    expect(html).toContain('--letters:10;--seps:0');
    expect(html).toContain('--letters:4;--seps:1');
    // The row knows the whole phrase too: short viewports fit it on one line instead of wrapping.
    expect(html).toContain('--total-letters:14;--total-seps:1;--groups:2');
  });

  it('exposes the header mask as an image with the same description', () => {
    const html = renderToString(createElement(WordDisplay, { mask: '___ __', isDrawer: false }));
    const tag = tagWith(html, 'word-mask');
    expect(tag).toContain('role="img"');
    expect(tag).toContain('aria-label="5 letters in 2 words."');
  });
});

describe('drawing ratings', () => {
  it('are gone: no thumbs for a guesser, the drawer or a player sitting the game out', () => {
    const state = inTurn(drawingPhase('host'), {}, { players: [player('host'), player('bob', { joinOrder: 1 }), player('rae', { joinOrder: 2, participating: false, sittingOut: true })] });
    for (const id of ['host', 'bob', 'rae']) {
      enter(state, id);
      const html = renderToString(createElement(ScribbleScreen, { room: state, meId: id, isHost: id === 'host' }));
      expect(html, id).toContain('data-testid="canvas"');
      for (const gone of ['data-testid="rating"', 'rate-like', 'rate-dislike', 'class="rating']) expect(html, `${id} ${gone}`).not.toContain(gone);
    }
  });
});

describe('sounds', () => {
  it('plays the buzzer and turn-end sting when a turn ends, but not to a player who joins during the summary', async () => {
    const { scribbleSounds } = await import('./sounds');
    // Timers only: the schedule and the module read the same (real) clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const play = vi.spyOn(scribbleSounds, 'play');
      const ended = inTurn({ kind: 'turnEnd', word: 'cat', drawerId: 'bob', points: {}, reason: 'timeUp', endsAt: Date.now() + 5_000 });
      enter(ended, 'rae');
      vi.advanceTimersByTime(3_000);
      expect(play).not.toHaveBeenCalled();
      enter(inTurn(drawingPhase('bob')), 'host');
      snapshot(ended);
      vi.advanceTimersByTime(3_000);
      expect(play.mock.calls.map(([name]) => name)).toEqual(['timeUp', 'turnEnd']);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('platform hold', () => {
  it('renders the screen with a neutral paused top bar and a frozen timer while the game waits for players', () => {
    const holding = inTurn(drawingPhase('bob'), {}, { waiting: { reason: 'players', missing: ['bob'], needed: 2, connected: 1 } });
    enter(holding, 'host');
    const html = renderToString(createElement(ScribbleScreen, { room: holding, meId: 'host', isHost: true }));
    expect(html).toContain('data-testid="scribble-paused"');
    expect(tagWith(html, 'timer')).toContain('data-paused="players"');
    expect(html).not.toContain('data-testid="word-mask"');
  });

  it('shows the turn summary as paused under a hold and as starting, never a red "0", once its time ran out', () => {
    const summary = (endsAt: number, waiting: ScribbleRoomState['waiting'] = null) =>
      inTurn({ kind: 'turnEnd', word: 'cat', drawerId: 'bob', points: { host: 10 }, reason: 'allGuessed', endsAt }, {}, { waiting });
    const held = summary(Date.now() - 2_000, { reason: 'players', missing: ['bob'], needed: 2, connected: 1 });
    enter(held, 'host');
    const heldHtml = renderToString(createElement(ScribbleScreen, { room: held, meId: 'host', isHost: true }));
    expect(tagWith(heldHtml, 'turn-end-countdown')).toContain('data-countdown="paused"');
    expect(heldHtml).toContain('Next turn is paused');
    expect(heldHtml).not.toContain('timer--urgent');

    const settling = summary(Date.now() - 2_000);
    enter(settling, 'host');
    const settlingHtml = renderToString(createElement(ScribbleScreen, { room: settling, meId: 'host', isHost: true }));
    expect(tagWith(settlingHtml, 'turn-end-countdown')).toContain('data-countdown="settling"');
    expect(settlingHtml).toContain('Next turn is starting');
    // One countdown on the screen: the header clock, which waits rather than sit on "0".
    const timers = settlingHtml.match(/<div class="timer[^"]*"[^>]*>/g) ?? [];
    expect(timers).toHaveLength(1);
    for (const t of timers) {
      expect(t).toContain('data-face="settling"');
      expect(t).not.toContain('timer--urgent');
    }

    const running = summary(Date.now() + 5_000);
    enter(running, 'host');
    const runningHtml = renderToString(createElement(ScribbleScreen, { room: running, meId: 'host', isHost: true }));
    expect(tagWith(runningHtml, 'turn-end-countdown')).toContain('data-countdown="running"');
    expect(runningHtml).toMatch(/data-testid="turn-end-countdown" data-countdown="running">Next turn soon</);
  });
});

describe('settings rows', () => {
  it('renders the sliders for the host with the shared limits, and no draw time', () => {
    const settings = (room() as ScribbleRoomState).settings;
    const html = renderToString(createElement(ScribbleSettingsFields, { settings, patch: () => undefined }));
    expect(tagWith(html, 'settings-rounds')).toContain('min="1"');
    expect(html).not.toContain('drawTime');
    expect(html.match(/class="range"/g)).toHaveLength(3);
    expect(tagWith(html, 'settings-customWordsOnly')).toContain('disabled');
    // Each slider shows its own value; the custom words get a count and an upload button.
    const none = renderToString(createElement(ScribbleSettingsFields, { settings: { ...settings, hints: 0 }, patch: () => undefined }));
    expect(none).toMatch(/data-testid="settings-value-hints"[^>]*>None</);
    expect(tagWith(html, 'settings-customWords-upload')).toContain('btn--secondary');
    expect(html).toMatch(/data-testid="settings-customWords-count"[^>]*>0<!-- --> <!-- -->words</);
  });
});
