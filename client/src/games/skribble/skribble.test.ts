import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { CanvasAction, DrawOp, SkribbleClientMessage, SkribbleRoomState } from '@shared/games/skribble/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { skribbleClient } = await import('./module');
const { useSkribbleStore } = await import('./store');
const { DrawQueue } = await import('./net');
const { GuessInput } = await import('./components/GuessInput');
const { WordDisplay } = await import('./components/WordDisplay');
const { SkribbleSettingsFields } = await import('./components/SettingsFields');
const { placeholderFor } = await import('./lib/format');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const { drawingPhase, inTurn, resetSkribbleStore } = await import('./test/fixtures');

const stroke = (id: number): CanvasAction => ({ kind: 'stroke', id, tool: 'brush', color: '#000000', size: 6, points: [1, 1, 2, 2], done: true });
const skribble = () => useSkribbleStore.getState();
const platform = () => usePlatformStore.getState();

/** Feeds a welcome or snapshot the way the socket does: store first, then the module hooks. */
function enter(roomState: SkribbleRoomState, playerId = 'bob', extra?: unknown): void {
  const prev = platform().playerId === playerId ? platform().room : null;
  platform().handleServerMessage(welcome(playerId, roomState, `tok-${playerId}`, extra));
  skribbleClient.onWelcome?.(extra);
  skribbleClient.onRoom?.(roomState, prev);
}

function snapshot(roomState: SkribbleRoomState): void {
  const prev = platform().room;
  platform().handleServerMessage({ t: 'room', room: roomState });
  skribbleClient.onRoom?.(roomState, prev);
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

beforeEach(() => {
  resetStore();
  resetSkribbleStore();
  setLocation('/');
  registerGames(registryOf(skribbleClient));
});

describe('welcome and the guess draft', () => {
  const turn = () => inTurn(drawingPhase('host'));

  it('restores the canvas from welcome.extra and keeps a half-typed guess across a rejoin into the same turn', () => {
    enter(turn(), 'bob', { canvas: [stroke(1)] });
    expect(skribble().canvas).toHaveLength(1);
    skribble().setGuessDraft('ab');
    enter(turn(), 'bob', { canvas: [stroke(1), stroke(2)] });
    expect(skribble().guessDraft).toBe('ab');
    expect(skribble().canvas).toHaveLength(2);
  });

  it('clears the draft when the rejoin lands in another turn or seat', () => {
    enter(turn());
    skribble().setGuessDraft('ab');
    enter(inTurn(drawingPhase('bob'), { turn: 2 }));
    expect(skribble().guessDraft).toBe('');

    skribble().setGuessDraft('cd');
    enter(inTurn(drawingPhase('bob'), { turn: 2 }), 'carol');
    expect(skribble().guessDraft).toBe('');
  });

  it('starts every turn and the lobby on a blank canvas and an empty draft', () => {
    enter(turn(), 'bob', { canvas: [stroke(1)] });
    skribble().setGuessDraft('ab');
    snapshot(inTurn({ kind: 'choosing', drawerId: 'bob', endsAt: Date.now() + 15_000 }, { turn: 2 }));
    expect(skribble().canvas).toEqual([]);
    expect(skribble().guessDraft).toBe('');
    skribble().appendOps([{ k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 }]);
    snapshot(room() as SkribbleRoomState);
    expect(skribble().canvas).toEqual([]);
  });
});

describe('undo and clear', () => {
  const turn = (drawerId: string) => inTurn(drawingPhase(drawerId));

  it('the drawer applies undo locally and ignores the echo, so a stroke started meanwhile survives', () => {
    enter(turn('bob'));
    skribble().appendOps([
      { k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 },
      { k: 'end', id: 1 },
      { k: 'start', id: 2, tool: 'brush', color: '#000000', size: 6, x: 5, y: 5 },
      { k: 'end', id: 2 },
    ]);
    const epoch = skribble().canvasEpoch;
    skribble().undo(); // what undoStroke() does when the undo was sent
    expect(skribble().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1]);
    expect(skribble().canvasEpoch).toBe(epoch + 1);

    // The drawer starts stroke 3 before the server's echo arrives.
    skribble().appendOps([{ k: 'start', id: 3, tool: 'brush', color: '#000000', size: 6, x: 9, y: 9 }]);
    expect(skribbleClient.onServerMessage?.({ t: 'undo' })).toBe(true);
    expect(skribble().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1, 3]);
    skribbleClient.onServerMessage?.({ t: 'clear' });
    expect(skribble().canvas).toHaveLength(2);
  });

  it('a guesser applies the broadcast undo, clear and resync', () => {
    enter(turn('host'), 'bob', { canvas: [stroke(1), stroke(2)] });
    skribbleClient.onServerMessage?.({ t: 'undo' });
    expect(skribble().canvas).toHaveLength(1);
    skribbleClient.onServerMessage?.({ t: 'clear' });
    expect(skribble().canvas).toHaveLength(0);
    skribbleClient.onServerMessage?.({ t: 'canvas', actions: [stroke(7)] });
    expect(skribble().canvas).toHaveLength(1);
    expect(skribbleClient.onServerMessage?.({ t: 'somethingElse' })).toBe(false);
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
    const sent: SkribbleClientMessage[] = [];
    const queue = new DrawQueue({ send: (m) => (open.value ? (sent.push(m), true) : false), isOpen: () => open.value }, () => platform().room as SkribbleRoomState | null);
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
    queue.resumeOfflineOps(turn(), 'bob');
    expect(sent).toEqual([{ t: 'draw', ops }]);
    expect(skribble().canvas).toHaveLength(1);
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
    queue.resumeOfflineOps(next, 'bob');
    expect(sent).toEqual([]);
    expect(skribble().canvas).toHaveLength(0);
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

describe('player list and chat hooks', () => {
  it('badges the drawer and the players who guessed, and tints the guessers’ rows', () => {
    const state = inTurn(drawingPhase('host'), { players: { host: { guessedThisTurn: true, turnPoints: 40 }, bob: { guessedThisTurn: true, turnPoints: 120 } } });
    const host = player('host');
    const bob = player('bob');
    expect(renderToString(createElement('div', null, skribbleClient.playerBadge?.(state, host)))).toContain('player__badge--drawer');
    expect(renderToString(createElement('div', null, skribbleClient.playerBadge?.(state, bob)))).toContain('player__badge--guessed');
    expect(skribbleClient.playerClassName?.(state, host)).toBeUndefined();
    expect(skribbleClient.playerClassName?.(state, bob)).toBe('player--guessed');
    expect(renderToString(createElement('div', null, skribbleClient.playerMeta?.(state, bob)))).toContain('+120');
  });

  it('tells the drawer that only players who guessed can read them', () => {
    expect(placeholderFor('drawing', true, true)).toBe('Chat with players who guessed...');
    expect(placeholderFor('drawing', false, false)).toBe('Type your guess...');
    expect(placeholderFor('drawing', false, true)).toBe('You guessed it! Chat with others who know...');
    expect(placeholderFor('lobby', true, false)).toBe('Chat...');
    const state = inTurn(drawingPhase('host'), { players: { bob: { guessedThisTurn: true, turnPoints: 0 } } });
    expect(skribbleClient.chatPlaceholder?.(state, 'host')).toBe('Chat with players who guessed...');
    expect(skribbleClient.chatPlaceholder?.(state, 'bob')).toMatch(/you guessed it/i);
    expect(skribbleClient.chatPlaceholder?.(state, 'carol')).toBe('Type your guess...');
  });
});

describe('guess tiles for assistive tech and narrow bars', () => {
  it('keeps the input enabled while reconnecting and disables only Send', () => {
    usePlatformStore.setState({ connection: 'reconnecting' });
    const html = renderToString(createElement(GuessInput, { mask: '_____', focusMemory: { current: false } }));
    expect(tagWith(html, 'chat-input')).not.toContain('disabled');
    expect(tagWith(html, 'chat-send')).toContain('disabled');
  });

  it('describes the word shape and revealed hints to the real input', () => {
    usePlatformStore.setState({ connection: 'connected' });
    const html = renderToString(createElement(GuessInput, { mask: 'a__l_', focusMemory: { current: false } }));
    expect(tagWith(html, 'chat-input')).toContain('aria-describedby="guess-word-description"');
    expect(html).toContain('5 letters. Revealed: A blank blank L blank.');
  });

  it('tells each tile group how many letters it holds so the tiles can shrink to fit', () => {
    const html = renderToString(createElement(GuessInput, { mask: '__________ ___-_', focusMemory: { current: false } }));
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

describe('settings rows', () => {
  it('renders the sliders for the host with the shared limits', () => {
    const settings = (room() as SkribbleRoomState).settings;
    const html = renderToString(createElement(SkribbleSettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(html, 'settings-rounds')).toContain('min="1"');
    expect(tagWith(html, 'settings-drawTime')).toContain('step="10"');
    expect(tagWith(html, 'settings-customWordsOnly')).toContain('disabled');
  });
});
