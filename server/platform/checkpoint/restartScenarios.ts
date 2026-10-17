/**
 * Test support for the restart tests: a room of every game brought to the moment a restart
 * catches it, and bots that play each game on to its end from whatever their phones show.
 */
import type { BlackjackView } from '../../../shared/games/blackjack/protocol.js';
import type { PokerView } from '../../../shared/games/poker/protocol.js';
import type { QuipgameView } from '../../../shared/games/quipgame/protocol.js';
import type { ScribbleView } from '../../../shared/games/scribble/protocol.js';
import type { SpygameView } from '../../../shared/games/spygame/protocol.js';
import type { TemplateView } from '../../../shared/games/template/protocol.js';
import type { GameId } from '../../../shared/platform/games.js';
import type { RoomState, WireMessage } from '../../../shared/platform/protocol.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { Phone, seatRoom, sleep, until } from './restartHarness.js';

/** What one phone does next, given what every phone of the room shows; null to wait. */
type Move = (me: Phone, all: Phone[]) => WireMessage | null;

export interface Scenario {
  name: string;
  gameId: GameId;
  phones: Phone[];
  /** Server 'zero' runs with Math.random always 0 (Blackjack deals aces only). */
  server: 'random' | 'zero';
  /** The game restarts part of what it was doing (Scribble's turn): checked by `restarted`, not compared. */
  restarted?: (before: RoomState, after: RoomState) => void;
  /** Plays on from the restored room to the end of the game. */
  finish(): Promise<void>;
}

const isHost = (me: Phone): boolean => me.room?.hostId === me.playerId;

const scribbleMove: Move = (me, all) => {
  const view = me.game<ScribbleView>();
  const phase = view.phase;
  if (phase.kind === 'choosing' && phase.drawerId === me.playerId && phase.choices && phase.choices.length > 0) return { t: 'chooseWord', index: 0 };
  if (phase.kind !== 'drawing' || phase.drawerId === me.playerId || view.players[me.playerId]?.guessedThisTurn) return null;
  const drawer = all.find((p) => p.seat?.playerId === phase.drawerId);
  const shown = drawer?.room?.game as ScribbleView | undefined;
  const word = shown?.phase.kind === 'drawing' ? shown.phase.word : undefined;
  return word ? { t: 'chat', text: word } : null;
};

const spyMove: Move = (me) => {
  const view = me.game<SpygameView>();
  if (view.phase === 'playing' && view.role === 'spy' && view.guessesLeft > 0) {
    const pick = view.candidates.find((id) => !view.spyGuessed.includes(id));
    return pick ? { t: 'guess', locationId: pick } : null;
  }
  if (view.phase === 'voting' && view.vote?.canVote && view.vote.myVote === null) return { t: 'vote', yes: true };
  if (view.phase === 'reveal' && isHost(me)) return { t: 'nextRound' };
  return null;
};

const quipMove: Move = (me) => {
  const view = me.game<QuipgameView>();
  if (view.phase === 'writing' || view.phase === 'finalWriting') {
    const prompt = view.myPrompts.find((p) => view.myAnswers[p.id] === undefined);
    return prompt ? { t: 'answer', promptId: prompt.id, text: `${me.name} says ${prompt.id}` } : null;
  }
  if (view.phase === 'voting' && view.canVote && view.myVote === null) return { t: 'vote', choice: 'a' };
  if (view.phase === 'finalVoting' && view.maxPicks > 0 && view.myRanking.length === 0) {
    return { t: 'rank', answerIds: view.finalAnswers.filter((a) => a.id !== view.myAnswerId).slice(0, view.maxPicks).map((a) => a.id) };
  }
  if ((view.phase === 'result' || view.phase === 'finalResult') && view.canSkip) return { t: 'next' };
  return null;
};

const blackjackMove: Move = (me) => {
  const view = me.game<BlackjackView>();
  const mine = view.players[me.playerId];
  if (view.phase === 'betting' && mine?.inRound && mine.bet === 0 && !mine.sittingOut && mine.chips > 0) return { t: 'bet', amount: 10 };
  if (view.phase === 'acting' && view.turn?.playerId === me.playerId && view.actions.canStand) return { t: 'stand' };
  return null;
};

const pokerMove: Move = (me) => {
  const view = me.game<PokerView>();
  if (view.phase === 'acting' && view.turn === me.playerId) return { t: view.actions.canCheck ? 'check' : view.actions.canCall ? 'call' : 'fold' };
  if (view.phase === 'results' && isHost(me)) return { t: 'next' };
  return null;
};

const templateMove: Move = (me) => (me.room?.phase === 'playing' && me.game<TemplateView>().winnerId === null ? { t: 'click' } : null);

/**
 * Lets every phone make its move whenever what it shows changes, until `done`. A phone acts at
 * most once per state it sees, so a refused move is not hammered.
 */
async function drive(phones: Phone[], move: Move, done: () => boolean, timeoutMs = 60_000): Promise<void> {
  const acted = new Map<Phone, string>();
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`${phones[0].name}'s game did not reach its end: ${JSON.stringify(phones[0].room?.game)}`);
    for (const phone of phones) {
      const room = phone.room;
      if (!phone.open || room?.phase !== 'playing' || room.game === null) continue;
      const key = JSON.stringify(room.game);
      if (acted.get(phone) === key) continue;
      const msg = move(phone, phones);
      if (!msg) continue;
      acted.set(phone, key);
      phone.send(msg);
    }
    await sleep(30);
  }
}

/** The game is over: the host's phone is back in the lobby with the results. */
function over(phones: Phone[]): () => boolean {
  return () => phones[0].room?.phase === 'lobby' && phones[0].room.results !== null;
}

async function started(url: string, gameId: GameId, names: string[], settings: Record<string, unknown>): Promise<Phone[]> {
  const phones = await seatRoom(url, gameId, names, { ...GAME_TEST_FIXTURES[gameId].settings, ...settings });
  phones[0].send({ t: 'start' });
  await Promise.all(phones.map((p) => p.waitFor('the game', (r) => r.phase === 'playing' && r.game !== null)));
  return phones;
}

function phoneOf(phones: Phone[], playerId: string): Phone {
  const phone = phones.find((p) => p.seat?.playerId === playerId);
  if (!phone) throw new Error(`no phone for ${playerId}`);
  return phone;
}

export async function scribbleMidDrawing(url: string): Promise<Scenario> {
  const phones = await started(url, 'scribble', ['Ann', 'Bob', 'Cy'], {});
  const choosing = await phones[0].waitFor('a drawer choosing', (r) => (r.game as ScribbleView).phase.kind === 'choosing');
  const phase = (choosing.game as ScribbleView).phase;
  if (phase.kind !== 'choosing') throw new Error('not choosing');
  phoneOf(phones, phase.drawerId).send({ t: 'chooseWord', index: 0 });
  await Promise.all(phones.map((p) => p.waitFor('drawing', (r) => (r.game as ScribbleView).phase.kind === 'drawing')));
  return {
    name: 'Scribble mid-drawing',
    gameId: 'scribble',
    phones,
    server: 'random',
    restarted: (before, after) => {
      const was = (before.game as ScribbleView).phase;
      const now = (after.game as ScribbleView).phase;
      if (was.kind !== 'drawing' || now.kind !== 'choosing' || now.drawerId !== was.drawerId) {
        throw new Error(`the turn did not restart with the same drawer: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
      }
      const b = before.game as ScribbleView;
      const a = after.game as ScribbleView;
      if (a.round !== b.round || a.turn !== b.turn) throw new Error('the turn moved on');
    },
    finish: () => drive(phones, scribbleMove, over(phones)),
  };
}

export async function spyMidQuestions(url: string): Promise<Scenario> {
  const phones = await started(url, 'spygame', ['Ann', 'Bob', 'Cy'], { rounds: 1 });
  await Promise.all(phones.map((p) => p.waitFor('the round', (r) => (r.game as SpygameView).phase === 'playing')));
  return { name: 'Spy mid-questions', gameId: 'spygame', phones, server: 'random', finish: () => drive(phones, spyMove, over(phones)) };
}

export async function spyMidVote(url: string): Promise<Scenario> {
  const phones = await started(url, 'spygame', ['Ann', 'Bob', 'Cy'], { rounds: 1 });
  await Promise.all(phones.map((p) => p.waitFor('the round', (r) => (r.game as SpygameView).phase === 'playing')));
  const spy = phones.find((p) => p.game<SpygameView>().role === 'spy');
  const agent = phones.find((p) => p.game<SpygameView>().role === 'agent');
  if (!spy || !agent) throw new Error('no spy or agent');
  // Accusing the spy leaves the other agent's vote open.
  agent.send({ t: 'accuse', playerId: spy.playerId });
  await Promise.all(phones.map((p) => p.waitFor('the vote', (r) => (r.game as SpygameView).phase === 'voting')));
  return { name: 'Spy mid-vote', gameId: 'spygame', phones, server: 'random', finish: () => drive(phones, spyMove, over(phones)) };
}

export async function quipMidWriting(url: string): Promise<Scenario> {
  const phones = await started(url, 'quipgame', ['Ann', 'Bob', 'Cy'], {});
  const host = phones[0];
  for (const prompt of host.game<QuipgameView>().myPrompts) host.send({ t: 'answer', promptId: prompt.id, text: `Ann says ${prompt.id}` });
  await host.waitFor('the answers in', (r) => (r.game as QuipgameView).finished.includes(host.playerId));
  await Promise.all(phones.map((p) => p.waitFor('the count', (r) => (r.game as QuipgameView).done === 1)));
  return { name: 'Quip mid-writing', gameId: 'quipgame', phones, server: 'random', finish: () => drive(phones, quipMove, over(phones)) };
}

/** Four players: two of them vote on each matchup, so one vote in leaves it open. */
export async function quipMidVoting(url: string): Promise<Scenario> {
  const phones = await started(url, 'quipgame', ['Ann', 'Bob', 'Cy', 'Di'], {});
  for (const p of phones) for (const prompt of p.game<QuipgameView>().myPrompts) p.send({ t: 'answer', promptId: prompt.id, text: `${p.name} says ${prompt.id}` });
  await Promise.all(phones.map((p) => p.waitFor('the vote', (r) => (r.game as QuipgameView).phase === 'voting')));
  const voter = await until('a voter', () => phones.find((p) => p.game<QuipgameView>().canVote));
  voter.send({ t: 'vote', choice: 'b' });
  await Promise.all(phones.map((p) => p.waitFor('the vote counted', (r) => (r.game as QuipgameView).voted.includes(voter.playerId))));
  return { name: 'Quip mid-voting', gameId: 'quipgame', phones, server: 'random', finish: () => drive(phones, quipMove, over(phones)) };
}

/** Plays at least one more hand of Blackjack, then the host ends the game and the bots play out what is left. */
async function blackjackOn(phones: Phone[]): Promise<void> {
  const round = phones[0].game<BlackjackView>().round;
  await drive(phones, blackjackMove, () => {
    const view = phones[0].room?.game as BlackjackView | null | undefined;
    return view !== null && view !== undefined && view.lastRound !== null && view.lastRound.round >= round;
  });
  phones[0].send({ t: 'endGame' });
  await drive(phones, blackjackMove, over(phones));
}

/** Eight at the table: two phones hold no checkpoint (a room hands them to six). */
export async function blackjackMidBets(url: string): Promise<Scenario & { olderCheckpoint: string }> {
  const phones = await started(url, 'blackjack', ['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'], {});
  const bob = phones[1];
  const olderCheckpoint = await until("Bob's checkpoint of the game", () => bob.checkpoint ?? undefined);
  phones[0].send({ t: 'bet', amount: 50 });
  await Promise.all(phones.map((p) => p.waitFor("Ann's bet", (r) => (r.game as BlackjackView).players[phones[0].playerId]?.bet === 50)));
  return { name: 'Blackjack mid-bets', gameId: 'blackjack', phones, server: 'random', olderCheckpoint, finish: () => blackjackOn(phones) };
}

export async function blackjackMidResults(url: string): Promise<Scenario> {
  const phones = await started(url, 'blackjack', ['Ann', 'Bob'], {});
  await drive(phones, blackjackMove, () => phones.every((p) => p.room?.game !== null && (p.room?.game as BlackjackView).phase === 'results'), 15_000);
  return { name: 'Blackjack mid-results', gameId: 'blackjack', phones, server: 'random', finish: () => blackjackOn(phones) };
}

/** On the server whose cards are all aces: Ann splits her pair and is still on her split hands. */
export async function blackjackAfterSplit(url: string): Promise<Scenario> {
  const phones = await started(url, 'blackjack', ['Ann', 'Bob'], {});
  for (const p of phones) p.send({ t: 'bet', amount: 10 });
  const ann = phones[0];
  await ann.waitFor("Ann's turn", (r) => (r.game as BlackjackView).turn?.playerId === ann.playerId);
  ann.send({ t: 'split' });
  await Promise.all(phones.map((p) => p.waitFor('the split', (r) => (r.game as BlackjackView).players[ann.playerId]?.hands.length === 2)));
  return { name: 'Blackjack mid-turn after a split', gameId: 'blackjack', phones, server: 'zero', finish: () => blackjackOn(phones) };
}

export async function pokerMidHand(url: string): Promise<Scenario> {
  const phones = await started(url, 'poker', ['Ann', 'Bob', 'Cy'], { hands: 2 });
  const first = await until('the first to act', () => phones.find((p) => p.game<PokerView>().turn === p.playerId));
  first.send({ t: 'call' });
  await Promise.all(phones.map((p) => p.waitFor('the call', (r) => (r.game as PokerView).lastMove?.kind === 'call')));
  return { name: 'Poker mid-hand', gameId: 'poker', phones, server: 'random', finish: () => drive(phones, pokerMove, over(phones)) };
}

export async function templateMidRace(url: string): Promise<Scenario> {
  const phones = await started(url, 'template', ['Ann', 'Bob'], { timeLimit: 120 });
  for (let i = 0; i < 5; i++) phones[0].send({ t: 'click' });
  await Promise.all(phones.map((p) => p.waitFor('the clicks', (r) => (r.game as TemplateView).clicks[phones[0].playerId] === 5)));
  return { name: 'Click Race mid-race', gameId: 'template', phones, server: 'random', finish: () => drive(phones, templateMove, over(phones)) };
}
