/**
 * Quip Game's client module under test: the screen per phase and role, the settings rows, the
 * player-list badges, the snapshot-driven cues and the local store. Runs in node: browser
 * globals are stubbed, components render through react-dom/server.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_QUIPGAME_SETTINGS, type QuipgameRoomState, type QuipgameView } from '@shared/games/quipgame/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { quipgameClient } = await import('./module');
const { useQuipgameStore } = await import('./store');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const IDS = ['host', 'bob', 'carol'];
const PROMPTS = [
  { id: 'r1-p0', text: 'The worst thing to hear from your dentist' },
  { id: 'r1-p2', text: 'A terrible name for a pet goldfish' },
];

function view(overrides: Partial<QuipgameView> = {}): QuipgameView {
  return {
    phase: 'writing',
    round: 1,
    totalRounds: 3,
    endsAt: NOW + 60_000,
    multiplier: 1,
    roundPlayers: IDS,
    spectators: [],
    isSpectator: false,
    myPrompts: PROMPTS,
    myAnswers: {},
    done: 0,
    total: 3,
    finished: [],
    matchup: null,
    canVote: false,
    isAuthor: false,
    myVote: null,
    voted: [],
    result: null,
    finalPrompt: null,
    finalAnswers: [],
    myAnswerId: null,
    maxPicks: 0,
    myRanking: [],
    ranked: 0,
    finalResult: null,
    announcerId: null,
    isAnnouncer: false,
    canSkip: false,
    ...overrides,
  };
}

const MATCHUP = { index: 1, total: 3, prompt: PROMPTS[0].text, a: 'A root canal, on the house', b: 'Say aaah… forever', votes: 1 };
const ANSWER_A = { text: MATCHUP.a, authorId: 'bob', authorName: 'bob', votes: 3, points: 1250, flawless: true, fallback: false };
const ANSWER_B = { text: MATCHUP.b, authorId: 'carol', authorName: 'carol', votes: 0, points: 0, flawless: false, fallback: true };
const RESULT = { index: 1, total: 3, prompt: PROMPTS[0].text, a: ANSWER_A, b: ANSWER_B, outcome: 'a' as const };
const FINAL_ANSWERS = [
  { id: 'f-bob', text: 'bob final' },
  { id: 'f-host', text: 'host final' },
  { id: 'f-carol', text: 'carol final' },
];

function quipRoom(game: QuipgameView, overrides: Partial<QuipgameRoomState> = {}): QuipgameRoomState {
  return {
    ...room({ gameId: 'quipgame', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 })] }),
    settings: { maxPlayers: 8, allowMidGameJoin: true, ...DEFAULT_QUIPGAME_SETTINGS },
    game,
    ...overrides,
  } as QuipgameRoomState;
}

function render(state: QuipgameRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  return renderToString(createElement(quipgameClient.Screen, { room: state, meId, isHost }));
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId}`);
  return match[0];
}

function tagsWith(html: string, testId: string): string[] {
  return html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

/** Feeds a snapshot the way the socket does: store first, then the module hook. */
function snapshot(state: QuipgameRoomState): void {
  const prev = usePlatformStore.getState().room as QuipgameRoomState | null;
  usePlatformStore.getState().handleServerMessage({ t: 'room', room: state });
  quipgameClient.onRoom?.(state, prev);
}

beforeEach(() => {
  resetStore();
  useQuipgameStore.getState().reset();
  setLocation('/quipgame/ABCD');
  registerGames(registryOf(quipgameClient));
});

describe('writing', () => {
  it('shows the first prompt with a native 80-character input, the counter and the done count', () => {
    const html = render(quipRoom(view()), 'bob');
    expect(attr(tagWith(html, 'quipgame-screen'), 'data-phase')).toBe('writing');
    expect(attr(tagWith(html, 'write-progress'), 'data-number')).toBe('1');
    expect(attr(tagWith(html, 'write-progress'), 'data-total')).toBe('2');
    expect(attr(tagWith(html, 'write-prompt'), 'data-prompt-id')).toBe('r1-p0');
    const input = tagWith(html, 'write-input');
    expect(input).toContain('type="text"');
    expect(input).toContain('maxLength="80"');
    expect(input).toContain('enterKeyHint="done"');
    expect(tagWith(html, 'write-submit')).toContain('disabled');
    expect(attr(tagWith(html, 'write-done'), 'data-total')).toBe('3');
    expect(html).not.toContain('data-testid="quip-waiting"');
    expect(tagWith(html, 'round-indicator')).toContain('data-round="1"');
    expect(tagWith(html, 'timer')).toMatch(/data-seconds="(59|60)"/);
  });

  it('moves to the second prompt once the first is answered, enables Submit for a draft, and reopens an answer with Edit', () => {
    const half = quipRoom(view({ myAnswers: { 'r1-p0': 'a root canal' }, done: 0 }));
    useQuipgameStore.getState().setDraft('r1-p2', '  Bubbles  ');
    const html = render(half, 'bob');
    expect(attr(tagWith(html, 'write-prompt'), 'data-prompt-id')).toBe('r1-p2');
    expect(attr(tagWith(html, 'write-progress'), 'data-number')).toBe('2');
    expect(tagWith(html, 'write-submit')).not.toContain('disabled');
    expect(html).toContain('7<!-- -->/<!-- -->80');

    const done = quipRoom(view({ myAnswers: { 'r1-p0': 'a root canal', 'r1-p2': 'Bubbles' }, done: 2, finished: ['bob', 'host'] }));
    const waiting = render(done, 'bob');
    expect(tagWith(waiting, 'quip-waiting')).toBeTruthy();
    expect(waiting).toContain('Waiting for the others (2 of 3 done)');
    expect(tagsWith(waiting, 'write-edit')).toHaveLength(2);
    expect(waiting).not.toContain('data-testid="write-input"');

    useQuipgameStore.getState().editPrompt('r1-p0');
    const editing = render(done, 'bob');
    expect(attr(tagWith(editing, 'write-prompt'), 'data-prompt-id')).toBe('r1-p0');
    expect(tagWith(editing, 'write-cancel')).toBeTruthy();
    expect(editing).toContain('>Update<');
  });

  it('tells a late joiner they are watching, and disables the field once the game has ended', () => {
    const html = render(quipRoom(view({ isSpectator: true, myPrompts: [], spectators: ['dave'] })), 'dave');
    expect(tagWith(html, 'quip-spectating')).toBeTruthy();
    expect(html).not.toContain('data-testid="write-input"');
    const over = render(quipRoom(view(), { phase: 'ended' }), 'bob');
    expect(tagWith(over, 'write-input')).toContain('disabled');
  });
});

describe('voting', () => {
  const voting = (overrides: Partial<QuipgameView> = {}) => quipRoom(view({ phase: 'voting', matchup: MATCHUP, canVote: true, ...overrides }));

  it('gives a voter two big A/B buttons, the prompt and the live count; a tapped answer shows as selected', () => {
    const html = render(voting(), 'host');
    expect(attr(tagWith(html, 'quip-voting'), 'data-can-vote')).toBe('true');
    expect(html).toContain(MATCHUP.prompt);
    const answers = tagsWith(html, 'vote-answer');
    expect(answers.map((a) => attr(a, 'data-choice'))).toEqual(['a', 'b']);
    expect(answers.every((a) => a.startsWith('<button') && !a.includes('disabled'))).toBe(true);
    expect(attr(tagWith(html, 'vote-count'), 'data-votes')).toBe('1');
    expect(attr(tagWith(html, 'vote-count'), 'data-voters')).toBe('1');
    expect(html).not.toContain('data-testid="quip-announcer"');
    useQuipgameStore.getState().selectChoice('b');
    const tapped = render(voting(), 'host');
    expect(tagsWith(tapped, 'vote-answer').map((a) => attr(a, 'data-selected'))).toEqual(['false', 'true']);
    // The server's echo wins over the local tap.
    const echoed = render(voting({ myVote: 'a' }), 'host');
    expect(tagsWith(echoed, 'vote-answer').map((a) => attr(a, 'data-selected'))).toEqual(['true', 'false']);
  });

  it('shows an author the answers without buttons and a sit-tight card; the announcer gets the read-out card on top', () => {
    const author = render(voting({ canVote: false, isAuthor: true }), 'bob');
    expect(tagWith(author, 'vote-author')).toBeTruthy();
    expect(author).toContain('yours, sit tight');
    expect(tagsWith(author, 'vote-answer').every((a) => a.startsWith('<div'))).toBe(true);
    const announcer = render(voting({ isAnnouncer: true, announcerId: 'host' }), 'host');
    expect(announcer.indexOf('data-testid="quip-announcer"')).toBeLessThan(announcer.indexOf('data-testid="quip-voting"'));
    expect(announcer).toContain('read this out');
  });
});

describe('results', () => {
  it('reveals both authors with votes, points and the flawless badge; Next for the host, a countdown for the rest', () => {
    const state = quipRoom(view({ phase: 'result', result: RESULT, canSkip: true, endsAt: NOW + 8_000 }));
    const host = render(state, 'host');
    expect(attr(tagWith(host, 'quip-result'), 'data-outcome')).toBe('a');
    const rows = tagsWith(host, 'result-answer');
    expect(rows.map((r) => [attr(r, 'data-author-name'), attr(r, 'data-votes'), attr(r, 'data-points'), attr(r, 'data-flawless')])).toEqual([
      ['bob', '3', '1250', 'true'],
      ['carol', '0', '0', 'false'],
    ]);
    expect(tagsWith(host, 'result-flawless')).toHaveLength(1);
    expect(host).toContain('+1250');
    expect(host).toContain('ran out of time');
    expect(tagWith(host, 'quip-next')).toBeTruthy();
    expect(host).toContain('>Next<!-- --> (');
    const guest = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: false })), 'bob');
    expect(guest).not.toContain('data-testid="quip-next"');
    expect(tagWith(guest, 'result-countdown')).toBeTruthy();
    // The last matchup of round two leads into the final.
    const last = render(quipRoom(view({ phase: 'result', round: 2, multiplier: 2, result: { ...RESULT, index: 2 }, canSkip: true })), 'host');
    expect(last).toContain('>Final round<!-- --> (');
  });
});

describe('the final', () => {
  const finalVoting = (overrides: Partial<QuipgameView> = {}) =>
    quipRoom(view({ phase: 'finalVoting', round: 3, finalPrompt: 'The final prompt', finalAnswers: FINAL_ANSWERS, myAnswerId: 'f-host', maxPicks: 2, ...overrides }));

  it('lists the anonymous answers with the own one disabled, hands out medals in tap order and takes them back', () => {
    const html = render(finalVoting(), 'host');
    const answers = tagsWith(html, 'final-answer');
    expect(answers.map((a) => [attr(a, 'data-answer-id'), attr(a, 'data-own'), a.includes('disabled')])).toEqual([
      ['f-bob', 'false', false],
      ['f-host', 'true', true],
      ['f-carol', 'false', false],
    ]);
    expect(tagWith(html, 'final-submit')).toContain('disabled');
    const store = useQuipgameStore.getState();
    store.togglePick('f-carol', 2);
    store.togglePick('f-bob', 2);
    store.togglePick('f-host', 2);
    expect(useQuipgameStore.getState().picks).toEqual(['f-carol', 'f-bob']);
    const picked = render(finalVoting(), 'host');
    expect(tagsWith(picked, 'final-answer').map((a) => attr(a, 'data-medal'))).toEqual(['2', '', '1']);
    expect(picked).toContain('🥇');
    expect(tagWith(picked, 'final-submit')).not.toContain('disabled');
    useQuipgameStore.getState().togglePick('f-carol', 2);
    expect(useQuipgameStore.getState().picks).toEqual(['f-bob']);
    // A ranking already sent: Update, enabled only once the picks differ.
    useQuipgameStore.getState().setPicks(['f-bob', 'f-carol']);
    const sent = render(finalVoting({ myRanking: ['f-bob', 'f-carol'], ranked: 1 }), 'host');
    expect(sent).toContain('Update ranking');
    expect(tagWith(sent, 'final-submit')).toContain('disabled');
    expect(attr(tagWith(sent, 'rank-count'), 'data-ranked')).toBe('1');
  });

  it('ranks the answers with medals, authors and points in the final result', () => {
    const finalResult = [
      { id: 'f-bob', text: 'bob final', authorId: 'bob', authorName: 'bob', points: 3000, rank: 1, fallback: false },
      { id: 'f-carol', text: 'carol final', authorId: 'carol', authorName: 'carol', points: 2000, rank: 2, fallback: false },
      { id: 'f-host', text: 'host final', authorId: 'host', authorName: 'host', points: 2000, rank: 2, fallback: false },
    ];
    const html = render(quipRoom(view({ phase: 'finalResult', round: 3, finalPrompt: 'The final prompt', finalResult, canSkip: true })), 'host');
    expect(tagsWith(html, 'final-row').map((r) => [attr(r, 'data-rank'), attr(r, 'data-author-name'), attr(r, 'data-points')])).toEqual([
      ['1', 'bob', '3000'],
      ['2', 'carol', '2000'],
      ['2', 'host', '2000'],
    ]);
    expect(html).toContain('🥇');
    expect(html).toContain('bob wins the final!');
    expect(html).toContain('>Show results<!-- --> (');
  });
});

describe('player list, chat and cues', () => {
  it('badges spectators, writers and finished writers, then voters', () => {
    const badge = (state: QuipgameRoomState, id: string) => renderToString(createElement('span', null, quipgameClient.playerBadge?.(state, player(id))));
    const writing = quipRoom(view({ finished: ['bob'], spectators: ['dave'] }));
    expect(badge(writing, 'bob')).toContain('player__badge--done');
    expect(badge(writing, 'host')).toContain('player__badge--writing');
    expect(badge(writing, 'dave')).toContain('player__badge--spectator');
    const voting = quipRoom(view({ phase: 'voting', matchup: MATCHUP, voted: ['host'] }));
    expect(badge(voting, 'host')).toContain('player__badge--done');
    expect(badge(voting, 'bob')).not.toContain('player__badge');
    expect(badge(quipRoom(view(), { game: null }), 'bob')).not.toContain('player__badge');
  });

  it('writes a phase-aware chat placeholder', () => {
    expect(quipgameClient.chatPlaceholder?.(quipRoom(view()), 'host')).toMatch(/spoilers/i);
    expect(quipgameClient.chatPlaceholder?.(quipRoom(view({ phase: 'voting' })), 'host')).toMatch(/vote first/i);
    expect(quipgameClient.chatPlaceholder?.(quipRoom(view(), { game: null }), 'host')).toBeUndefined();
  });

  it('drops drafts, the tapped answer and the picks when the step changes, seeds the picks from a sent ranking, and resets in the lobby', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', quipRoom(view())));
    const store = useQuipgameStore.getState();
    store.setDraft('r1-p0', 'hmm');
    store.openSheet('chat');
    snapshot(quipRoom(view({ done: 1 })));
    expect(useQuipgameStore.getState().drafts).toEqual({ 'r1-p0': 'hmm' });
    snapshot(quipRoom(view({ phase: 'voting', matchup: { ...MATCHUP, index: 0 }, canVote: true })));
    expect(useQuipgameStore.getState()).toMatchObject({ drafts: {}, sheet: 'chat' });
    useQuipgameStore.getState().selectChoice('a');
    snapshot(quipRoom(view({ phase: 'voting', matchup: { ...MATCHUP, index: 0, votes: 2 }, canVote: true, myVote: 'a' })));
    expect(useQuipgameStore.getState().selectedChoice).toBe('a');
    snapshot(quipRoom(view({ phase: 'result', result: { ...RESULT, index: 0 } })));
    expect(useQuipgameStore.getState().selectedChoice).toBeNull();
    // Each matchup is its own step: a second result in the same phase still clears the tap.
    snapshot(quipRoom(view({ phase: 'voting', matchup: { ...MATCHUP, index: 1 }, canVote: true })));
    useQuipgameStore.getState().selectChoice('b');
    snapshot(quipRoom(view({ phase: 'voting', matchup: { ...MATCHUP, index: 2 }, canVote: true })));
    expect(useQuipgameStore.getState().selectedChoice).toBeNull();
    snapshot(quipRoom(view({ phase: 'finalVoting', round: 3, finalAnswers: FINAL_ANSWERS, myAnswerId: 'f-host', maxPicks: 2, myRanking: ['f-bob'] })));
    expect(useQuipgameStore.getState().picks).toEqual(['f-bob']);
    snapshot(quipRoom(view(), { phase: 'lobby', game: null }));
    expect(useQuipgameStore.getState()).toMatchObject({ picks: [], sheet: null });
    quipgameClient.onLeave?.();
  });
});

describe('settings rows', () => {
  it('renders the sliders, the toggles and the custom prompt box for the host, read-only values otherwise', () => {
    const { settings } = quipRoom(view());
    if (!quipgameClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(quipgameClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-writeSeconds')).toContain('min="30"');
    expect(tagWith(host, 'settings-writeSeconds')).toContain('step="10"');
    expect(tagWith(host, 'settings-voteSeconds')).toContain('max="60"');
    expect(tagWith(host, 'settings-resultsSeconds')).toContain('max="20"');
    for (const id of ['cheeky', 'finalRound', 'announcer']) expect(tagWith(host, `settings-${id}`)).not.toContain('disabled');
    expect(tagWith(host, 'settings-finalRound')).toContain('checked');
    expect(host).toContain('Adult humour');
    expect(tagWith(host, 'settings-customPrompts')).toBeTruthy();
    expect(tagWith(host, 'settings-customPromptsOnly')).toContain('disabled');
    expect(host).toContain('Add at least 10 custom prompts');
    const guest = renderToString(createElement(quipgameClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-writeSeconds"');
    expect(guest).not.toContain('data-testid="settings-customPrompts"');
    expect(guest).toContain('90s');
    expect(tagWith(guest, 'settings-cheeky')).toContain('disabled');
    const enough = { ...settings, customPrompts: Array.from({ length: 10 }, (_, i) => `Prompt ${i}`) };
    const only = renderToString(createElement(quipgameClient.SettingsFields, { settings: enough, canEdit: true, patch: () => undefined }));
    expect(tagWith(only, 'settings-customPromptsOnly')).not.toContain('disabled');
    expect(only).toContain('10<!-- --> <!-- -->prompts');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(fileURLToPath(new URL('./quipgame.css', import.meta.url)), 'utf8');

  it('makes the answer cards 64px targets and keeps the input at 16px or more', () => {
    expect(css).toMatch(/\.quip-answer \{[^}]*min-height: 64px/);
    expect(css).toMatch(/\.quip-write__input \{[^}]*max\(1\.1rem, 16px\)/);
  });

  it('prefixes platform overrides inside the phone media query with the root class', () => {
    expect(css).toContain('.quip .timer--lg {');
    expect(css).not.toMatch(/\n {2}\.timer--lg \{/);
  });
});
