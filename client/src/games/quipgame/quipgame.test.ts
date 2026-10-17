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
import { gameById } from '@shared/platform/games';
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
    settings: { contentMode: 'family', ...DEFAULT_QUIPGAME_SETTINGS },
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

/** The text inside the first element with this test id (a button or a span with no nested tag of its kind). */
function textOf(html: string, testId: string): string {
  const tag = tagWith(html, testId);
  const name = tag.match(/^<(\w+)/)?.[1] ?? 'span';
  const start = html.indexOf(tag) + tag.length;
  return html.slice(start, html.indexOf(`</${name}>`, start)).replace(/<!-- -->/g, '');
}

describe('platform hold', () => {
  it('renders the result step with a paused timer while the game waits for players', () => {
    const waiting = { reason: 'players' as const, missing: ['carol'], needed: 3, connected: 2 };
    const html = render(quipRoom(view({ phase: 'writing', endsAt: NOW - 1000 }), { waiting }), 'bob');
    expect(tagWith(html, 'timer')).toContain('data-paused="players"');
    expect(tagWith(html, 'timer')).not.toContain('timer--urgent');
    expect(html).toContain('data-testid="quipgame-main"');
  });
});

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
    // The form mounts fresh after Edit, so it asks for focus; the next-prompt path keeps focus itself.
    expect(tagWith(editing, 'write-input')).toContain('autofocus');
    expect(tagWith(html, 'write-input')).not.toContain('autofocus');
  });

  it('drops the abandoned draft on Cancel, so the next Edit starts from the sent answer again', () => {
    const store = useQuipgameStore.getState();
    store.editPrompt('r1-p0');
    store.setDraft('r1-p0', 'Pia one edited');
    store.setDraft('r1-p2', 'kept');
    store.cancelEdit();
    expect(useQuipgameStore.getState()).toMatchObject({ editingPromptId: null, drafts: { 'r1-p2': 'kept' } });
    // Nothing being edited: nothing to drop.
    useQuipgameStore.getState().cancelEdit();
    expect(useQuipgameStore.getState().drafts).toEqual({ 'r1-p2': 'kept' });
  });

  it('keeps the counter quiet for screen readers and announces the limit through a described-by live region', () => {
    const html = render(quipRoom(view()), 'bob');
    expect(tagWith(html, 'write-counter')).not.toContain('aria-live');
    const limit = tagWith(html, 'write-limit');
    expect(limit).toContain('sr-only');
    expect(limit).toContain('aria-live="polite"');
    expect(attr(tagWith(html, 'write-input'), 'aria-describedby')).toBe(attr(limit, 'id'));
    expect(html).toContain('Up to 80 characters');
    useQuipgameStore.getState().setDraft('r1-p0', 'x'.repeat(80));
    const full = render(quipRoom(view()), 'bob');
    expect(full).toContain('Answer is at the 80 character limit');
    expect(tagWith(full, 'write-counter')).toContain('quip-write__counter--full');
  });

  it('tells a spectator they are watching, and disables the field once the game has ended', () => {
    // In the game but away when the round was dealt: votes now, writes from the next round.
    const audience = quipRoom(view({ isSpectator: true, myPrompts: [], spectators: ['dave'] }), {
      players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3 })],
    });
    const html = render(audience, 'dave');
    expect(attr(tagWith(html, 'quip-spectating'), 'data-watching')).toBe('false');
    expect(html).toContain('you write from the next round');
    expect(html).not.toContain('data-testid="write-input"');
    // A spectator of the whole game (sat out or joined mid-game) plays the next game.
    const watcher = quipRoom(view({ isSpectator: true, myPrompts: [] }), {
      players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3, participating: false })],
    });
    const watching = render(watcher, 'dave');
    expect(attr(tagWith(watching, 'quip-spectating'), 'data-watching')).toBe('true');
    expect(watching).toContain('You’re watching. You can play the next game.');
    expect(tagWith(watching, 'quip-spectating')).toBeTruthy();
    expect(watching.slice(watching.indexOf('data-testid="quip-spectating"'))).not.toMatch(/You vote/);
    const vote = render(quipRoom(view({ phase: 'voting', matchup: MATCHUP, canVote: false, isSpectator: true }), { players: watcher.players }), 'dave');
    expect(tagsWith(vote, 'vote-submit')).toHaveLength(0);
    expect(tagWith(vote, 'vote-watching')).toBeTruthy();
    expect(vote).toContain('You’re watching. You can play the next game.');
  });
});

describe('the vote and ranking counts', () => {
  it('count the connected players in the game only: a spectator of the whole game never votes', async () => {
    const { voterCount, rankerCount } = await import('./hooks');
    const state = quipRoom(view(), {
      players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3 }), player('eve', { joinOrder: 4, participating: false })],
    });
    expect(voterCount(state, 0)).toBe(2);
    expect(rankerCount(state, 0)).toBe(4);
  });
});

describe('voting', () => {
  const voting = (overrides: Partial<QuipgameView> = {}) => quipRoom(view({ phase: 'voting', matchup: MATCHUP, canVote: true, ...overrides }));

  it('gives a voter two equal A/B cards, the prompt, Vote and the live count; a tapped answer shows as selected with a check', () => {
    const html = render(voting(), 'host');
    expect(attr(tagWith(html, 'quip-voting'), 'data-can-vote')).toBe('true');
    expect(html).toContain(MATCHUP.prompt);
    const answers = tagsWith(html, 'vote-answer');
    expect(answers.map((a) => attr(a, 'data-choice'))).toEqual(['a', 'b']);
    expect(answers.every((a) => a.startsWith('<button') && !a.includes('disabled'))).toBe(true);
    expect(attr(tagWith(html, 'vote-count'), 'data-votes')).toBe('1');
    expect(attr(tagWith(html, 'vote-count'), 'data-voters')).toBe('1');
    expect(html).not.toContain('data-testid="quip-announcer"');
    // Nothing picked yet: Vote waits for a tap.
    expect(tagWith(html, 'vote-submit')).toContain('disabled');
    expect(html).not.toContain('quip-answer__check');
    useQuipgameStore.getState().selectChoice('b');
    const tapped = render(voting(), 'host');
    expect(tagsWith(tapped, 'vote-answer').map((a) => attr(a, 'data-selected'))).toEqual(['false', 'true']);
    expect(tapped.match(/quip-answer__check/g)).toHaveLength(1);
    expect(tagWith(tapped, 'vote-submit')).not.toContain('disabled');
    // A changed pick shows at once: the tap wins over the server's older echo until the step changes.
    const changed = render(voting({ myVote: 'a' }), 'host');
    expect(tagsWith(changed, 'vote-answer').map((a) => attr(a, 'data-selected'))).toEqual(['false', 'true']);
    expect(changed).toContain('Change vote');
    useQuipgameStore.getState().selectChoice(null);
    const echoed = render(voting({ myVote: 'a' }), 'host');
    expect(tagsWith(echoed, 'vote-answer').map((a) => attr(a, 'data-selected'))).toEqual(['true', 'false']);
    expect(attr(tagWith(echoed, 'vote-submit'), 'data-sent')).toBe('true');
    expect(echoed).toContain('Voted');
  });

  it('shows an author the answers without buttons and a sit-tight card; the announcer gets the read-out card on top', () => {
    const author = render(voting({ canVote: false, isAuthor: true }), 'bob');
    expect(tagWith(author, 'vote-author')).toBeTruthy();
    expect(author).toContain('yours, sit tight');
    expect(tagsWith(author, 'vote-answer').every((a) => a.startsWith('<div'))).toBe(true);
    // The letters are hidden from assistive tech, so the static cards carry them in their label.
    expect(tagsWith(author, 'vote-answer').map((a) => attr(a, 'aria-label'))).toEqual([`A: ${MATCHUP.a}`, `B: ${MATCHUP.b}`]);
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
    // The name truncates in a block of its own: a flex container never shows an ellipsis.
    expect(tagsWith(host, 'result-author').every((t) => t.includes('quip-result__name-text'))).toBe(true);
    expect(tagsWith(host, 'result-author')).toHaveLength(2);
    expect(host).toContain('+1250');
    expect(host).toContain('ran out of time');
    expect(tagWith(host, 'quip-next')).toBeTruthy();
    // The host's Next carries no second countdown: the top bar's ring is the screen's one.
    expect(textOf(host, 'quip-next')).toBe('Next');
    expect(tagsWith(host, 'timer')).toHaveLength(1);
    const guest = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: false })), 'bob');
    expect(guest).not.toContain('data-testid="quip-next"');
    expect(tagWith(guest, 'result-countdown')).toBeTruthy();
    // The last matchup of round two leads into the final.
    const last = render(quipRoom(view({ phase: 'result', round: 2, multiplier: 2, result: { ...RESULT, index: 2 }, canSkip: true })), 'host');
    expect(textOf(last, 'quip-next')).toBe('Final round');
  });
});

describe('result countdowns under a hold', () => {
  const hold = { reason: 'players' as const, missing: ['carol'], needed: 3, connected: 2 };

  it('reads as paused while the game holds and as starting, not "0", once the time ran out', () => {
    const held = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: false, endsAt: NOW - 2_000 }), { waiting: hold }), 'host');
    expect(tagWith(held, 'result-countdown')).toContain('data-countdown="paused"');
    expect(held).toContain('Next is paused');
    expect(held).not.toContain('data-testid="quip-next"');
    expect(tagWith(held, 'timer')).toContain('data-paused="players"');

    const settlingGuest = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: false, endsAt: NOW - 2_000 })), 'bob');
    expect(tagWith(settlingGuest, 'result-countdown')).toContain('data-countdown="settling"');
    expect(settlingGuest).toContain('Next is starting');
    expect(settlingGuest).not.toContain('Next in 0');
    const settlingHost = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: true, endsAt: NOW - 2_000 })), 'host');
    expect(tagWith(settlingHost, 'quip-next')).toContain('data-countdown="settling"');
    expect(settlingHost).not.toContain('(0)');

    const running = render(quipRoom(view({ phase: 'result', result: RESULT, canSkip: false, endsAt: NOW + 8_000 })), 'bob');
    expect(tagWith(running, 'result-countdown')).toContain('data-countdown="running"');
    expect(textOf(running, 'result-countdown')).toBe('Next soon');
    expect(tagsWith(running, 'timer')).toHaveLength(1);

    // The final result's footer behaves the same.
    const finalHeld = render(
      quipRoom(view({ phase: 'finalResult', round: 3, finalPrompt: 'The final prompt', finalResult: [], canSkip: false, endsAt: NOW - 2_000 }), { waiting: hold }),
      'bob',
    );
    expect(tagWith(finalHeld, 'result-countdown')).toContain('data-countdown="paused"');
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
    // The hint promises only the medals on offer: two picks, two medals.
    expect(html).toContain('Tap your top 2 in order: gold, silver. Tap again');
    expect(html).not.toContain('bronze');
    expect(render(finalVoting({ maxPicks: 1 }), 'host')).toContain('Tap your favourite answer for gold.');
    expect(render(finalVoting({ myAnswerId: null, maxPicks: 3 }), 'host')).toContain('top 3 in order: gold, silver, bronze.');
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
    expect(textOf(html, 'quip-next')).toBe('Show results');
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

  it('drops drafts, the tapped answer and the picks when the step changes, seeds the picks from a sent ranking, and resets in the lobby', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', quipRoom(view())));
    const store = useQuipgameStore.getState();
    store.setDraft('r1-p0', 'hmm');
    store.openSheet('players');
    snapshot(quipRoom(view({ done: 1 })));
    expect(useQuipgameStore.getState().drafts).toEqual({ 'r1-p0': 'hmm' });
    snapshot(quipRoom(view({ phase: 'voting', matchup: { ...MATCHUP, index: 0 }, canVote: true })));
    expect(useQuipgameStore.getState()).toMatchObject({ drafts: {}, sheet: 'players' });
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
  it('renders only the custom prompt box with its upload button and its custom-only switch: no clocks, final round or announcer', () => {
    const { settings } = quipRoom(view());
    if (!quipgameClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(quipgameClient.SettingsFields, { settings, patch: () => undefined }));
    for (const id of ['writeSeconds', 'voteSeconds', 'resultsSeconds', 'finalRound', 'announcer']) {
      expect(tagsWith(host, `settings-${id}`), id).toHaveLength(0);
      expect(tagsWith(host, `settings-row-${id}`), id).toHaveLength(0);
    }
    expect(host).not.toContain('range-field');
    expect(tagWith(host, 'settings-customPrompts')).toBeTruthy();
    expect(tagWith(host, 'settings-customPromptsOnly')).toContain('disabled');
    expect(host).toContain('Add at least 10 custom prompts');
    expect(host).not.toContain('setting__value');
    expect(host).not.toContain('settings-cheeky');
    expect(tagWith(host, 'settings-customPrompts-upload')).toContain('btn--secondary');
    expect(host).toContain('Upload a .txt file');
    expect(tagWith(host, 'settings-customPrompts-file')).toContain('accept=".txt,text/plain"');
    const enough = { ...settings, customPrompts: Array.from({ length: 10 }, (_, i) => `Prompt ${i}`) };
    const only = renderToString(createElement(quipgameClient.SettingsFields, { settings: enough, patch: () => undefined }));
    expect(tagWith(only, 'settings-customPromptsOnly')).not.toContain('disabled');
    expect(only).toContain('10<!-- --> <!-- -->prompts');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(fileURLToPath(new URL('./quipgame.css', import.meta.url)), 'utf8');

  it("folds the announcer’s card to its one line on a phone, where the matchup under it shows the same words", () => {
    expect(css).toMatch(/\.quip--phone \.quip-announce__prompt,\s*\.quip--phone \.quip-announce__answers \{\s*display: none;/);
  });

  it('makes the answer cards 64px targets and keeps the input at 16px or more', () => {
    expect(css).toMatch(/\.quip-answer \{[^}]*min-height: 64px/);
    expect(css).toMatch(/\.quip-write__input \{[^}]*max\(1\.1rem, 16px\)/);
  });

  it('keeps the chosen vote card in its selected colours after a tap: hover is pointer-only and never beats the selection', () => {
    expect(css).toMatch(/@media \(hover: hover\) \{\s*button\.quip-answer:hover:not\(:disabled\):not\(\.quip-answer--selected\) \{/);
    expect(css).not.toMatch(/\nbutton\.quip-answer:hover/);
    expect(css).toMatch(/button\.quip-answer\.quip-answer--selected:hover[^{]*\{[^}]*background: var\(--color-secondary-soft\)/);
  });

  it('lets the result name ellipsize in its own block, wraps the badge row and keeps the tag whole', () => {
    expect(css).toMatch(/\.quip-result__name-text \{[^}]*display: block;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).not.toMatch(/\.quip-result__name \{[^}]*text-overflow/);
    expect(css).toMatch(/\.quip-result__who \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\.quip-result__tag \{[^}]*flex: none;[^}]*white-space: nowrap;/);
    const smallest = css.slice(css.indexOf('@media (max-width: 360px)'));
    expect(smallest).toMatch(/\.quip-final__row \{[^}]*flex-wrap: wrap;/);
    expect(smallest).toMatch(/\.quip-final__row \.quip-result__points \{[^}]*flex-basis: 100%;/);
  });

  it('inks the flawless badge dark enough to read on the accent (WCAG AA for small text)', () => {
    const ink = css.match(/--quip-accent-ink: (#[0-9a-f]{6});/)?.[1];
    expect(ink).toBeDefined();
    expect(css).toMatch(/\.quip-result__flawless \{[^}]*color: var\(--quip-accent-ink\);/);
    const luminance = (hex: string): number => {
      const channel = (i: number) => {
        const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
    };
    const [light, dark] = [luminance(gameById('quipgame').accent), luminance(ink ?? '#ffffff')].sort((a, b) => b - a);
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('never overrides a platform class unprefixed, and leaves the bar timer to the shared top bar', () => {
    expect(css).not.toMatch(/\n {2}\.timer--lg \{/);
    expect(css).not.toContain('.quip .timer--lg {');
    const bar = readFileSync(fileURLToPath(new URL('../../platform/styles/gamebar.css', import.meta.url)), 'utf8');
    expect(bar).toContain('.gbar .timer--lg {');
  });
});
