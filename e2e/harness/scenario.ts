/**
 * Rigged Blackjack snapshots for the layout harness: a table of `others` other players and me
 * holding `hands` hands, in one phase of a round. A phase that needs motion (the deal, the
 * dealer's play) is a short run of snapshots, the later ones animating like a live table.
 */
import { handTotal } from '../../shared/games/blackjack/cards';
import { DEFAULT_BLACKJACK_SETTINGS, type BlackjackPlayerView, type BlackjackRoomState, type BlackjackView, type Card, type CardRank, type HandOutcome, type HandStatus, type HandView, type SettledHandView } from '../../shared/games/blackjack/protocol';
import { gameById } from '../../shared/platform/games';
import type { PlayerPublic } from '../../shared/platform/protocol';
import { defaultPlatformSettings } from '../../shared/platform/settings';

export const ME = 'me';

export const PHASES = ['betting', 'deal', 'other', 'mine', 'dealer', 'results'] as const;
export type HarnessPhase = (typeof PHASES)[number];

export interface Scenario {
  phase: HarnessPhase;
  /** Other players at the table. */
  others: number;
  /** My hands (splits), 1 or more. */
  hands: number;
  /** My hand in play on my turn. */
  active: number;
  /** Hands the player on turn holds on another player's turn. */
  otherHands: number;
  /** Cards in each of my hands. */
  cards: number;
  /** The beat between two snapshots of a phase that moves. */
  stepMs: number;
  /** My stake already down while the bets are open (betting, and the next bets after the results). */
  myBet: number;
  /** My hand in play is a soft hand, ace and nine ("10/20"). */
  soft: boolean;
  /** The other players' names, in seat order (the defaults after them). */
  names: string[];
  /** My stake on each hand (a big one makes a long payout line, "Win +2,000"). */
  stake: number;
  /** My hands are doubled (a "2x" beside the stake). */
  doubled: boolean;
}

const NAMES = ['Pia', 'Quinn', 'Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Ivy', 'Jas', 'Kit', 'Lou', 'Max', 'Nia', 'Oli', 'Pip', 'Rae', 'Sam', 'Tia', 'Uma', 'Vic', 'Wes', 'Xan'];

function int(params: URLSearchParams, key: string, fallback: number): number {
  const n = Number(params.get(key));
  return params.has(key) && Number.isFinite(n) ? n : fallback;
}

export function parseScenario(params: URLSearchParams): Scenario {
  const phase = PHASES.find((p) => p === params.get('phase')) ?? 'mine';
  const hands = Math.max(1, int(params, 'hands', 1));
  return {
    phase,
    others: Math.max(0, int(params, 'others', 1)),
    hands,
    active: Math.min(hands - 1, Math.max(0, int(params, 'active', 0))),
    otherHands: Math.max(1, int(params, 'otherHands', 1)),
    cards: Math.max(1, int(params, 'cards', 2)),
    stepMs: int(params, 'stepMs', 400),
    myBet: Math.max(0, int(params, 'myBet', 0)),
    soft: params.get('soft') === '1',
    names: (params.get('names') ?? '').split(',').filter((n) => n.length > 0),
    stake: Math.max(1, int(params, 'stake', 10)),
    doubled: params.get('doubled') === '1',
  };
}

const SUITS: Card['suit'][] = ['S', 'H', 'D', 'C'];
const SECOND: CardRank[] = ['7', '10', '3', 'K', '9', '2', '8', 'Q', '5', 'A', '6', 'J', '4'];

/** A hand's cards: an eight (the split pair), a varied second card, then small cards. */
function cardsFor(i: number, count: number): Card[] {
  const out: Card[] = [{ rank: '8', suit: SUITS[i % 4] }, { rank: SECOND[i % SECOND.length], suit: SUITS[(i + 1) % 4] }];
  for (let k = 2; k < count; k++) out.push({ rank: k % 2 ? '2' : 'A', suit: SUITS[(i + k) % 4] });
  return out.slice(0, count);
}

function hand(cards: Card[], status: HandStatus, fromSplit: boolean, bet = 10, doubled = false): HandView {
  const { total, soft } = handTotal(cards);
  return { cards, total, soft, bet: doubled ? bet * 2 : bet, status, doubled, fromSplit, splitAces: false };
}

const OUTCOMES: HandOutcome[] = ['win', 'loss', 'push', 'win', 'loss'];

function settle(h: HandView, i: number): SettledHandView {
  const outcome: HandOutcome = h.total > 21 ? 'loss' : OUTCOMES[i % OUTCOMES.length];
  const payout = outcome === 'win' ? h.bet * 2 : outcome === 'push' ? h.bet : 0;
  const status: HandStatus = h.total > 21 ? 'bust' : outcome === 'win' ? 'won' : outcome === 'push' ? 'push' : 'lost';
  return { ...h, status, outcome, payout };
}

function people(s: Scenario): PlayerPublic[] {
  const others = Array.from({ length: s.others }, (_, i) => s.names[i] ?? NAMES[i] ?? `Bot ${i + 1}`);
  return [ME, ...others.map((_, i) => `p${i + 1}`)].map((id, i) => ({
    id,
    name: id === ME ? 'Hana' : others[i - 1],
    avatar: { color: i % 12, emoji: (i * 5) % 24 },
    score: 1000,
    isHost: id === ME,
    connected: true,
    joinOrder: i,
    ready: true,
    sittingOut: false,
    participating: true,
  }));
}

function roomOf(players: PlayerPublic[], game: BlackjackView): BlackjackRoomState {
  return {
    code: 'ABCD',
    gameId: 'blackjack',
    hostId: ME,
    settings: { ...defaultPlatformSettings(gameById('blackjack')), ...DEFAULT_BLACKJACK_SETTINGS },
    players,
    phase: 'playing',
    podium: null,
    game,
    serverTime: Date.now(),
  };
}

const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
const NO_CONTROLS = { canSitOut: false, canDealNow: false, canSkip: false };
const HIDDEN = (up: Card) => ({ cards: [up], holeHidden: true, total: handTotal([up]).total, soft: false, blackjack: false });

/** The snapshots of one scenario, in order. */
export function scenarioRooms(s: Scenario): BlackjackRoomState[] {
  const players = people(s);
  const ids = players.map((p) => p.id);
  const others = ids.filter((id) => id !== ME);
  // The others play first, then me: on another player's turn my hands wait.
  const order = [...others, ME];
  const SOFT: Card[] = [{ rank: 'A', suit: 'S' }, { rank: '9', suit: 'H' }];
  const myCards = (status: (i: number) => HandStatus) =>
    Array.from({ length: s.hands }, (_, i) => hand(s.soft && i === s.active ? SOFT : cardsFor(i, i === s.active ? s.cards : 2), status(i), s.hands > 1, s.stake, s.doubled));
  const otherHands = (id: string, status: HandStatus, count = 1) =>
    Array.from({ length: count }, (_, i) => hand(cardsFor(i + others.indexOf(id) + 3, 2), status, count > 1));
  const seat = (hands: HandView[], bet: number, extra: Partial<BlackjackPlayerView> = {}): BlackjackPlayerView => ({ chips: 900, bet, hands, inRound: true, sittingOut: false, bustedOut: false, ...extra });
  const base: BlackjackView = {
    phase: 'betting',
    round: 3,
    order,
    turn: null,
    waitingFor: [],
    dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
    players: {},
    actions: NO_ACTIONS,
    controls: NO_CONTROLS,
    lastRound: null,
    endRequested: false,
  };

  const betting = (): BlackjackView => ({
    ...base,
    waitingFor: [...(s.myBet > 0 ? [] : [ME]), ...others.slice(1)],
    players: Object.fromEntries(ids.map((id) => [id, seat([], id === others[0] ? 20 : id === ME ? s.myBet : 0)])),
    controls: { canSitOut: s.myBet === 0, canDealNow: true, canSkip: false },
  });

  const acting = (turnId: string, handIndex: number): BlackjackView => {
    const players: Record<string, BlackjackPlayerView> = {};
    for (const id of others) {
      const before = order.indexOf(id) < order.indexOf(turnId);
      const status: HandStatus = id === turnId ? 'acting' : before ? 'stood' : 'waiting';
      players[id] = seat(otherHands(id, status, id === turnId ? s.otherHands : 1), 10);
    }
    players[ME] = seat(
      myCards((i) => (turnId !== ME ? 'waiting' : i < handIndex ? 'stood' : i === handIndex ? 'acting' : 'waiting')),
      s.stake,
    );
    return {
      ...base,
      phase: 'acting',
      turn: { playerId: turnId, handIndex },
      dealer: HIDDEN({ rank: '6', suit: 'S' }),
      players,
      actions: turnId === ME ? { canHit: true, canStand: true, canDouble: true, canSplit: false } : NO_ACTIONS,
      controls: { ...NO_CONTROLS, canSkip: turnId !== ME },
    };
  };

  const settled = (): BlackjackView => {
    const last = acting(ME, s.hands - 1);
    const dealer: Card[] = [{ rank: '6', suit: 'S' }, { rank: '10', suit: 'H' }, { rank: '3', suit: 'D' }];
    const hands: Record<string, SettledHandView[]> = {};
    for (const id of order) hands[id] = last.players[id].hands.map((h, i) => settle({ ...h, status: h.status === 'acting' || h.status === 'waiting' ? 'stood' : h.status }, i + order.indexOf(id)));
    return {
      ...base,
      round: base.round + 1,
      waitingFor: s.myBet > 0 ? others : ids,
      players: Object.fromEntries(ids.map((id) => [id, seat([], id === ME ? s.myBet : 0)])),
      controls: { canSitOut: s.myBet === 0, canDealNow: s.myBet > 0, canSkip: false },
      lastRound: { round: base.round, order, dealer: { cards: dealer, holeHidden: false, total: 19, soft: false, blackjack: false }, hands, peeked: false, revealEndsAt: Date.now() + 2200 },
    };
  };

  const firstOther = others[0] ?? ME;
  switch (s.phase) {
    case 'betting':
      return [roomOf(players, betting())];
    case 'deal':
      return [roomOf(players, betting()), roomOf(players, acting(firstOther, 0))];
    case 'other':
      return [roomOf(players, acting(firstOther, 0))];
    case 'mine':
      return [roomOf(players, acting(ME, s.active))];
    case 'dealer':
      return [roomOf(players, acting(ME, s.hands - 1)), roomOf(players, settled())];
    case 'results':
      return [roomOf(players, settled())];
  }
}
