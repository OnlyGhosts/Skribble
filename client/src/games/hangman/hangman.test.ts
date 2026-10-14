/**
 * Hangman's client module under test: the screen per role and phase (and what each one must not
 * show), the letter keys, the section-scoped undo/clear, the settings rows and the snapshot
 * cues. Runs in node: browser globals are stubbed, components render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_HANGMAN_SETTINGS, type HangmanRoomState, type HangmanView } from '@shared/games/hangman/protocol';
import type { CanvasAction, DrawOp } from '@shared/platform/canvas';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { hangmanClient } = await import('./module');
const { useHangmanStore } = await import('./store');
const { hangmanCanvas, myDrawingTurn } = await import('./canvas');
const { sectionStrokes } = await import('./actions');
const { HangmanScreen } = await import('./Screen');
const { LANDSCAPE_QUERY, scrollAnchor } = await import('./hooks');
const { toggleGuessMode } = await import('./components/GuessPanel');
const { HangmanSettingsFields } = await import('./SettingsFields');
const { LetterGrid } = await import('./components/LetterGrid');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const WORD = 'ICE CREAM';

function view(overrides: Partial<HangmanView> = {}): HangmanView {
  return {
    phase: 'guessing',
    round: 1,
    totalRounds: 1,
    turn: 1,
    turnsInRound: 3,
    hangmanId: 'host',
    guesserId: 'bob',
    mask: '__E __E__',
    usedLetters: ['E', 'Z'],
    wrongLetters: ['Z'],
    wrong: 1,
    maxWrong: 10,
    lives: 9,
    section: null,
    endsAt: NOW + 20_000,
    paused: false,
    outcome: null,
    points: { bob: 20, host: 15 },
    players: { host: { out: false, playing: true }, bob: { out: false, playing: true }, carol: { out: false, playing: true } },
    ...overrides,
  };
}

function inGame(game: HangmanView, overrides: Partial<HangmanRoomState> = {}): HangmanRoomState {
  return {
    ...room({ gameId: 'hangman', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 })] }),
    settings: { allowMidGameJoin: true, contentMode: 'family', ...DEFAULT_HANGMAN_SETTINGS },
    game,
    ...overrides,
  } as HangmanRoomState;
}

const stroke = (id: number): CanvasAction => ({ kind: 'stroke', id, tool: 'brush', color: '#000000', size: 6, points: [1, 1, 2, 2], done: true });
const startOp = (id: number): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 });
const platform = () => usePlatformStore.getState();
const canvas = () => hangmanCanvas.store.getState();

/** Feeds a welcome or snapshot the way the socket does: store first, then the module hooks. */
function enter(state: HangmanRoomState, playerId: string, extra?: unknown): void {
  const prev = platform().playerId === playerId ? platform().room : null;
  platform().handleServerMessage(welcome(playerId, state, `tok-${playerId}`, extra));
  hangmanClient.onWelcome?.(extra);
  hangmanClient.onRoom?.(state, prev);
}

function snapshot(state: HangmanRoomState): void {
  const prev = platform().room;
  platform().handleServerMessage({ t: 'room', room: state });
  hangmanClient.onRoom?.(state, prev);
}

function render(state: HangmanRoomState, meId: string): string {
  return renderToString(createElement(HangmanScreen, { room: state, meId, isHost: meId === 'host' }));
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId}`);
  return match[0];
}

function keyStates(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<button[^>]*data-testid="letter-key"[^>]*>/g) ?? []) {
    const letter = tag.match(/data-letter="([A-Z])"/)?.[1] ?? '?';
    out[letter] = `${tag.match(/data-state="(\w+)"/)?.[1] ?? '?'}${tag.includes('disabled') ? ':disabled' : ''}`;
  }
  return out;
}

beforeEach(() => {
  resetStore();
  useHangmanStore.getState().reset();
  hangmanCanvas.store.setState({ canvas: [], canvasEpoch: 0 });
  setLocation('/hangman/ABCD');
  registerGames(registryOf(hangmanClient));
});

describe('the screen per role', () => {
  it('shows the guesser the mask, the keys and the whole-word option, never the word', () => {
    const state = inGame(view());
    enter(state, 'bob');
    const html = render(state, 'bob');
    expect(tagWith(html, 'hangman-mask')).toContain('data-mask="__E __E__"');
    expect(html).not.toContain('data-testid="hangman-word"');
    expect(html).not.toContain(WORD);
    expect(tagWith(html, 'guess-panel')).toContain('data-state="mine"');
    expect(tagWith(html, 'guess-mode')).toBeTruthy();
    const keys = keyStates(html);
    expect(Object.keys(keys)).toHaveLength(26);
    // The platform store reports its initial (connecting) state under renderToString, so the idle keys read as disabled here.
    expect(keys.A).toMatch(/^idle/);
    expect(keys.E).toBe('correct:disabled');
    expect(keys.Z).toBe('wrong:disabled');
    expect(tagWith(html, 'hangman-lives')).toContain('data-lives="9"');
    expect(tagWith(html, 'wrong-letters')).toContain('data-count="1"');
    expect(tagWith(html, 'timer')).toMatch(/data-seconds="(19|20)"/);
  });

  it('switches the guesser to the word tiles in word mode, with its own test ids', () => {
    const state = inGame(view());
    enter(state, 'bob');
    useHangmanStore.getState().setGuessMode('word');
    const html = render(state, 'bob');
    expect(tagWith(html, 'word-input')).toContain('placeholder="Type the word..."');
    expect(tagWith(html, 'word-send')).toContain('disabled');
    expect(html.match(/data-testid="guess-tile"/g)).toHaveLength(8);
    expect(html).not.toContain('data-testid="letter-key"');
  });

  it('disables the keys for a player whose turn it is not, and greys out a guesser who is out', () => {
    const state = inGame(view({ players: { host: { out: false, playing: true }, bob: { out: false, playing: true }, carol: { out: true, playing: true } } }));
    enter(state, 'carol');
    const html = render(state, 'carol');
    expect(tagWith(html, 'guess-panel')).toContain('data-state="out"');
    expect(keyStates(html).A).toBe('idle:disabled');
    expect(hangmanClient.playerClassName?.(state, player('carol'))).toBe('player--out');
    expect(hangmanClient.playerClassName?.(state, player('bob'))).toBe('player--guessing');
    expect(hangmanClient.playerClassName?.(state, player('host'))).toBeUndefined();
  });

  it('shows the hangman their word and, while drawing, the ghost, the toolbar and Done; guessers see a caption', () => {
    const secret = inGame(view({ word: WORD }));
    enter(secret, 'host');
    const guessing = render(secret, 'host');
    expect(tagWith(guessing, 'hangman-word')).toContain(`data-word="${WORD}"`);
    expect(guessing).not.toContain('data-testid="hangman-ghost"');
    expect(guessing).not.toContain('data-testid="toolbar"');

    const drawing = inGame(view({ phase: 'drawing', guesserId: null, section: 2, word: WORD, endsAt: NOW + 25_000 }));
    snapshot(drawing);
    const html = render(drawing, 'host');
    expect(tagWith(html, 'hangman-ghost')).toContain('data-section="2"');
    // Section 1 is drawn already (invisible), section 2 is the dashed ghost, the rest stay faint.
    expect(html).not.toContain('hm-ghost__part--done');
    expect(html.match(/hm-ghost__part--current/g)).toHaveLength(1);
    expect(html.match(/hm-ghost__part--todo/g)).toHaveLength(8);
    expect(tagWith(html, 'toolbar')).toBeTruthy();
    expect(tagWith(html, 'draw-bar')).toContain('data-section="2"');
    expect(tagWith(html, 'draw-done')).toBeTruthy();

    const theirs = render(inGame(view({ phase: 'drawing', guesserId: null, section: 2, endsAt: NOW + 25_000 })), 'bob');
    expect(theirs).not.toContain('data-testid="hangman-ghost"');
    expect(theirs).not.toContain('data-testid="toolbar"');
    expect(tagWith(theirs, 'drawing-caption')).toBeTruthy();
    expect(tagWith(theirs, 'guess-panel')).toContain('data-state="drawing"');
  });

  it('offers the word choices and the custom field to the hangman only while choosing', () => {
    const choosing = view({ phase: 'choosing', guesserId: null, mask: '', usedLetters: [], wrongLetters: [], wrong: 0, lives: 10, endsAt: NOW + 30_000 });
    const mine = render(inGame({ ...choosing, choices: ['APPLE', 'BANANA', 'CHERRY'] }), 'host');
    expect(mine.match(/data-testid="word-choice"/g)).toHaveLength(3);
    expect(tagWith(mine, 'custom-word-input')).toBeTruthy();
    const theirs = render(inGame(choosing), 'bob');
    expect(theirs).not.toContain('data-testid="word-choice"');
    expect(theirs).not.toContain('APPLE');
    expect(tagWith(theirs, 'overlay-choosing')).toBeTruthy();
  });

  it('reveals the word, the outcome and the points to everyone at the turn end', () => {
    const state = inGame(view({ phase: 'turnEnd', guesserId: null, word: WORD, outcome: { kind: 'solved', solverId: 'carol' }, points: { carol: 180, host: 30, bob: 20 }, endsAt: NOW + 6_000 }));
    const html = render(state, 'bob');
    expect(tagWith(html, 'overlay-turn-end')).toContain('data-outcome="solved"');
    expect(html).toContain('carol solved it!');
    expect(tagWith(html, 'turn-end-word')).toBeTruthy();
    const rows = html.match(/<li[^>]*data-testid="turn-end-points"[^>]*>/g) ?? [];
    expect(rows.map((r) => r.match(/data-name="(\w+)"/)?.[1])).toEqual(['carol', 'host', 'bob']);
    expect(hangmanClient.playerMeta?.(state, player('carol'))).not.toBeNull();
  });

  it('tells a spectator and a late joiner that they are watching', () => {
    const state = inGame(view({ players: { host: { out: false, playing: true }, bob: { out: false, playing: true } } }), {
      players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2, participating: false }), player('dave', { joinOrder: 3 })],
    });
    expect(tagWith(render(state, 'carol'), 'guess-panel')).toContain('data-state="watching"');
    expect(tagWith(render(state, 'dave'), 'guess-panel')).toContain('data-state="watching"');
    expect(hangmanClient.chatPlaceholder?.(state, 'carol')).toContain('watching');
    expect(hangmanClient.chatPlaceholder?.(state, 'bob')).toContain('keys');
  });
});

describe('the layout across phases', () => {
  const drawing = (section: number) => inGame(view({ phase: 'drawing', guesserId: null, section, word: WORD, endsAt: NOW + 25_000 }));

  it('keeps the "risk the word" button in the keys\' last row, and moves it up beside the title in word mode', () => {
    const state = inGame(view());
    enter(state, 'bob');
    const keys = render(state, 'bob');
    expect(keys.match(/data-testid="guess-mode"/g)).toHaveLength(1);
    expect(keys.indexOf('data-testid="guess-mode"')).toBeGreaterThan(keys.lastIndexOf('data-letter="Z"'));
    expect(keys.indexOf('data-testid="guess-mode"')).toBeLessThan(keys.indexOf('</div>', keys.indexOf('data-testid="letter-grid"')));
    useHangmanStore.getState().setGuessMode('word');
    const tiles = render(state, 'bob');
    expect(tiles.match(/data-testid="guess-mode"/g)).toHaveLength(1);
    expect(tiles.indexOf('data-testid="guess-mode"')).toBeLessThan(tiles.indexOf('data-testid="guess-form"'));
    expect(tiles).toContain('Back to letters');
  });

  it('opening the word tiles marks them to take the focus at once, so the phone keyboard opens from the tap', () => {
    const focusMemory = { current: false };
    toggleGuessMode('letters', focusMemory);
    expect(useHangmanStore.getState().guessMode).toBe('word');
    expect(focusMemory.current).toBe(true);
    toggleGuessMode('word', focusMemory);
    expect(useHangmanStore.getState().guessMode).toBe('letters');
    expect(focusMemory.current).toBe(false);
  });

  it('shows the "is drawing" caption to the viewers only until the first stroke of the section lands', () => {
    enter(drawing(2), 'bob', { canvas: [stroke(1)], floor: 1 });
    expect(tagWith(render(drawing(2), 'bob'), 'drawing-caption')).toBeTruthy();
    canvas().appendOps([startOp(2), { k: 'end', id: 2 }]);
    expect(render(drawing(2), 'bob')).not.toContain('data-testid="drawing-caption"');
    // The next section starts with a caption again.
    snapshot(drawing(3));
    expect(tagWith(render(drawing(3), 'bob'), 'drawing-caption')).toBeTruthy();
  });

  it('gives the hangman no guess panel while they draw: the tools and Done take its place under the canvas', () => {
    enter(drawing(1), 'host');
    const html = render(drawing(1), 'host');
    expect(html).not.toContain('data-testid="guess-panel"');
    expect(html).not.toContain('data-testid="hangman-tools"');
    expect(html.indexOf('data-testid="toolbar"')).toBeGreaterThan(html.indexOf('canvas-group__footer'));
    expect(tagWith(html, 'draw-done')).toBeTruthy();
    // A held drawing step (the platform waits for someone) shows the panel's status line instead.
    const held: HangmanRoomState = { ...drawing(1), waiting: { reason: 'players', missing: ['bob'], needed: 2, connected: 1 } };
    expect(tagWith(render(held, 'host'), 'guess-panel')).toContain('data-state="drawing"');
  });

  it('puts the tools beside the canvas on a phone turned sideways', () => {
    const g = globalThis as { matchMedia?: (q: string) => { matches: boolean } };
    const plain = g.matchMedia;
    g.matchMedia = (query: string) => ({ media: query, matches: query === LANDSCAPE_QUERY || query.includes('max-width: 760px'), addEventListener: () => undefined, removeEventListener: () => undefined });
    try {
      enter(drawing(1), 'host');
      const html = render(drawing(1), 'host');
      expect(html).not.toContain('canvas-group__footer');
      expect(tagWith(html, 'hangman-tools')).toBeTruthy();
      expect(html.indexOf('data-testid="toolbar"')).toBeGreaterThan(html.indexOf('data-testid="hangman-tools"'));
      expect(html.indexOf('data-testid="draw-done"')).toBeGreaterThan(html.indexOf('data-testid="hangman-tools"'));
      expect(html).toContain('hm--phone');
    } finally {
      g.matchMedia = plain;
    }
  });

  it('names where the column scrolls to: the canvas for a new section, the top for a new turn or guess, nowhere otherwise', () => {
    const me = 'host';
    const choosing = inGame(view({ phase: 'choosing', guesserId: null, mask: '', endsAt: NOW + 30_000 }));
    expect(scrollAnchor(choosing, me)).toEqual({ key: 'turn:ABCD:1:1:host', to: 'top' });
    expect(scrollAnchor(drawing(1), me)).toEqual({ key: 'section:ABCD:1:1:host:1', to: 'canvas' });
    expect(scrollAnchor(drawing(2), me)).toEqual({ key: 'section:ABCD:1:1:host:2', to: 'canvas' });
    // Viewers of a drawing step stay where they are.
    expect(scrollAnchor(drawing(2), 'bob')).toEqual({ key: 'turn:ABCD:1:1:host', to: 'top' });
    // A guess of mine is a new anchor each time it comes round, not on every snapshot.
    const mine = scrollAnchor(inGame(view()), 'bob');
    expect(mine).toEqual({ key: 'guess:ABCD:1:1:host:bob:2:1', to: 'top' });
    expect(scrollAnchor(inGame(view({ endsAt: NOW + 10_000 })), 'bob')).toEqual(mine);
    expect(scrollAnchor(inGame(view({ guesserId: 'carol' })), 'bob')).toEqual({ key: 'turn:ABCD:1:1:host', to: 'top' });
    expect(scrollAnchor(inGame(view({ usedLetters: ['E', 'Z', 'A'] })), 'bob')?.key).toBe('guess:ABCD:1:1:host:bob:3:1');
    expect(scrollAnchor(inGame(view({ turn: 2, hangmanId: 'bob' })), 'host')?.key).toBe('turn:ABCD:1:2:bob');
    expect(scrollAnchor(room({ gameId: 'hangman' }) as HangmanRoomState, me)).toBeNull();
  });
});

describe('the letter grid', () => {
  it('renders 26 keys with the used ones disabled and coloured', () => {
    const html = renderToString(createElement(LetterGrid, { used: ['A', 'B'], wrong: ['B'], enabled: true, onPick: () => undefined }));
    const keys = keyStates(html);
    expect(keys.A).toBe('correct:disabled');
    expect(keys.B).toBe('wrong:disabled');
    expect(keys.C).toBe('idle');
    expect(tagWith(html, 'letter-grid')).toContain('data-enabled="true"');
  });
});

describe('the canvas across turns and sections', () => {
  const drawing = (section: number) => inGame(view({ phase: 'drawing', guesserId: null, section, word: WORD, endsAt: NOW + 25_000 }));

  it('keys the drawing turn by section for the hangman only', () => {
    enter(drawing(1), 'host');
    expect(myDrawingTurn(platform())).toBe('ABCD:1:1:host:1');
    snapshot(drawing(2));
    expect(myDrawingTurn(platform())).toBe('ABCD:1:1:host:2');
    snapshot(inGame(view({ word: WORD })));
    expect(myDrawingTurn(platform())).toBeNull();
    enter(drawing(1), 'bob');
    expect(myDrawingTurn(platform())).toBeNull();
  });

  it('starts a section at the current stroke count and clears back to it, leaving earlier sections alone', () => {
    enter(inGame(view({ word: WORD })), 'host', { canvas: [stroke(1)] });
    expect(canvas().canvas).toHaveLength(1);
    snapshot(drawing(1));
    expect(useHangmanStore.getState().sectionFloor).toBe(1);
    canvas().appendOps([startOp(2), { k: 'end', id: 2 }, startOp(3), { k: 'end', id: 3 }]);
    expect(sectionStrokes()).toBe(2);
    // The server's answer to a section clear is one undo per stroke; the hangman's own session ignores those echoes.
    expect(hangmanClient.onServerMessage?.({ t: 'undo' })).toBe(true);
    expect(canvas().canvas).toHaveLength(3);
    canvas().setCanvas(canvas().canvas.slice(0, useHangmanStore.getState().sectionFloor));
    expect(canvas().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1]);
    expect(sectionStrokes()).toBe(0);
  });

  it('takes the floor from the welcome on a rejoin mid-section, and the full canvas when there is none', () => {
    enter(drawing(2), 'host', { canvas: [stroke(1), stroke(2), stroke(3)], floor: 1 });
    expect(useHangmanStore.getState().sectionFloor).toBe(1);
    expect(sectionStrokes()).toBe(2);
    enter(drawing(2), 'host', { canvas: [stroke(1), stroke(2)] });
    expect(useHangmanStore.getState().sectionFloor).toBe(2);
    expect(sectionStrokes()).toBe(0);
  });

  it('wipes the canvas and the drafts when the next word is chosen, and on a return to the lobby', () => {
    enter(inGame(view({ word: WORD })), 'host', { canvas: [stroke(1)] });
    useHangmanStore.getState().setWordDraft('ice');
    useHangmanStore.getState().setCustomDraft('x');
    snapshot(inGame(view({ phase: 'choosing', turn: 2, hangmanId: 'bob', guesserId: null, mask: '', endsAt: NOW + 30_000 })));
    expect(canvas().canvas).toEqual([]);
    expect(useHangmanStore.getState().wordDraft).toBe('');
    expect(useHangmanStore.getState().customDraft).toBe('');
    canvas().appendOps([startOp(1)]);
    snapshot(room({ gameId: 'hangman' }) as HangmanRoomState);
    expect(canvas().canvas).toEqual([]);
  });

  it('a viewer follows the broadcast undo, clear and resync', () => {
    enter(drawing(1), 'bob', { canvas: [stroke(1), stroke(2)] });
    hangmanClient.onServerMessage?.({ t: 'undo' });
    expect(canvas().canvas).toHaveLength(1);
    hangmanClient.onServerMessage?.({ t: 'clear' });
    expect(canvas().canvas).toHaveLength(0);
    hangmanClient.onServerMessage?.({ t: 'canvas', actions: [stroke(7)] });
    expect(canvas().canvas).toHaveLength(1);
    expect(hangmanClient.onServerMessage?.({ t: 'somethingElse' })).toBe(false);
  });
});

describe('settings rows', () => {
  it('renders the sliders and the word list for the host, read-only values otherwise', () => {
    const settings = { allowMidGameJoin: true, contentMode: 'family' as const, ...DEFAULT_HANGMAN_SETTINGS };
    const host = renderToString(createElement(HangmanSettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-rounds')).toContain('max="5"');
    expect(tagWith(host, 'settings-guessSeconds')).toContain('min="10"');
    expect(tagWith(host, 'settings-drawSeconds')).toContain('max="60"');
    expect(tagWith(host, 'settings-customWords')).toBeTruthy();
    expect(tagWith(host, 'settings-customWordsOnly')).toContain('disabled');
    const guest = renderToString(createElement(HangmanSettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-rounds"');
    expect(guest).toContain('20s');
    expect(guest).toContain('25s');
  });
});
