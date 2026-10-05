/**
 * The Spy Game's client module under test: the screen per role and phase, the vote sheet, the
 * reveal, the settings rows, the snapshot-driven cues and the location tiles. Runs in node:
 * browser globals are stubbed, components render through react-dom/server.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { SPY_LOCATIONS } from '@shared/games/spygame/locations';
import type { SpygameRoomState, SpygameView } from '@shared/games/spygame/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { spygameClient } = await import('./module');
const { useSpygameStore } = await import('./store');
const { locationImage, pickImages } = await import('./images');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const CANDIDATES = SPY_LOCATIONS.slice(0, 24).map((l) => l.id);
const LOCATION = 'beach';
const NOW = Date.now();

const roundPlayers = ['host', 'bob', 'carol', 'dave'];

function view(overrides: Partial<SpygameView> = {}): SpygameView {
  const players = Object.fromEntries(roundPlayers.map((id) => [id, { hasAccused: false, isAccused: false, isSpectator: false }]));
  return {
    phase: 'playing',
    round: 1,
    totalRounds: 2,
    clock: { endsAt: NOW + 120_000, pausedRemainingMs: null, pausedReason: null, waitingForId: null },
    candidates: CANDIDATES,
    guessesLeft: 2,
    spyGuessed: [],
    roundPlayers,
    spectators: [],
    players,
    vote: null,
    reveal: null,
    role: 'agent',
    locationId: LOCATION,
    ...overrides,
  };
}

/** A three-player round as the server would snapshot it for one recipient. */
function spyRoom(game: SpygameView, overrides: Partial<SpygameRoomState> = {}): SpygameRoomState {
  return {
    ...room({ gameId: 'spygame', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3 })] }),
    settings: { maxPlayers: 12, allowMidGameJoin: true, rounds: 2, roundMinutes: 3, voteSeconds: 15 },
    game,
    ...overrides,
  } as SpygameRoomState;
}

/** Bob accuses the host; Carol is the spy, so Dave is the one voter still to decide (the view only ever says whether its recipient may vote). */
const VOTE = { accuserId: 'bob', accusedId: 'host', yes: 1, no: 0, endsAt: NOW + 15_000, canVote: true, myVote: null };
const REVEAL = { outcome: 'spyCaught' as const, spyId: 'host', spyName: 'host', locationId: LOCATION, points: { bob: 3, carol: 1 }, endsAt: NOW + 15_000 };

function render(state: SpygameRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  return renderToString(createElement(spygameClient.Screen, { room: state, meId, isHost }));
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
function snapshot(state: SpygameRoomState): void {
  const prev = usePlatformStore.getState().room as SpygameRoomState | null;
  usePlatformStore.getState().handleServerMessage({ t: 'room', room: state });
  spygameClient.onRoom?.(state, prev);
}

beforeEach(() => {
  resetStore();
  useSpygameStore.getState().reset();
  setLocation('/spygame/ABCD');
  registerGames(registryOf(spygameClient));
});

describe('the screen per role', () => {
  it('shows an agent the location, the ticked reference grid, the guess counter and tappable player rows', () => {
    const html = render(spyRoom(view()), 'bob');
    expect(attr(tagWith(html, 'spygame-role'), 'data-role')).toBe('agent');
    expect(attr(tagWith(html, 'spygame-location'), 'data-location-id')).toBe(LOCATION);
    expect(attr(tagWith(html, 'spygame-guesses-left'), 'data-count')).toBe('2');
    const tiles = tagsWith(html, 'candidate-tile');
    expect(tiles).toHaveLength(24);
    expect(tiles.filter((t) => attr(t, 'data-state') === 'real').map((t) => attr(t, 'data-location-id'))).toEqual([LOCATION]);
    expect(html).not.toContain('data-testid="guess-tile"');
    const rows = tagsWith(html, 'accuse-row');
    expect(rows.map((r) => [attr(r, 'data-player-id'), attr(r, 'data-state')])).toEqual([
      ['host', 'idle'],
      ['bob', 'disabled'],
      ['carol', 'idle'],
      ['dave', 'idle'],
    ]);
    expect(rows.every((r) => r.startsWith('<button'))).toBe(true);
    expect(attr(tagWith(html, 'timer'), 'data-paused')).toBeUndefined();
  });

  it('shows the spy their brief, no location, 24 guess tiles with wrong guesses crossed out, and read-only players', () => {
    const html = render(spyRoom(view({ role: 'spy', locationId: null, spyGuessed: ['airplane'], guessesLeft: 1 })), 'host');
    expect(attr(tagWith(html, 'spygame-role'), 'data-role')).toBe('spy');
    expect(html).not.toContain('data-testid="spygame-location"');
    expect(html).not.toContain('data-testid="candidate-tile"');
    const tiles = tagsWith(html, 'guess-tile');
    expect(tiles).toHaveLength(24);
    const out = tiles.find((t) => attr(t, 'data-location-id') === 'airplane');
    expect(out).toContain('data-state="ruledOut"');
    expect(out).toContain('disabled');
    expect(tiles.filter((t) => t.includes('disabled'))).toHaveLength(1);
    expect(tagsWith(html, 'accuse-row').every((r) => attr(r, 'data-state') === 'readonly' && r.startsWith('<div'))).toBe(true);
    expect(attr(tagWith(html, 'spygame-wrong-guess'), 'data-guesses-left')).toBe('1');
  });

  it('tells a mid-round joiner they are watching and shows the reference grid without a tick', () => {
    const state = spyRoom(view({ role: 'spectator', locationId: null, spectators: ['eve'] }), {
      players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3 }), player('eve', { joinOrder: 4 })],
    });
    state.game!.players.eve = { hasAccused: false, isAccused: false, isSpectator: true };
    const html = render(state, 'eve');
    expect(attr(tagWith(html, 'spygame-role'), 'data-role')).toBe('spectator');
    expect(tagsWith(html, 'candidate-tile').some((t) => attr(t, 'data-state') === 'real')).toBe(false);
    expect(html).toContain('data-testid="players-toggle"');
  });

  it('freezes the clock with the kept time while a vote runs and while the spy is away', () => {
    const voting = render(spyRoom(view({ phase: 'voting', vote: VOTE, clock: { endsAt: null, pausedRemainingMs: 61_000, pausedReason: 'vote', waitingForId: null } })), 'carol');
    expect(tagWith(voting, 'timer')).toContain('data-paused="vote"');
    expect(tagWith(voting, 'timer')).toContain('data-seconds="61"');
    const away = render(spyRoom(view({ clock: { endsAt: null, pausedRemainingMs: 30_000, pausedReason: 'spyAway', waitingForId: 'host' } })), 'bob');
    expect(tagWith(away, 'timer')).toContain('data-paused="spyAway"');
    expect(tagWith(away, 'spygame-waiting')).toBeTruthy();
    expect(away).toContain('waiting for host to come back');
  });
});

describe('voting', () => {
  const voting = (role: SpygameView['role'], myVote: boolean | null = null) => spyRoom(view({ phase: 'voting', role, locationId: role === 'spy' ? null : LOCATION, vote: { ...VOTE, canVote: role === 'agent', myVote } }));

  it('offers the sheet with Yes/No to an eligible voter (opened by the snapshot), the panel to everyone', () => {
    usePlatformStore.getState().handleServerMessage(welcome('dave', spyRoom(view())));
    snapshot(voting('agent'));
    expect(useSpygameStore.getState().voteSheetOpen).toBe(true);
    const html = renderToString(createElement(spygameClient.Screen, { room: voting('agent'), meId: 'dave', isHost: false }));
    expect(tagWith(html, 'vote-sheet')).toBeTruthy();
    expect(tagsWith(html, 'vote-yes')).toHaveLength(1);
    expect(tagsWith(html, 'vote-no')).toHaveLength(1);
    expect(attr(tagWith(html, 'vote-panel'), 'data-role')).toBe('voter');
    expect(attr(tagWith(html, 'vote-tally'), 'data-yes')).toBe('1');
    expect(attr(tagWith(html, 'vote-tally'), 'data-no')).toBe('0');
    // No "to go" count: how many may vote would tell the room whether the accused is the spy.
    expect(tagWith(html, 'vote-tally')).not.toContain('data-pending');
    expect(html).not.toMatch(/to go/);
    expect(html).not.toContain('data-testid="vote-open"');
    // The round clock is held: no guess, no new accusation.
    expect(tagsWith(html, 'accuse-row').every((r) => attr(r, 'data-state') === 'disabled')).toBe(true);
  });

  it('lets a voter who closed the sheet reopen it from the panel and shows their cast vote', () => {
    useSpygameStore.getState().setVoteSheetOpen(false);
    const html = render(voting('agent', true), 'dave');
    expect(html).not.toContain('data-testid="vote-sheet"');
    expect(tagWith(html, 'vote-open')).toBeTruthy();
    expect(html).toContain('You voted <!-- -->Yes');
  });

  it('gives the spy and the accused the tally only, and the accuser their fixed Yes', () => {
    const spy = render(voting('spy'), 'carol');
    expect(spy).not.toContain('data-testid="vote-yes"');
    expect(attr(tagWith(spy, 'vote-panel'), 'data-role')).toBe('watcher');
    expect(attr(tagWith(spy, 'vote-panel-tally'), 'data-yes')).toBe('1');
    useSpygameStore.getState().setVoteSheetOpen(true);
    const accused = render(voting('agent'), 'host');
    expect(attr(tagWith(accused, 'vote-panel'), 'data-role')).toBe('accused');
    expect(accused).toMatch(/been accused!/);
    expect(accused).not.toContain('data-testid="vote-sheet"');
    const accuser = render(voting('agent'), 'bob');
    expect(attr(tagWith(accuser, 'vote-panel'), 'data-role')).toBe('accuser');
    expect(accuser).toContain('counted as Yes');
    expect(accuser).not.toContain('data-testid="vote-yes"');
  });

  it('puts the countdown and the tally above the Yes/No in the sheet, so a short landscape sheet still shows them', () => {
    useSpygameStore.getState().setVoteSheetOpen(true);
    const html = render(voting('agent'), 'dave');
    const sheet = html.slice(html.indexOf('data-testid="vote-sheet"'));
    expect(sheet.indexOf('data-testid="vote-tally"')).toBeLessThan(sheet.indexOf('data-testid="vote-yes"'));
    expect(sheet.indexOf('data-testid="timer"')).toBeLessThan(sheet.indexOf('data-testid="vote-yes"'));
    expect(tagWith(html, 'vote')).toContain('spy-vote--sheet');
  });

  it('closes the chat sheet when the vote sheet opens and renders the vote sheet above the other sheets', () => {
    usePlatformStore.getState().handleServerMessage(welcome('dave', spyRoom(view())));
    useSpygameStore.getState().openSheet('chat');
    snapshot(voting('agent'));
    expect(useSpygameStore.getState()).toMatchObject({ voteSheetOpen: true, sheet: null });
    // Were a sheet open anyway, the vote sheet comes last in the tree and stacks on top.
    useSpygameStore.getState().openSheet('players');
    const html = renderToString(createElement(spygameClient.Screen, { room: voting('agent'), meId: 'dave', isHost: false }));
    expect(html.indexOf('data-testid="players-sheet"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="vote-sheet"')).toBeGreaterThan(html.indexOf('data-testid="players-sheet"'));
  });
});

describe('the reveal', () => {
  const reveal = (meId: string) =>
    render(
      spyRoom(
        view({
          phase: 'reveal',
          role: meId === 'host' ? 'spy' : 'agent',
          clock: { endsAt: null, pausedRemainingMs: 180_000, pausedReason: 'reveal', waitingForId: null },
          reveal: REVEAL,
        }),
      ),
      meId,
    );

  it('names the spy and the location with the points, Next round and Back to lobby for the host, a countdown for the rest', () => {
    const host = reveal('host');
    expect(attr(tagWith(host, 'spygame-reveal'), 'data-outcome')).toBe('spyCaught');
    expect(attr(tagWith(host, 'reveal-spy'), 'data-player-id')).toBe('host');
    expect(attr(tagWith(host, 'reveal-location'), 'data-location-id')).toBe(LOCATION);
    expect(tagsWith(host, 'reveal-points-row').map((r) => [attr(r, 'data-name'), attr(r, 'data-points')])).toEqual([
      ['bob', '3'],
      ['carol', '1'],
    ]);
    expect(tagWith(host, 'spygame-next-round')).toBeTruthy();
    expect(tagWith(host, 'spygame-end-game')).toBeTruthy();
    expect(host).not.toContain('data-testid="reveal-countdown"');
    const guest = reveal('bob');
    expect(tagWith(guest, 'reveal-countdown')).toBeTruthy();
    expect(guest).not.toContain('data-testid="spygame-next-round"');
    expect(guest).not.toContain('data-testid="spygame-wrong-guess"');
  });

  it('names a spy who has left the room from the reveal itself and styles the points with game-owned classes', () => {
    const left = spyRoom(view({ phase: 'reveal', roundPlayers: ['bob', 'carol', 'dave'], reveal: { ...REVEAL, outcome: 'spyLeft', spyName: 'Hana', points: { bob: 1, carol: 1, dave: 1 } } }), {
      players: [player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3 })],
    });
    const html = render(left, 'bob', false);
    expect(attr(tagWith(html, 'reveal-spy'), 'data-player-id')).toBe('host');
    expect(html).toContain('Hana');
    expect(html).not.toContain('Someone');
    expect(html).toContain('class="spy-points spy-reveal__points"');
    expect(html).not.toContain('points-list');
    const css = readFileSync(fileURLToPath(new URL('./spygame.css', import.meta.url)), 'utf8');
    for (const cls of ['.spy-points {', '.spy-points__row {', '.spy-points__name {', '.spy-points__tag {', '.spy-points__pts {']) expect(css).toContain(cls);
  });

  it('hands the spy badge and the round points to the player list only during the reveal', () => {
    const state = spyRoom(view({ phase: 'reveal', reveal: { ...REVEAL, points: { bob: 3 }, endsAt: NOW }, players: { host: { hasAccused: false, isAccused: false, isSpectator: false }, bob: { hasAccused: true, isAccused: false, isSpectator: false }, carol: { hasAccused: false, isAccused: false, isSpectator: true } } }));
    const badge = (id: string) => renderToString(createElement('span', null, spygameClient.playerBadge?.(state, player(id))));
    expect(badge('host')).toContain('player__badge--spy');
    expect(badge('carol')).toContain('player__badge--spectator');
    expect(badge('bob')).not.toContain('player__badge');
    expect(renderToString(createElement('span', null, spygameClient.playerMeta?.(state, player('bob'))))).toContain('+3');
    const playing = spyRoom(view({ players: { ...state.game!.players, bob: { hasAccused: false, isAccused: true, isSpectator: false } } }));
    expect(badge('host')).toContain('player__badge--spy');
    expect(renderToString(createElement('span', null, spygameClient.playerBadge?.(playing, player('host'))))).not.toContain('player__badge');
    expect(renderToString(createElement('span', null, spygameClient.playerBadge?.(playing, player('bob'))))).toContain('player__badge--accused');
  });
});

describe('snapshot cues and local state', () => {
  it('opens the vote sheet for eligible voters only, closes it when the vote ends, and drops highlights on a new round', () => {
    usePlatformStore.getState().handleServerMessage(welcome('dave', spyRoom(view())));
    const store = useSpygameStore.getState();
    store.highlightPlayer('host');
    store.highlightLocation('airplane');
    snapshot(spyRoom(view({ phase: 'voting', vote: VOTE, clock: { endsAt: null, pausedRemainingMs: 100_000, pausedReason: 'vote', waitingForId: null } })));
    // Both pending taps are dropped: neither a guess nor an accusation may be sent while the vote runs.
    expect(useSpygameStore.getState()).toMatchObject({ voteSheetOpen: true, highlightedPlayer: null, highlightedLocation: null });
    snapshot(spyRoom(view({ phase: 'playing' })));
    expect(useSpygameStore.getState().voteSheetOpen).toBe(false);
    // The accuser and the accused get no sheet (the server marks neither as able to vote).
    snapshot(spyRoom(view({ phase: 'voting', vote: { ...VOTE, accuserId: 'dave', accusedId: 'bob', canVote: false } })));
    expect(useSpygameStore.getState().voteSheetOpen).toBe(false);
    snapshot(spyRoom(view({ phase: 'playing' })));
    snapshot(spyRoom(view({ phase: 'voting', vote: { ...VOTE, accuserId: 'bob', accusedId: 'dave', canVote: false } })));
    expect(useSpygameStore.getState().voteSheetOpen).toBe(false);
    snapshot(spyRoom(view({ phase: 'playing' })));
    snapshot(spyRoom(view({ round: 2 })));
    expect(useSpygameStore.getState()).toMatchObject({ highlightedPlayer: null, highlightedLocation: null, voteSheetOpen: false });
    // A wrong guess clears a pending tile highlight (the spy's tile may now be ruled out).
    useSpygameStore.getState().highlightLocation('beach');
    snapshot(spyRoom(view({ round: 2, spyGuessed: ['beach'], guessesLeft: 1 })));
    expect(useSpygameStore.getState().highlightedLocation).toBeNull();
    useSpygameStore.getState().highlightPlayer('host');
    useSpygameStore.getState().openSheet('chat');
    snapshot(spyRoom(view(), { phase: 'lobby', game: null }));
    expect(useSpygameStore.getState()).toMatchObject({ highlightedPlayer: null, sheet: null });
    spygameClient.onLeave?.();
  });

  it('forgets a highlighted tile whenever the grid stops being tappable, and never draws a disabled tile as highlighted', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', spyRoom(view({ role: 'spy', locationId: null }))));
    const spyView = (overrides: Partial<SpygameView> = {}) => view({ role: 'spy', locationId: null, ...overrides });
    const paused = { endsAt: null, pausedRemainingMs: 90_000, pausedReason: 'spyAway' as const, waitingForId: 'host' };
    // The spy's socket dropped and came back: the pause forgets the tile.
    useSpygameStore.getState().highlightLocation('airplane');
    snapshot(spyRoom(spyView({ clock: paused })));
    expect(useSpygameStore.getState().highlightedLocation).toBeNull();
    // A vote: the same, and the store is not even consulted for the tile's look.
    useSpygameStore.getState().highlightLocation('airplane');
    snapshot(spyRoom(spyView({ phase: 'voting', vote: { ...VOTE, canVote: false }, clock: { ...paused, pausedReason: 'vote', waitingForId: null } })));
    expect(useSpygameStore.getState().highlightedLocation).toBeNull();
    useSpygameStore.getState().highlightLocation('airplane');
    const html = renderToString(createElement(spygameClient.Screen, { room: spyRoom(spyView({ phase: 'voting', vote: { ...VOTE, canVote: false }, clock: { ...paused, pausedReason: 'vote', waitingForId: null } })), meId: 'host', isHost: true }));
    const tile = tagsWith(html, 'guess-tile').find((t) => attr(t, 'data-location-id') === 'airplane');
    expect(tile).toContain('data-state="idle"');
    expect(tile).toContain('disabled');
    expect(html).not.toContain('Tap again to confirm');
    // A highlight survives a snapshot that keeps the grid tappable (another agent's chat line, say).
    useSpygameStore.getState().highlightLocation('airplane');
    snapshot(spyRoom(spyView()));
    expect(useSpygameStore.getState().highlightedLocation).toBe('airplane');
    expect(render(spyRoom(spyView()), 'host')).toContain('Tap again to confirm');
  });

  it('toasts what a scrolled phone would miss: a wrong guess, a vote one cannot join, the spy-away pause', () => {
    usePlatformStore.getState().handleServerMessage(welcome('carol', spyRoom(view())));
    const texts = () => usePlatformStore.getState().toasts.map((t) => [t.kind, t.text]);
    snapshot(spyRoom(view({ spyGuessed: ['airplane'], guessesLeft: 1 })));
    expect(texts()).toEqual([['warning', 'The spy guessed wrong — 1 guess left']]);
    // Carol is the spy here: no sheet, so a toast tells her a vote is on. The sheet is the voters' notice.
    snapshot(spyRoom(view({ phase: 'voting', spyGuessed: ['airplane'], guessesLeft: 1, role: 'spy', locationId: null, vote: { ...VOTE, canVote: false } })));
    expect(texts()).toContainEqual(['info', 'bob accuses host of being the spy — vote now']);
    expect(useSpygameStore.getState().voteSheetOpen).toBe(false);
    snapshot(spyRoom(view({ spyGuessed: ['airplane'], guessesLeft: 1, role: 'spy', locationId: null })));
    snapshot(spyRoom(view({ spyGuessed: ['airplane'], guessesLeft: 1, role: 'spy', locationId: null, clock: { endsAt: null, pausedRemainingMs: 50_000, pausedReason: 'spyAway', waitingForId: 'carol' } })));
    expect(texts()).toContainEqual(['info', 'Clock paused — waiting for carol to come back']);
    expect(texts()).toHaveLength(3);
    // The accused hears it in the second person; a voter gets the sheet, not a toast.
    usePlatformStore.getState().handleServerMessage(welcome('host', spyRoom(view())));
    snapshot(spyRoom(view({ phase: 'voting', vote: { ...VOTE, canVote: false } })));
    expect(texts()).toContainEqual(['info', 'bob accuses you of being the spy! The others are voting.']);
    usePlatformStore.getState().handleServerMessage(welcome('dave', spyRoom(view())));
    const before = texts().length;
    snapshot(spyRoom(view({ phase: 'voting', vote: VOTE })));
    expect(texts()).toHaveLength(before);
    expect(useSpygameStore.getState().voteSheetOpen).toBe(true);
  });

  it('writes a role-aware chat placeholder', () => {
    expect(spygameClient.chatPlaceholder?.(spyRoom(view({ role: 'spy' })), 'host')).toMatch(/ask out loud/i);
    expect(spygameClient.chatPlaceholder?.(spyRoom(view()), 'bob')).toMatch(/out loud/i);
    expect(spygameClient.chatPlaceholder?.(spyRoom(view(), { game: null }), 'bob')).toBeUndefined();
  });
});

describe('settings rows', () => {
  it('renders the three sliders with the shared limits for the host and read-only values otherwise', () => {
    const { settings } = spyRoom(view());
    if (!spygameClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(spygameClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-rounds')).toContain('min="1"');
    expect(tagWith(host, 'settings-rounds')).toContain('max="10"');
    expect(tagWith(host, 'settings-roundMinutes')).toContain('max="15"');
    expect(tagWith(host, 'settings-voteSeconds')).toContain('step="5"');
    const guest = renderToString(createElement(spygameClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-rounds"');
    expect(guest).toContain('3 min');
    expect(guest).toContain('15s');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(fileURLToPath(new URL('./spygame.css', import.meta.url)), 'utf8');

  it('keys the four-column reference grid on the layout class, not the viewport width (landscape phones are wide too)', () => {
    expect(css).toContain('.spy:not(.spy--phone) .spy-grid--reference {');
    expect(css).not.toMatch(/min-width: 761px/);
  });

  it('wraps place names at spaces only and keeps the mark off the name', () => {
    expect(css).toMatch(/\.spy-tile__name \{[^}]*overflow-wrap: normal/);
    expect(css).not.toMatch(/hyphens: auto/);
    expect(css).toMatch(/\.spy-tile--real:not\(\.spy-tile--lg\) \.spy-tile__body,\s*\.spy-tile--ruledOut:not\(\.spy-tile--lg\) \.spy-tile__body \{\s*padding-right: 28px/);
  });

  it('keeps notices in view in the scrolling column and the reveal footer reachable', () => {
    expect(css).toMatch(/\.spy__banner \{[^}]*position: sticky/);
    expect(css).toMatch(/\.spy-reveal__footer \{[^}]*position: sticky/);
    expect(css).toMatch(/@media \(max-width: 360px\) \{[^@]*\.spy__round--compact small \{\s*display: none/);
  });
});

describe('location tiles', () => {
  it('has a generated svg for every location in the pack and resolves it', () => {
    const dir = fileURLToPath(new URL('./assets/locations', import.meta.url));
    for (const l of SPY_LOCATIONS) {
      expect(existsSync(join(dir, `${l.id}.svg`)), `${l.id}.svg`).toBe(true);
      expect(locationImage(l.id), l.id).toMatch(/\.svg|^data:image\/svg/);
    }
    expect(locationImage('nowhere')).toBeNull();
  });

  it('prefers a dropped-in photo over the generated svg', () => {
    const files = { './assets/locations/beach.svg': 'beach.svg', './assets/locations/beach.jpg': 'beach.jpg', './assets/locations/zoo.webp': 'zoo.webp', './assets/locations/zoo.svg': 'zoo.svg', './assets/locations/bank.svg': 'bank.svg' };
    expect(pickImages(files)).toEqual({ beach: 'beach.jpg', zoo: 'zoo.webp', bank: 'bank.svg' });
  });
});
