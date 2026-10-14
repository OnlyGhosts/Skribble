/**
 * Blackjack's client module under test: the table per phase and role, the betting panel, the
 * moves with their reasons, the hidden hole card, the results, the settings rows, the player-list
 * hooks and the snapshot-driven store. Runs in node: browser globals are stubbed, components
 * render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_BLACKJACK_SETTINGS, type BlackjackRoomState, type BlackjackView, type Card, type HandView } from '@shared/games/blackjack/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { blackjackClient } = await import('./module');
const { useBlackjackStore } = await import('./store');
const { betCap, clampBet, netOf, tableOrder } = await import('./hooks');
const { actionReason, totalLabel, dealerTotalLabel, netLabel, parseChipAmount, phaseKicker } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
const c = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });

function hand(cards: Card[], overrides: Partial<HandView> = {}): HandView {
  return { cards, total: 0, soft: false, bet: 50, status: 'waiting', doubled: false, fromSplit: false, ...overrides };
}

function view(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return {
    phase: 'betting',
    round: 2,
    totalRounds: 10,
    order: ['host', 'bob'],
    turn: null,
    endsAt: NOW + 20_000,
    paused: false,
    dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
    players: {
      host: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
      bob: { chips: 300, bet: 0, hands: [], inRound: true, bustedOut: false },
    },
    actions: NO_ACTIONS,
    results: [],
    shoeRemaining: 280,
    reshuffled: false,
    ...overrides,
  };
}

/** The deal in play: the host acts on a pair of eights against the dealer's ten, bob waits with 19. */
function acting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    phase: 'acting',
    turn: { playerId: 'host', handIndex: 0 },
    dealer: { cards: [c('10', 'H')], holeHidden: true, total: 10, soft: false, blackjack: false },
    players: {
      host: { chips: 950, bet: 50, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'acting' })], inRound: true, bustedOut: false },
      bob: { chips: 280, bet: 20, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20 })], inRound: true, bustedOut: false },
    },
    actions: { canHit: true, canStand: true, canDouble: true, canSplit: true },
    ...overrides,
  });
}

function bjRoom(game: BlackjackView, overrides: Partial<BlackjackRoomState> = {}): BlackjackRoomState {
  return {
    ...room({ gameId: 'blackjack', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2, participating: false })] }),
    settings: { allowMidGameJoin: true, contentMode: 'family', ...DEFAULT_BLACKJACK_SETTINGS },
    game,
    ...overrides,
  } as BlackjackRoomState;
}

function render(state: BlackjackRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  usePlatformStore.setState({ connection: 'connected' });
  return renderToString(createElement(blackjackClient.Screen, { room: state, meId, isHost }));
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
function snapshot(state: BlackjackRoomState): void {
  const prev = usePlatformStore.getState().room as BlackjackRoomState | null;
  usePlatformStore.getState().handleServerMessage({ t: 'room', room: state });
  blackjackClient.onRoom?.(state, prev);
}

beforeEach(() => {
  resetStore();
  useBlackjackStore.getState().reset();
  setLocation('/blackjack/ABCD');
  registerGames(registryOf(blackjackClient));
});

describe('betting', () => {
  it('shows the panel with the table window capped by my chips, the quick bets and one big Place bet', () => {
    const html = render(bjRoom(view()), 'bob');
    expect(attr(tagWith(html, 'blackjack-screen'), 'data-phase')).toBe('betting');
    const panel = tagWith(html, 'bet-panel');
    expect(attr(panel, 'data-min')).toBe('10');
    expect(attr(panel, 'data-max')).toBe('300');
    expect(attr(panel, 'data-amount')).toBe('10');
    // The browser's own min/max check must not swallow the submit: the handler clamps a typed amount instead.
    expect(panel).toMatch(/noValidate=""/i);
    const input = tagWith(html, 'bet-input');
    expect(input).toContain('type="number"');
    expect(input).toContain('inputMode="numeric"');
    expect(tagWith(html, 'bet-slider')).toContain('max="300"');
    for (const id of ['bet-min', 'bet-plus-10', 'bet-plus-50', 'bet-plus-100', 'bet-double', 'bet-max']) expect(tagWith(html, id)).toBeTruthy();
    expect(tagWith(html, 'place-bet')).not.toContain('disabled');
    expect(tagWith(html, 'dealer-hand')).toContain('data-cards="0"');
    expect(tagsWith(html, 'dealer-slot')).toHaveLength(2);
    expect(attr(tagWith(html, 'my-chips'), 'data-chips')).toBe('300');
  });

  it('starts the panel from the last bet placed on this device, clamped to what I can still stake', () => {
    useBlackjackStore.getState().betPlaced(400);
    useBlackjackStore.getState().newRound();
    const html = render(bjRoom(view()), 'bob');
    expect(attr(tagWith(html, 'bet-panel'), 'data-amount')).toBe('300');
    expect(tagWith(html, 'place-bet')).toBeTruthy();
    expect(html).toContain('Place bet');
  });

  it('shows the placed stake with Change bet and who is still to bet; Change bet re-opens the panel', () => {
    const placed = view({ players: { ...view().players, bob: { chips: 250, bet: 50, hands: [], inRound: true, bustedOut: false } } });
    const html = render(bjRoom(placed), 'bob');
    expect(attr(tagWith(html, 'bet-placed'), 'data-bet')).toBe('50');
    expect(html).toContain('Waiting for host');
    expect(html).not.toContain('data-testid="bet-panel"');
    useBlackjackStore.getState().setChangingBet(true);
    const again = render(bjRoom(placed), 'bob');
    const panel = tagWith(again, 'bet-panel');
    expect(attr(panel, 'data-amount')).toBe('50');
    expect(attr(panel, 'data-max')).toBe('300');
    expect(again).toContain('Change bet');
  });

  it('tells a busted-out player, a late joiner and a spectator why they have no panel', () => {
    const out = view({ order: ['host'], players: { ...view().players, bob: { chips: 5, bet: 0, hands: [], inRound: false, bustedOut: true } } });
    expect(attr(tagWith(render(bjRoom(out), 'bob'), 'my-note'), 'data-state')).toBe('out');
    const late = view({ order: ['host'] });
    expect(attr(tagWith(render(bjRoom(late), 'bob'), 'my-note'), 'data-state')).toBe('waiting');
    const spectator = render(bjRoom(view()), 'carol', false);
    expect(attr(tagWith(spectator, 'my-area'), 'data-role')).toBe('spectator');
    expect(spectator).not.toContain('data-testid="bet-panel"');
    // The strip lists every other seat; a spectator is not at the table.
    expect(tagsWith(spectator, 'seat').map((t) => attr(t, 'data-name'))).toEqual(['host', 'bob']);
  });
});

describe('acting', () => {
  it('offers the acting player every legal move and hides the hole card from everyone', () => {
    const html = render(bjRoom(acting()), 'host');
    expect(attr(tagWith(html, 'my-area'), 'data-my-turn')).toBe('true');
    for (const id of ['action-hit', 'action-stand', 'action-double', 'action-split']) expect(tagWith(html, id)).not.toContain('disabled');
    const dealer = tagWith(html, 'dealer-hand');
    expect(attr(dealer, 'data-hole-hidden')).toBe('true');
    const cards = tagsWith(html, 'dealer-card');
    expect(cards).toHaveLength(2);
    expect(attr(cards[0], 'data-face')).toBe('up');
    expect(attr(cards[1], 'data-face')).toBe('down');
    expect(cards[1]).not.toContain('data-rank');
    expect(html).toContain('Shows 10');
    expect(attr(tagWith(html, 'my-hand'), 'data-status')).toBe('acting');
    // A labelled group, so the total and status are announced per hand.
    expect(tagWith(html, 'my-hand')).toContain('role="group"');
    expect(tagWith(html, 'my-hand')).toContain('aria-label="Hand 1: Hard 16, Playing"');
    expect(html).toContain('Hard 16');
    expect(tagWith(html, 'phase-kicker')).toBeTruthy();
    expect(html).toContain('Your move');
  });

  it('greys the moves out with a reason for everyone else, and names what is missing for the acting player', () => {
    const bob = render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob');
    expect(attr(tagWith(bob, 'my-area'), 'data-my-turn')).toBe('false');
    // Bob's hand is still to play: the moves wait on screen, greyed out.
    for (const id of ['action-hit', 'action-stand', 'action-double', 'action-split']) {
      expect(tagWith(bob, id)).toContain('disabled');
      expect(attr(tagWith(bob, id), 'data-reason')).toBe('Not your turn');
    }
    expect(bob).toContain('host is playing');
    const done = acting({ actions: NO_ACTIONS, players: { ...acting().players, bob: { ...acting().players.bob, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20, status: 'stood' })] } } });
    expect(render(bjRoom(done), 'bob')).not.toContain('data-testid="actions"');
    usePlatformStore.setState({ connection: 'reconnecting' });
    const offline = renderToString(createElement(blackjackClient.Screen, { room: bjRoom(acting()), meId: 'host', isHost: true }));
    expect(attr(tagWith(offline, 'action-hit'), 'data-reason')).toBe('Reconnecting…');
    expect(attr(tagWith(bob, 'seat'), 'data-state')).toBe('playing');

    const noPair = acting({ actions: { canHit: true, canStand: true, canDouble: false, canSplit: false } });
    noPair.players.host.hands[0] = hand([c('8'), c('9'), c('2')], { total: 19, status: 'acting' });
    const html = render(bjRoom(noPair), 'host');
    expect(attr(tagWith(html, 'action-double'), 'data-reason')).toBe('First two cards only');
    expect(tagWith(html, 'action-double')).toContain('disabled');
    expect(attr(tagWith(html, 'action-split'), 'data-reason')).toBe('First two cards only');
    expect(tagWith(html, 'action-hit')).not.toContain('disabled');
  });

  it('explains a greyed-out move by the table rules, the chips and the hand', () => {
    const base = acting().players.host.hands[0];
    const settings = DEFAULT_BLACKJACK_SETTINGS;
    const only = (key: 'canDouble' | 'canSplit') => ({ ...NO_ACTIONS, canHit: true, canStand: true, [key]: false });
    expect(actionReason('canDouble', only('canDouble'), base, 950, { ...settings, allowDouble: false }, true)).toBe('Off at this table');
    expect(actionReason('canDouble', only('canDouble'), base, 20, settings, true)).toBe('Not enough chips');
    expect(actionReason('canSplit', only('canSplit'), { ...base, cards: [c('8'), c('9')] }, 950, settings, true)).toBe('Needs a pair');
    expect(actionReason('canSplit', only('canSplit'), { ...base, fromSplit: true }, 950, settings, true)).toBe('One split per round');
    expect(actionReason('canHit', NO_ACTIONS, base, 950, settings, false)).toBe('Not your turn');
    expect(actionReason('canHit', { ...NO_ACTIONS, canHit: true }, base, 950, settings, true)).toBe('');
  });

  it('shows a split pair as two large hands with the one in play marked', () => {
    const split = acting({
      turn: { playerId: 'host', handIndex: 1 },
      players: {
        ...acting().players,
        host: { chips: 900, bet: 50, hands: [hand([c('8'), c('3')], { total: 11, status: 'stood', fromSplit: true }), hand([c('8', 'D'), c('K')], { total: 18, status: 'acting', fromSplit: true })], inRound: true, bustedOut: false },
      },
    });
    const html = render(bjRoom(split), 'host');
    const hands = tagsWith(html, 'my-hand');
    expect(hands).toHaveLength(2);
    expect(hands[0]).not.toContain('bj-hand--active');
    expect(hands[1]).toContain('bj-hand--active');
    expect(attr(hands[1], 'data-index')).toBe('1');
  });
});

describe('results', () => {
  const settled = view({
    phase: 'results',
    endsAt: NOW + 8000,
    dealer: { cards: [c('10', 'H'), c('6'), c('9')], holeHidden: false, total: 25, soft: false, blackjack: false },
    players: {
      host: { chips: 1100, bet: 50, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'won' })], inRound: true, bustedOut: false },
      bob: { chips: 320, bet: 20, hands: [hand([c('A'), c('K', 'C')], { total: 21, soft: true, bet: 20, status: 'blackjack' })], inRound: true, bustedOut: false },
    },
    results: [
      { playerId: 'host', handIndex: 0, outcome: 'win', bet: 50, payout: 100 },
      { playerId: 'bob', handIndex: 0, outcome: 'blackjack', bet: 20, payout: 50 },
    ],
  });

  it('lists every hand with its outcome, net chips and stack; the host gets Next with the countdown', () => {
    const html = render(bjRoom(settled), 'host');
    expect(tagWith(html, 'overlay-results')).toBeTruthy();
    const dialog = tagWith(html, 'results-dialog');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('aria-label="Round results"');
    expect(dialog).toContain('tabindex="-1"');
    expect(html).toContain('The dealer busts with 25');
    const rows = tagsWith(html, 'result-hand');
    expect(rows.map((r) => attr(r, 'data-outcome'))).toEqual(['win', 'blackjack']);
    expect(rows.map((r) => attr(r, 'data-payout'))).toEqual(['100', '50']);
    expect(tagsWith(html, 'result-net').map((r) => attr(r, 'data-net'))).toEqual(['50', '30']);
    expect(html).toContain('+50');
    expect(html).toContain('+30');
    expect(attr(tagWith(html, 'dealer-hand'), 'data-hole-hidden')).toBe('false');
    expect(tagsWith(html, 'dealer-card').every((t) => attr(t, 'data-face') === 'up')).toBe(true);
    expect(attr(tagWith(html, 'bj-next'), 'data-countdown')).toBe('running');
    expect(html).toContain('Next round (');
    const bob = render(bjRoom(settled), 'bob');
    expect(bob).not.toContain('data-testid="bj-next"');
    expect(attr(tagWith(bob, 'results-countdown'), 'data-countdown')).toBe('running');
  });

  it('freezes the countdown and the host button while the platform holds for missing players', () => {
    const waiting = { reason: 'players' as const, missing: ['bob'], needed: 1, connected: 1 };
    const html = render(bjRoom(settled, { waiting }), 'host');
    expect(html).not.toContain('data-testid="bj-next"');
    expect(attr(tagWith(html, 'results-countdown'), 'data-countdown')).toBe('paused');
    expect(tagWith(html, 'timer')).toContain('data-paused="players"');
    const last = render(bjRoom(view({ ...settled, round: 10 })), 'host');
    expect(last).toContain('Final standings');
  });

  it('keeps the overlay off once the game has ended (the platform shows the podium)', () => {
    const over = render(bjRoom(view({ ...settled, phase: 'gameOver', endsAt: null }), { phase: 'ended', podium: [{ playerId: 'host', score: 1100, rank: 1 }] }), 'host');
    expect(over).not.toContain('data-testid="overlay-results"');
    expect(attr(tagWith(over, 'my-chips'), 'data-chips')).toBe('1100');
  });
});

describe('text and hooks', () => {
  it('keeps the phone kicker short enough for 320px during the bets', () => {
    expect(phaseKicker(view(), '', false, false)).toBe('Place your bets');
    expect(phaseKicker(view(), '', false, true)).toBe('Bet now');
    expect(phaseKicker(acting(), 'Bob', false, true)).toBe("Bob's move");
  });

  it('reads a typed chip amount clamped to the limits, and nothing from a blank or unreadable field', () => {
    expect(parseChipAmount('2500', 100, 100000)).toBe(2500);
    expect(parseChipAmount('7', 100, 100000)).toBe(100);
    expect(parseChipAmount('999999', 100, 100000)).toBe(100000);
    expect(parseChipAmount('12.6', 1, 1000)).toBe(13);
    expect(parseChipAmount('', 100, 100000)).toBeNull();
    expect(parseChipAmount('   ', 100, 100000)).toBeNull();
    expect(parseChipAmount('abc', 100, 100000)).toBeNull();
  });

  it('labels totals, the dealer and net chips', () => {
    expect(totalLabel({ cards: [c('A'), c('6')], total: 17, soft: true })).toBe('Soft 17');
    expect(totalLabel({ cards: [c('K'), c('6')], total: 16, soft: false })).toBe('Hard 16');
    expect(totalLabel({ cards: [c('K'), c('6'), c('9')], total: 25, soft: false })).toBe('Bust 25');
    expect(totalLabel({ cards: [c('A'), c('K')], total: 21, soft: true }, true)).toBe('Blackjack');
    expect(dealerTotalLabel({ cards: [c('7')], holeHidden: true, total: 7, soft: false, blackjack: false })).toBe('Shows 7');
    expect(dealerTotalLabel({ cards: [c('A'), c('K')], holeHidden: false, total: 21, soft: true, blackjack: true })).toBe('Blackjack');
    expect(netLabel(1500)).toBe('+1,500');
    expect(netLabel(-20)).toBe('−20');
    expect(netLabel(0)).toBe('±0');
  });

  it('caps a bet by the table and the stack (the current stake counts as available) and clamps drafts', () => {
    const v = view({ players: { ...view().players, bob: { chips: 250, bet: 50, hands: [], inRound: true, bustedOut: false } } });
    expect(betCap(v, 500, 'bob')).toBe(300);
    expect(betCap(v, 200, 'bob')).toBe(200);
    expect(betCap(v, 500, 'nobody')).toBe(0);
    expect(clampBet(5, 10, 300)).toBe(10);
    expect(clampBet(1000, 10, 300)).toBe(300);
    expect(clampBet(Number.NaN, 10, 300)).toBe(10);
    expect(clampBet(42.6, 10, 300)).toBe(43);
    const settled = view({ results: [{ playerId: 'host', handIndex: 0, outcome: 'loss', bet: 50, payout: 0 }, { playerId: 'host', handIndex: 1, outcome: 'win', bet: 50, payout: 100 }] });
    expect(netOf(settled, 'host')).toBe(0);
    expect(netOf(settled, 'bob')).toBe(0);
  });

  it('seats the round in join order and the watchers after them', () => {
    const state = bjRoom(view({ order: ['bob'], players: { ...view().players, dave: { chips: 1000, bet: 0, hands: [], inRound: false, bustedOut: false } } }));
    state.players.push(player('dave', { joinOrder: 3 }));
    expect(tableOrder(state, state.game as BlackjackView)).toEqual(['bob', 'host', 'dave']);
  });
});

describe('settings rows', () => {
  it('gives the host presets and a numeric field per chip amount, the clocks, the payout choice and the rule toggles', () => {
    const { settings } = bjRoom(view());
    if (!blackjackClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(blackjackClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    const chips = tagWith(host, 'settings-startingChips');
    expect(chips).toContain('type="number"');
    expect(chips).toContain('min="100"');
    expect(chips).toContain('max="100000"');
    expect(chips).toContain('value="1000"');
    expect(tagWith(host, 'settings-startingChips-1000')).toContain('aria-pressed="true"');
    expect(tagWith(host, 'settings-minBet-25')).toContain('aria-pressed="false"');
    // The maximum bet never sits below the minimum.
    expect(tagWith(host, 'settings-maxBet')).toContain('min="10"');
    expect(tagWith(host, 'settings-rounds')).toContain('max="50"');
    expect(tagWith(host, 'settings-decks')).toContain('max="8"');
    expect(tagWith(host, 'settings-betSeconds')).toContain('min="10"');
    expect(attr(tagWith(host, 'settings-blackjackPayout'), 'data-value')).toBe('3:2');
    expect(tagWith(host, 'settings-blackjackPayout-6-5')).toContain('aria-checked="false"');
    expect(tagWith(host, 'settings-dealerHitsSoft17')).not.toContain('checked');
    expect(tagWith(host, 'settings-allowDouble')).toContain('checked');
    expect(tagWith(host, 'settings-allowSplit')).toContain('checked');

    const guest = renderToString(createElement(blackjackClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-startingChips"');
    expect(guest).not.toContain('data-testid="settings-blackjackPayout"');
    expect(guest).toContain('1,000');
    expect(tagWith(guest, 'settings-value-blackjackPayout')).toBeTruthy();
    expect(guest).toContain('3 to 2');
    expect(tagWith(guest, 'settings-dealerHitsSoft17')).toContain('disabled');
  });
});

describe('player-list hooks and cues', () => {
  it('badges the acting player, a natural and a busted-out player, and prints the stake next to the score', () => {
    const state = bjRoom(acting({ players: { ...acting().players, bob: { chips: 5, bet: 0, hands: [], inRound: false, bustedOut: true } } }));
    const badge = (id: string) => renderToString(createElement('div', null, blackjackClient.playerBadge?.(state, player(id))));
    expect(badge('host')).toContain('player__badge--acting');
    expect(badge('bob')).toContain('player__badge--out');
    expect(badge('carol')).toBe('<div></div>');
    const natural = bjRoom(acting({ turn: { playerId: 'bob', handIndex: 0 }, players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('A'), c('K')], { total: 21, soft: true, status: 'blackjack' })] } } }));
    expect(renderToString(createElement('div', null, blackjackClient.playerBadge?.(natural, player('host'))))).toContain('player__badge--natural');
    expect(renderToString(createElement('div', null, blackjackClient.playerMeta?.(state, player('host'))))).toContain('bet 50');
    expect(renderToString(createElement('div', null, blackjackClient.playerMeta?.(state, player('bob'))))).toContain('out');
    expect(blackjackClient.playerClassName?.(state, player('host'))).toBe('player--acting');
    expect(blackjackClient.playerClassName?.(state, player('bob'))).toBe('player--out');
    expect(blackjackClient.chatPlaceholder?.(state, 'host')).toBe('Hit or stand? Talk it over…');
    expect(blackjackClient.chatPlaceholder?.(bjRoom(view()), 'carol')).toBe('Watching this round…');
  });

  it('drops the bet draft at a new round, keeps the last bet, and resets everything back in the lobby', () => {
    const store = useBlackjackStore.getState();
    snapshot(bjRoom(view()));
    store.setBetDraft(120);
    store.betPlaced(120);
    store.setChangingBet(true);
    snapshot(bjRoom(view({ round: 3 })));
    expect(useBlackjackStore.getState()).toMatchObject({ betDraft: null, changingBet: false, lastBet: 120 });
    useBlackjackStore.getState().openSheet('chat');
    snapshot(bjRoom(view({ round: 3, phase: 'acting' })));
    expect(useBlackjackStore.getState().sheet).toBe('chat');
    snapshot({ ...bjRoom(view()), phase: 'lobby', game: null });
    expect(useBlackjackStore.getState()).toMatchObject({ lastBet: null, sheet: null });
    blackjackClient.onLeave?.();
    expect(useBlackjackStore.getState().betDraft).toBeNull();
  });
});
