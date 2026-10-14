/**
 * Poker's client module under test: the table per phase and role, the hole cards that only their
 * owner sees, the action bar and the bet/raise panel with its presets, the results with revealed
 * hands, the host's End game, the settings rows, the player-list hooks and the snapshot-driven
 * store. Runs in node: browser globals are stubbed, components render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_POKER_SETTINGS, type Card, type PokerActions, type PokerPlayerView, type PokerRoomState, type PokerView } from '@shared/games/poker/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { pokerClient } = await import('./module');
const { usePokerStore } = await import('./store');
const { highestBet, seatRing } = await import('./hooks');
const { clampAmount, presetsFor, raiseRange } = await import('./lib/raise');
const { handHint, handLabel, lastActionLabel, netLabel, phaseKicker } = await import('./lib/text');
const { blindsIncreaseLabel, handsLabel } = await import('./SettingsFields');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const c = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });
const NO_ACTIONS: PokerActions = { canFold: false, canCheck: false, canCall: false, callAmount: 0, canBet: false, minBet: 0, maxBet: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, canAllIn: false };

function seat(overrides: Partial<PokerPlayerView> = {}): PokerPlayerView {
  return { chips: 1000, bet: 0, committed: 0, status: 'waiting', isDealer: false, isTurn: false, lastAction: null, busted: false, ...overrides };
}

/**
 * Pre-flop, three-handed: the host has the button and acts first, bob posted 5, carol 10. Every
 * viewer gets the same view except `myCards`, as the server sends it.
 */
function view(overrides: Partial<PokerView> = {}): PokerView {
  return {
    phase: 'acting',
    street: 'preflop',
    hand: 2,
    totalHands: 10,
    blinds: { small: 5, big: 10 },
    dealerId: 'host',
    community: [],
    pot: 15,
    pots: [],
    order: ['host', 'bob', 'carol'],
    turn: 'host',
    endsAt: NOW + 20_000,
    paused: false,
    players: {
      host: seat({ isDealer: true, isTurn: true, status: 'acting' }),
      bob: seat({ chips: 995, bet: 5, committed: 5, lastAction: { kind: 'smallBlind', amount: 5 } }),
      carol: seat({ chips: 990, bet: 10, committed: 10, lastAction: { kind: 'bigBlind', amount: 10 } }),
    },
    myCards: [],
    actions: NO_ACTIONS,
    results: null,
    ...overrides,
  };
}

const HOST_ACTIONS: PokerActions = { canFold: true, canCheck: false, canCall: true, callAmount: 10, canBet: false, minBet: 10, maxBet: 1000, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000, canAllIn: true };

/** The view as the host gets it on their move: kings in the hole. */
function hostTurn(overrides: Partial<PokerView> = {}): PokerView {
  return view({ myCards: [c('K', 'H'), c('K', 'C')], actions: HOST_ACTIONS, ...overrides });
}

function pkRoom(game: PokerView, overrides: Partial<PokerRoomState> = {}): PokerRoomState {
  return {
    ...room({ gameId: 'poker', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3, participating: false })] }),
    settings: { allowMidGameJoin: true, contentMode: 'family', ...DEFAULT_POKER_SETTINGS },
    game,
    ...overrides,
  } as PokerRoomState;
}

function render(state: PokerRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  usePlatformStore.setState({ connection: 'connected' });
  return renderToString(createElement(pokerClient.Screen, { room: state, meId, isHost }));
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

function snapshot(state: PokerRoomState): void {
  const prev = usePlatformStore.getState().room as PokerRoomState | null;
  usePlatformStore.getState().handleServerMessage({ t: 'room', room: state });
  pokerClient.onRoom?.(state, prev);
}

beforeEach(() => {
  resetStore();
  usePokerStore.getState().reset();
  setLocation('/poker/ABCD');
  registerGames(registryOf(pokerClient));
});

describe('the table', () => {
  it('shows the board, the pot, the seats round from mine with the dealer button and the turn, and my cards large with the hint', () => {
    const html = render(pkRoom(hostTurn()), 'host');
    expect(attr(tagWith(html, 'poker-screen'), 'data-phase')).toBe('acting');
    expect(attr(tagWith(html, 'hand-indicator'), 'data-hand')).toBe('2');
    expect(attr(tagWith(html, 'board'), 'data-street')).toBe('preflop');
    expect(tagsWith(html, 'community-slot')).toHaveLength(5);
    expect(attr(tagWith(html, 'pot'), 'data-chips')).toBe('15');
    expect(attr(tagWith(html, 'blinds'), 'data-big')).toBe('10');
    const seats = tagsWith(html, 'seat');
    expect(seats.map((s) => attr(s, 'data-player-id'))).toEqual(['bob', 'carol']);
    expect(attr(seats[1], 'data-bet')).toBe('10');
    // Two backs per opponent and nothing about their faces.
    expect(tagsWith(html, 'seat-card')).toHaveLength(4);
    for (const back of tagsWith(html, 'seat-card')) {
      expect(attr(back, 'data-face')).toBe('down');
      expect(back).not.toContain('data-rank');
    }
    const area = tagWith(html, 'my-area');
    expect(attr(area, 'data-my-turn')).toBe('true');
    expect(attr(area, 'data-dealer')).toBe('true');
    const cards = tagsWith(html, 'my-card');
    expect(cards.map((t) => `${attr(t, 'data-rank')}${attr(t, 'data-suit')}`)).toEqual(['KH', 'KC']);
    expect(html).toContain('Pair of kings');
    expect(html).toContain('playing-card--xl');
  });

  it('never puts my hole cards on anyone else’s page: the other players and a spectator see backs only', () => {
    for (const viewer of ['bob', 'carol', 'dave']) {
      const html = render(pkRoom(view({ myCards: viewer === 'bob' ? [c('7', 'D'), c('2', 'C')] : [] })), viewer, false);
      expect(html).not.toContain('data-rank="K"');
      expect(html).not.toContain('king of');
    }
    const spectator = render(pkRoom(view()), 'dave', false);
    expect(attr(tagWith(spectator, 'my-area'), 'data-role')).toBe('spectator');
    expect(spectator).not.toContain('data-testid="actions"');
    expect(tagsWith(spectator, 'seat')).toHaveLength(3);
  });

  it('greys the moves out while I wait, and offers Fold, Call and Raise on my move', () => {
    const waiting = render(pkRoom(view({ myCards: [c('7', 'D'), c('2', 'C')] })), 'bob', false);
    expect(attr(tagWith(waiting, 'actions'), 'data-my-turn')).toBe('false');
    for (const id of ['action-fold', 'action-check', 'action-raise']) expect(tagWith(waiting, id)).toContain('disabled');

    const mine = render(pkRoom(hostTurn()), 'host');
    expect(tagWith(mine, 'action-fold')).not.toContain('disabled');
    const callBtn = tagWith(mine, 'action-call');
    expect(callBtn).not.toContain('disabled');
    expect(attr(callBtn, 'data-amount')).toBe('10');
    expect(mine).toContain('Call 10');
    expect(attr(tagWith(mine, 'action-raise'), 'data-kind')).toBe('raise');
    expect(mine).not.toContain('data-testid="action-check"');
  });

  it('offers Check and Bet once nobody has bet, and says a short call is an all in', () => {
    const flop = render(
      pkRoom(hostTurn({ street: 'flop', community: [c('2', 'H'), c('9', 'D'), c('K', 'S')], pot: 30, players: { ...view().players, bob: seat(), carol: seat() }, actions: { ...NO_ACTIONS, canFold: true, canCheck: true, canBet: true, minBet: 10, maxBet: 1000, canAllIn: true } })),
      'host',
    );
    expect(tagWith(flop, 'action-check')).not.toContain('disabled');
    expect(attr(tagWith(flop, 'action-raise'), 'data-kind')).toBe('bet');
    expect(flop).toContain('Three of a kind, kings');
    expect(tagsWith(flop, 'community-card')).toHaveLength(3);
    expect(tagsWith(flop, 'community-slot')).toHaveLength(2);

    const short = render(pkRoom(hostTurn({ players: { ...view().players, host: seat({ chips: 8, isDealer: true, isTurn: true, status: 'acting' }) }, actions: { ...HOST_ACTIONS, callAmount: 8, canRaise: false } })), 'host');
    expect(short).toContain('All in 8');
    expect(tagWith(short, 'action-raise')).toContain('disabled');
  });

  it('replaces the moves with a note once I am all in, and drops them once I fold', () => {
    const allIn = render(pkRoom(view({ myCards: [c('7', 'D'), c('2', 'C')], players: { ...view().players, bob: seat({ chips: 0, bet: 995, status: 'allIn' }) } })), 'bob', false);
    expect(allIn).toContain('You are all in');
    expect(allIn).not.toContain('data-testid="action-fold"');
    const folded = render(pkRoom(view({ myCards: [c('7', 'D'), c('2', 'C')], players: { ...view().players, bob: seat({ status: 'folded', lastAction: { kind: 'fold', amount: 0 } }) } })), 'bob', false);
    expect(folded).not.toContain('data-testid="actions"');
    expect(folded).toContain('You folded');
    expect(tagsWith(folded, 'my-card')).toHaveLength(2);
  });

  it('tells a busted player and a newcomer why they have no cards, and shows side pots', () => {
    const busted = render(pkRoom(view({ order: ['host', 'carol'], players: { ...view().players, bob: seat({ chips: 0, status: 'out', busted: true }) } })), 'bob', false);
    expect(attr(tagWith(busted, 'my-note'), 'data-state')).toBe('out');
    const newcomer = render(pkRoom(view({ order: ['host', 'carol'], players: { ...view().players, bob: seat({ status: 'out' }) } })), 'bob', false);
    expect(attr(tagWith(newcomer, 'my-note'), 'data-state')).toBe('waiting');
    const pots = render(pkRoom(view({ pots: [{ amount: 300, playerIds: ['host', 'bob', 'carol'] }, { amount: 200, playerIds: ['host', 'carol'] }] })), 'host');
    const side = tagsWith(pots, 'side-pot');
    expect(side.map((t) => attr(t, 'data-amount'))).toEqual(['300', '200']);
    expect(attr(side[1], 'data-players')).toBe('host,carol');
  });
});

describe('the bet / raise panel', () => {
  it('opens with the window, the presets and a confirm naming the raise; the whole stack confirms as an all in', () => {
    usePokerStore.getState().openRaise(true);
    const html = render(pkRoom(hostTurn()), 'host');
    const panel = tagWith(html, 'raise-panel');
    expect(attr(panel, 'data-kind')).toBe('raise');
    expect(attr(panel, 'data-min')).toBe('20');
    expect(attr(panel, 'data-max')).toBe('1000');
    expect(attr(panel, 'data-amount')).toBe('20');
    expect(panel).toMatch(/noValidate=""/i);
    const input = tagWith(html, 'raise-input');
    expect(input).toContain('inputMode="numeric"');
    expect(tagWith(html, 'raise-slider')).toContain('max="1000"');
    expect(html).toContain('Raise to 20');
    // Pot: call 10 makes the pot 25, so a pot raise goes to 10 + 25.
    expect(['raise-min', 'raise-half', 'raise-pot', 'raise-allIn'].map((id) => attr(tagWith(html, id), 'data-amount'))).toEqual(['20', '22', '35', '1000']);

    usePokerStore.getState().setRaiseDraft(1000);
    expect(render(pkRoom(hostTurn()), 'host')).toContain('All in · 1,000');
  });

  it('never opens when it is not my move', () => {
    usePokerStore.getState().openRaise(true);
    const html = render(pkRoom(view({ myCards: [c('7', 'D'), c('2', 'C')] })), 'bob', false);
    expect(html).not.toContain('data-testid="raise-panel"');
  });

  it('works out the window and the presets for a bet and a raise', () => {
    expect(raiseRange(NO_ACTIONS)).toBeNull();
    expect(raiseRange({ ...NO_ACTIONS, canBet: true, minBet: 10, maxBet: 500 })).toEqual({ kind: 'bet', min: 10, max: 500 });
    expect(raiseRange(HOST_ACTIONS)).toEqual({ kind: 'raise', min: 20, max: 1000 });
    const flop = view({ pot: 120, players: { host: seat(), bob: seat(), carol: seat() } });
    const bets = presetsFor(flop, 0, { kind: 'bet', min: 10, max: 500 });
    expect(bets.map((p) => p.amount)).toEqual([10, 60, 120, 500]);
    // A tiny stack clamps every preset into the window.
    expect(presetsFor(flop, 0, { kind: 'bet', min: 40, max: 40 }).map((p) => p.amount)).toEqual([40, 40, 40, 40]);
    expect(highestBet(view())).toBe(10);
    expect(clampAmount(5, { kind: 'bet', min: 10, max: 50 })).toBe(10);
    expect(clampAmount(99, { kind: 'bet', min: 10, max: 50 })).toBe(50);
    expect(clampAmount(Number.NaN, { kind: 'bet', min: 10, max: 50 })).toBe(10);
    expect(clampAmount(12.6, { kind: 'bet', min: 10, max: 50 })).toBe(13);
  });
});

describe('results', () => {
  const board = [c('2', 'H'), c('9', 'D'), c('K', 'S'), c('4', 'C'), c('J', 'D')];
  const showdown = view({
    phase: 'results',
    street: 'river',
    turn: null,
    community: board,
    pot: 0,
    myCards: [c('K', 'H'), c('K', 'C')],
    endsAt: NOW + 8000,
    players: { host: seat({ chips: 1100, isDealer: true }), bob: seat({ chips: 900 }), carol: seat({ chips: 1000, status: 'folded' }) },
    results: {
      pots: [{ amount: 200, winners: [{ playerId: 'host', amount: 200 }], handName: 'Three of a kind, kings' }],
      revealed: {
        host: { cards: [c('K', 'H'), c('K', 'C')], category: 'threeOfAKind', name: 'Three of a kind, kings', best: [c('K', 'H'), c('K', 'C'), c('K', 'S'), c('J', 'D'), c('9', 'D')] },
        bob: { cards: [c('9', 'H'), c('8', 'C')], category: 'pair', name: 'Pair of nines', best: [c('9', 'H'), c('9', 'D'), c('K', 'S'), c('J', 'D'), c('8', 'C')] },
      },
      uncontested: false,
      net: { host: 100, bob: -100, carol: 0 },
    },
  });

  it('reveals every contender with the hand and the five that play, keeps the folded hand hidden, and counts down to the next hand', () => {
    const html = render(pkRoom(showdown), 'bob', false);
    expect(attr(tagWith(html, 'overlay-results'), 'data-uncontested')).toBe('false');
    expect(html).toContain('host wins with three of a kind, kings');
    const rows = tagsWith(html, 'result-player');
    expect(rows.map((r) => attr(r, 'data-player-id'))).toEqual(['host', 'carol', 'bob']);
    expect(rows.map((r) => attr(r, 'data-revealed'))).toEqual(['true', 'false', 'true']);
    expect(rows.map((r) => attr(r, 'data-net'))).toEqual(['100', '0', '-100']);
    expect(tagsWith(html, 'revealed-card')).toHaveLength(4);
    expect(tagsWith(html, 'revealed-card').filter((t) => t.includes('playing-card--highlight'))).toHaveLength(4);
    expect(tagsWith(html, 'results-board-card').filter((t) => t.includes('playing-card--highlight'))).toHaveLength(3);
    expect(attr(tagWith(html, 'result-pot'), 'data-winners')).toBe('host');
    expect(attr(tagWith(html, 'results-countdown'), 'data-countdown')).toBe('running');
    expect(html).not.toContain('data-testid="poker-next"');
    const host = render(pkRoom(showdown), 'host');
    expect(tagWith(host, 'poker-next')).toBeTruthy();
    expect(host).toContain('Next hand');
  });

  it('shows no cards for a pot nobody contested, and says Final standings on the last hand', () => {
    const uncontested = view({
      ...showdown,
      community: [],
      street: 'preflop',
      results: { pots: [{ amount: 15, winners: [{ playerId: 'carol', amount: 15 }], handName: null }], revealed: {}, uncontested: true, net: { host: 0, bob: -5, carol: 5 } },
    });
    const html = render(pkRoom(uncontested), 'host');
    expect(html).toContain('carol takes the pot');
    expect(html).not.toContain('data-testid="revealed-card"');
    expect(html).not.toContain('data-testid="results-board"');
    expect(tagsWith(html, 'result-player').every((r) => attr(r, 'data-revealed') === 'false')).toBe(true);
    expect(render(pkRoom(view({ ...showdown, hand: 10 })), 'host')).toContain('Final standings');
  });

  it('freezes the countdown and the host button while the platform holds, and stays off once the podium is up', () => {
    const waiting = { reason: 'players' as const, missing: ['bob'], needed: 1, connected: 1 };
    const held = render(pkRoom(showdown, { waiting }), 'host');
    expect(held).not.toContain('data-testid="poker-next"');
    expect(attr(tagWith(held, 'results-countdown'), 'data-countdown')).toBe('paused');
    const over = render(pkRoom(view({ ...showdown, phase: 'gameOver', endsAt: null }), { phase: 'ended', podium: [{ playerId: 'host', score: 1100, rank: 1 }] }), 'host');
    expect(over).not.toContain('data-testid="overlay-results"');
    expect(over).not.toContain('data-testid="end-game"');
  });
});

describe('host controls', () => {
  it('gives the host End game with a confirmation, and nobody else', () => {
    const host = render(pkRoom(hostTurn()), 'host');
    expect(tagWith(host, 'end-game')).toBeTruthy();
    usePokerStore.getState().setConfirmEnd(true);
    const confirming = render(pkRoom(hostTurn()), 'host');
    expect(tagWith(confirming, 'end-game-yes')).toBeTruthy();
    expect(tagWith(confirming, 'end-game-cancel')).toBeTruthy();
    expect(render(pkRoom(view()), 'bob', false)).not.toContain('data-testid="end-game');
  });
});

describe('text and hooks', () => {
  it('names hands for the hint: pocket pairs and high cards before the flop, the best five after', () => {
    expect(handHint([], [])).toBeNull();
    expect(handHint([c('K', 'H'), c('K', 'C')], [])).toBe('Pair of kings');
    expect(handHint([c('A', 'H'), c('7', 'C')], [])).toBe('Ace high');
    expect(handHint([c('6', 'H'), c('6', 'C')], [])).toBe('Pair of sixes');
    expect(handHint([c('K', 'H'), c('5', 'C')], [c('K', 'S'), c('5', 'D'), c('9', 'C')])).toBe('Two pair, kings and fives');
    expect(handHint([c('A', 'H'), c('2', 'C')], [c('3', 'S'), c('4', 'D'), c('5', 'C'), c('K', 'H'), c('K', 'D')])).toBe('Straight, five high');
  });

  it('labels hands, moves, the phase and net chips', () => {
    expect(handLabel({ hand: 3, totalHands: 10 }, true)).toBe('Hand 3 of 10');
    expect(handLabel({ hand: 3, totalHands: 10 }, false)).toBe('Hand 3/10');
    expect(handLabel({ hand: 3, totalHands: 0 }, true)).toBe('Hand 3');
    expect(lastActionLabel({ kind: 'raise', amount: 1200 })).toBe('Raise to 1,200');
    expect(lastActionLabel({ kind: 'bigBlind', amount: 10 })).toBe('BB 10');
    expect(lastActionLabel(null)).toBe('');
    expect(phaseKicker(view(), 'Bob', false, true)).toBe("Bob's move");
    expect(phaseKicker(view(), 'Bob', true, false)).toBe('Pre-flop — your move');
    expect(netLabel(150)).toBe('+150');
    expect(netLabel(-20)).toBe('−20');
    expect(netLabel(0)).toBe('±0');
  });

  it('seats the table round from the seat after mine, newcomers last', () => {
    const state = pkRoom(view({ order: ['host', 'bob', 'carol'], players: { ...view().players, eve: seat({ status: 'out' }) } }));
    state.players.push(player('eve', { joinOrder: 4 }));
    expect(seatRing(state, state.game as PokerView, 'bob')).toEqual(['carol', 'eve', 'host']);
    expect(seatRing(state, state.game as PokerView, 'dave')).toEqual(['host', 'bob', 'carol', 'eve']);
  });
});

describe('settings rows', () => {
  it('gives the host presets and numeric fields for the chips and the blinds, and the sliders for the rest', () => {
    const { settings } = pkRoom(view());
    if (!pokerClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(pokerClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    const chips = tagWith(host, 'settings-startingChips');
    expect(chips).toContain('type="number"');
    expect(chips).toContain('inputMode="numeric"');
    expect(chips).toContain('max="100000"');
    expect(tagWith(host, 'settings-startingChips-1000')).toContain('aria-pressed="true"');
    expect(tagWith(host, 'settings-smallBlind-5')).toContain('aria-pressed="true"');
    expect(tagWith(host, 'settings-smallBlind')).toContain('max="500"');
    expect(tagWith(host, 'settings-blindsIncreaseEvery')).toContain('max="50"');
    expect(tagWith(host, 'settings-hands')).toContain('max="100"');
    expect(tagWith(host, 'settings-actSeconds')).toContain('min="10"');
    expect(tagWith(host, 'settings-resultsSeconds')).toContain('max="20"');

    const guest = renderToString(createElement(pokerClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-startingChips"');
    expect(guest).toContain('5/10');
    expect(guest).toContain('Until one is left');
    expect(blindsIncreaseLabel(0)).toBe('Never');
    expect(blindsIncreaseLabel(1)).toBe('Every hand');
    expect(blindsIncreaseLabel(10)).toBe('Every 10 hands');
    expect(handsLabel(0)).toBe('Until one is left');
    expect(handsLabel(25)).toBe('25');
  });
});

describe('player-list hooks and cues', () => {
  it('badges the player to act, the dealer and a busted player, and prints the bet or the fold', () => {
    const state = pkRoom(view({ turn: 'bob', players: { ...view().players, host: seat({ isDealer: true, status: 'folded' }), bob: seat({ isTurn: true, status: 'acting', bet: 5 }), carol: seat({ chips: 0, status: 'out', busted: true }) } }));
    const badge = (id: string) => renderToString(createElement('div', null, pokerClient.playerBadge?.(state, player(id))));
    expect(badge('bob')).toContain('player__badge--acting');
    expect(badge('host')).toContain('player__badge--dealer');
    expect(badge('carol')).toContain('player__badge--out');
    expect(badge('dave')).toBe('<div></div>');
    const meta = (id: string) => renderToString(createElement('div', null, pokerClient.playerMeta?.(state, player(id))));
    expect(meta('bob')).toContain('bet 5');
    expect(meta('host')).toContain('folded');
    expect(meta('carol')).toContain('out');
    expect(pokerClient.playerClassName?.(state, player('bob'))).toBe('player--acting');
    expect(pokerClient.playerClassName?.(state, player('host'))).toBe('player--folded');
    expect(pokerClient.playerClassName?.(state, player('carol'))).toBe('player--out');
    expect(pokerClient.chatPlaceholder?.(state, 'host')).toBe('Table talk…');
    expect(pokerClient.chatPlaceholder?.(state, 'dave')).toBe('Watching this hand…');
  });

  it('closes the raise panel when the turn moves on, and resets everything back in the lobby and on leave', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', pkRoom(hostTurn())));
    snapshot(pkRoom(hostTurn()));
    const store = usePokerStore.getState();
    store.openRaise(true);
    store.setRaiseDraft(80);
    snapshot(pkRoom(hostTurn({ pot: 16 })));
    expect(usePokerStore.getState()).toMatchObject({ raiseOpen: true, raiseDraft: 80 });
    snapshot(pkRoom(view({ turn: 'bob' })));
    expect(usePokerStore.getState()).toMatchObject({ raiseOpen: false, raiseDraft: null });
    usePokerStore.getState().openSheet('chat');
    usePokerStore.getState().setConfirmEnd(true);
    snapshot({ ...pkRoom(view()), phase: 'lobby', game: null });
    expect(usePokerStore.getState()).toMatchObject({ sheet: null, confirmEnd: false });
    usePokerStore.getState().openRaise(true);
    pokerClient.onLeave?.();
    expect(usePokerStore.getState().raiseOpen).toBe(false);
  });
});
