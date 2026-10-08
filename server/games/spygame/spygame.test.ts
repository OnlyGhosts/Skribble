/** The Spy Game's rules through the pure engine: roles, candidates, guesses, votes, the clock, the reveal and the edges. */
import { describe, expect, it } from 'vitest';
import { SPYGAME_CANDIDATES, SPYGAME_REVEAL_SECONDS, type SpygameView } from '../../../shared/games/spygame/protocol.js';
import { RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { spygameModule, type SpygameData } from './module.js';

const ROUND_MS = 3 * 60_000; // the fixture's roundMinutes
const VOTE_MS = 15_000; // the fixture's voteSeconds
const REVEAL_MS = SPYGAME_REVEAL_SECONDS * 1000;

const view = (s: Sim, viewer: string | null = null): SpygameView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as SpygameView;
};
const data = (s: Sim): SpygameData => s.data.game as SpygameData;
const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const disconnect = (s: Sim, id: string, name: string): void => {
  s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${name}` });
};
const reconnect = (s: Sim, id: string, name: string): void => {
  s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });
};
/** The spy names the location: the fastest way to the reveal. */
const spyWins = (s: Sim): void => {
  const { spyId, locationId } = data(s).current;
  s.game(spyId, { t: 'guess', locationId });
};
/** A decoy among the round's candidates. */
const decoy = (s: Sim, skip: string[] = []): string => {
  const { candidates, locationId } = data(s).current;
  const id = candidates.find((c) => c !== locationId && !skip.includes(c));
  if (!id) throw new Error('no decoy');
  return id;
};

// With the harness rng (() => 0) the host is round one's spy and 'airplane' the location.

describe('The Spy Game: round setup', () => {
  it('starts round one with exactly one spy, a running clock, a system line and 24 shared candidates including the location', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    const g = data(s);
    expect(g).toMatchObject({ phase: 'playing', round: 1, vote: null, reveal: null, spyHistory: [alice], usedLocationIds: ['airplane'] });
    expect(g.current).toMatchObject({ spyId: alice, locationId: 'airplane', playerIds: [alice, bob, carol], guessesLeft: 2, guessed: [], accusers: [], spyAway: false });
    expect(g.current.clock).toEqual({ kind: 'running', endsAt: START + ROUND_MS });
    expect(g.current.candidates).toHaveLength(SPYGAME_CANDIDATES);
    expect(new Set(g.current.candidates).size).toBe(SPYGAME_CANDIDATES);
    expect(g.current.candidates).toContain('airplane');
    expect(nextDeadline(s.data)).toBe(START + ROUND_MS);
    expect(chatTexts(s.effects)).toContain('Round 1 of 3 — look at your phone');

    for (const viewer of [alice, bob, carol, null]) expect(view(s, viewer).candidates).toEqual(g.current.candidates);
    expect(view(s, alice)).toMatchObject({ phase: 'playing', round: 1, totalRounds: 3, role: 'spy', locationId: null, guessesLeft: 2, spyGuessed: [], vote: null, reveal: null });
    expect(view(s, bob)).toMatchObject({ role: 'agent', locationId: 'airplane' });
    expect(view(s, null)).toMatchObject({ role: 'spectator', locationId: null });
    expect(view(s, bob).clock).toEqual({ endsAt: START + ROUND_MS, pausedRemainingMs: null, pausedReason: null, waitingForId: null });
    expect(view(s, bob).players[bob]).toEqual({ hasAccused: false, isAccused: false, isSpectator: false });
    expect(view(s, bob).roundPlayers).toEqual([alice, bob, carol]);
    expect(view(s, bob).spectators).toEqual([]);
  });

  it('rotates the spy through everyone before repeating, and never repeats a location while the pack lasts', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 5 });
    const spies: string[] = [];
    const locations: string[] = [];
    for (let round = 1; round <= 5; round++) {
      expect(data(s).round).toBe(round);
      spies.push(data(s).current.spyId);
      locations.push(data(s).current.locationId);
      spyWins(s);
      s.game(alice, { t: 'nextRound' });
    }
    expect(spies).toEqual([alice, bob, carol, alice, bob]);
    expect(new Set(locations).size).toBe(5);
    expect(s.data.phase).toBe('ended');
  });

  it('picks the spy with the rng, so a different rng yields a different spy and location', () => {
    const s = sim('spygame', 'ABCD', START, () => 0.99);
    const [alice, , carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(data(s).current.spyId).toBe(carol);
    expect(data(s).current.locationId).not.toBe('airplane');
    expect(view(s, alice)).toMatchObject({ role: 'agent', locationId: data(s).current.locationId });
    expect(view(s, carol)).toMatchObject({ role: 'spy', locationId: null });
  });

  it('seats mid-game joiners as spectators who see neither role nor location and may not act, until the next round', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 2 });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    expect(view(s, dave)).toMatchObject({ role: 'spectator', locationId: null, roundPlayers: [alice, bob, carol], spectators: [dave] });
    expect(view(s, dave).players[dave].isSpectator).toBe(true);
    expect(view(s, dave).candidates).toEqual(view(s, bob).candidates);
    expect(s.game(dave, { t: 'accuse', playerId: bob })).toContainEqual(expect.objectContaining({ msg: expect.objectContaining({ code: 'NOT_ALLOWED', message: 'You are watching this round.' }) }));
    expect(s.game(dave, { t: 'guess', locationId: 'airplane' })).toContainEqual(expect.objectContaining({ msg: expect.objectContaining({ message: 'Only the spy guesses the location.' }) }));
    expect(s.game(bob, { t: 'accuse', playerId: dave })).toContainEqual(expect.objectContaining({ msg: expect.objectContaining({ message: 'You can only accuse a player in this round.' }) }));

    // Spectators score nothing when the agents win.
    s.now += ROUND_MS;
    s.tick();
    expect(data(s).reveal).toMatchObject({ outcome: 'timeUp', points: { [bob]: 1, [carol]: 1 } });
    expect(score(s, dave)).toBe(0);
    s.game(alice, { t: 'nextRound' });
    expect(data(s).current.playerIds).toEqual([alice, bob, carol, dave]);
    expect(view(s, dave).role).toBe('agent');
  });
});

describe('The Spy Game: the spy guesses', () => {
  it('marks and announces a wrong first guess, and loses the round on a wrong second guess (agents +1)', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const first = decoy(s);
    const effects = s.game(alice, { t: 'guess', locationId: first });
    expect(chatTexts(effects)).toContain('The spy guessed wrong! 1 guess left');
    expect(view(s, bob)).toMatchObject({ phase: 'playing', guessesLeft: 1, spyGuessed: [first] });
    expect(s.game(alice, { t: 'guess', locationId: first })).toContainEqual(expect.objectContaining({ msg: expect.objectContaining({ message: 'You already ruled that one out.' }) }));

    s.game(alice, { t: 'guess', locationId: decoy(s, [first]) });
    expect(data(s).phase).toBe('reveal');
    expect(view(s, alice)).toMatchObject({ phase: 'reveal', locationId: 'airplane', guessesLeft: 0 });
    expect(view(s, alice).reveal).toMatchObject({ outcome: 'spyWrong', spyId: alice, spyName: 'Alice', locationId: 'airplane', points: { [bob]: 1, [carol]: 1 }, endsAt: s.now + REVEAL_MS });
    expect([score(s, alice), score(s, bob), score(s, carol)]).toEqual([0, 1, 1]);
    expect(view(s, bob).clock).toEqual({ endsAt: null, pausedRemainingMs: ROUND_MS, pausedReason: 'reveal', waitingForId: null });
  });

  it('scores 4 for a correct first guess and 3 for a correct second guess', () => {
    const first = sim('spygame');
    const [alice] = startGame(first, ['Alice', 'Bob', 'Carol']);
    const effects = first.game(alice, { t: 'guess', locationId: 'airplane' });
    expect(data(first).reveal).toMatchObject({ outcome: 'spyGuessed', points: { [alice]: 4 } });
    expect(score(first, alice)).toBe(4);
    expect(chatTexts(effects)).toContain('Alice was the spy and guessed the location: Airplane!');

    const second = sim('spygame');
    const [alice2] = startGame(second, ['Alice', 'Bob', 'Carol']);
    second.game(alice2, { t: 'guess', locationId: decoy(second) });
    second.game(alice2, { t: 'guess', locationId: 'airplane' });
    expect(data(second).reveal).toMatchObject({ outcome: 'spyGuessed', points: { [alice2]: 3 } });
    expect(score(second, alice2)).toBe(3);
  });

  it('refuses guesses from agents, of non-candidates, and outside the playing phase', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const refused = (effects: ReturnType<Sim['game']>, message: string): void => {
      expect(effects).toEqual([expect.objectContaining({ type: 'send', msg: { t: 'error', code: 'NOT_ALLOWED', message } })]);
    };
    refused(s.game(bob, { t: 'guess', locationId: 'airplane' }), 'Only the spy guesses the location.');
    refused(s.game(alice, { t: 'guess', locationId: 'nowhere' }), 'That is not one of the candidates.');
    expect(s.game(alice, { t: 'guess' })).toEqual([expect.objectContaining({ msg: expect.objectContaining({ code: 'INVALID_MESSAGE' }) })]);
    s.game(bob, { t: 'accuse', playerId: s.playerId('Carol') });
    refused(s.game(alice, { t: 'guess', locationId: 'airplane' }), 'You can only guess while the round clock runs.');
  });
});

describe('The Spy Game: accusations and votes', () => {
  it('validates who may accuse whom, and when', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    const refused = (effects: ReturnType<Sim['game']>, message: string): void => {
      expect(effects).toEqual([expect.objectContaining({ type: 'send', msg: { t: 'error', code: 'NOT_ALLOWED', message } })]);
    };
    refused(s.game(alice, { t: 'accuse', playerId: bob }), "The spy can't accuse anyone.");
    refused(s.game(bob, { t: 'accuse', playerId: bob }), "You can't accuse yourself.");
    refused(s.game(bob, { t: 'accuse', playerId: 'ghost' }), 'You can only accuse a player in this round.');

    s.game(bob, { t: 'accuse', playerId: carol });
    expect(data(s).phase).toBe('voting');
    refused(s.game(dave, { t: 'accuse', playerId: bob }), 'A vote is already running.');
    s.game(dave, { t: 'vote', yes: false }); // 1-1: fails
    expect(data(s).phase).toBe('playing');
    refused(s.game(bob, { t: 'accuse', playerId: dave }), 'You already started a vote this round.');
    expect(view(s, bob).players[bob].hasAccused).toBe(true);

    spyWins(s);
    refused(s.game(carol, { t: 'accuse', playerId: bob }), 'The round is over.');
  });

  it('starts a vote: the clock pauses, agents except the accused vote, the accuser counts as Yes, everyone sees the tally', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.now += 30_000;
    const effects = s.game(bob, { t: 'accuse', playerId: carol });
    expect(chatTexts(effects)).toContain('Bob accuses Carol of being the spy! Vote now.');
    const v = view(s, dave);
    expect(v.phase).toBe('voting');
    expect(v.vote).toEqual({ accuserId: bob, accusedId: carol, yes: 1, no: 0, endsAt: s.now + VOTE_MS, canVote: true, myVote: null });
    expect(view(s, bob).vote).toMatchObject({ canVote: false, myVote: true });
    expect(view(s, carol).vote).toMatchObject({ canVote: false, myVote: null });
    expect(view(s, alice).vote).toMatchObject({ canVote: false, myVote: null });
    expect(view(s, null).vote).toMatchObject({ canVote: false, myVote: null });
    expect(v.clock).toEqual({ endsAt: null, pausedRemainingMs: ROUND_MS - 30_000, pausedReason: 'vote', waitingForId: null });
    expect(v.players[carol].isAccused).toBe(true);
    expect(v.players[bob].hasAccused).toBe(true);
    expect(nextDeadline(s.data)).toBe(s.now + VOTE_MS);

    const refused = (effects2: ReturnType<Sim['game']>, message: string): void => {
      expect(effects2).toEqual([expect.objectContaining({ type: 'send', msg: { t: 'error', code: 'NOT_ALLOWED', message } })]);
    };
    refused(s.game(carol, { t: 'vote', yes: false }), "You can't vote in this one.");
    refused(s.game(alice, { t: 'vote', yes: true }), "You can't vote in this one.");
    refused(s.game(bob, { t: 'vote', yes: false }), 'You started this vote — you count as Yes.');
    expect(data(s).phase).toBe('voting');
  });

  it('lets voters change their mind until the last vote lands, then resolves at once', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave, eve] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    s.game(bob, { t: 'accuse', playerId: carol });
    s.game(dave, { t: 'vote', yes: false });
    expect(view(s, dave).vote).toMatchObject({ yes: 1, no: 1, myVote: false });
    s.game(dave, { t: 'vote', yes: true });
    expect(view(s, dave).vote).toMatchObject({ yes: 2, no: 0, myVote: true });
    expect(data(s).phase).toBe('voting');
    s.game(eve, { t: 'vote', yes: false });
    // 2 yes, 1 no: passed, and Carol was not the spy.
    expect(data(s).reveal).toMatchObject({ outcome: 'wrongAccusation', spyId: alice, points: { [alice]: 2 } });
    expect(score(s, alice)).toBe(2);
  });

  it('resolves at voteSeconds with missing votes as No; a tie fails and the clock resumes with the kept time', () => {
    const s = sim('spygame');
    const [, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.now += 45_000;
    s.game(bob, { t: 'accuse', playerId: carol });
    s.now += VOTE_MS - 1;
    expect(s.tick()).toEqual([]);
    s.now += 1;
    const effects = s.tick();
    expect(chatTexts(effects)).toContain('The vote failed — play on.');
    expect(data(s)).toMatchObject({ phase: 'playing', vote: null });
    expect(data(s).current.clock).toEqual({ kind: 'running', endsAt: s.now + ROUND_MS - 45_000 });
    expect(nextDeadline(s.data)).toBe(s.now + ROUND_MS - 45_000);
    expect(view(s, dave).vote).toBeNull();
    expect(view(s, dave).players[carol].isAccused).toBe(false);
    // Nothing was lost: scores untouched, Dave may still accuse.
    expect(s.data.players.every((p) => p.score === 0)).toBe(true);
    s.game(dave, { t: 'accuse', playerId: carol });
    expect(data(s).phase).toBe('voting');
  });

  it('a passed vote on the spy ends the round with spyCaught: agents +1, the accuser +3 in total', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(bob, { t: 'accuse', playerId: alice });
    expect([alice, bob, carol, dave].map((id) => view(s, id).vote?.canVote)).toEqual([false, false, true, true]);
    s.game(carol, { t: 'vote', yes: true });
    const effects = s.game(dave, { t: 'vote', yes: false });
    expect(chatTexts(effects)).toContain('The vote passed (2–1): Alice is accused.');
    expect(chatTexts(effects)).toContain('Alice was the spy — caught! The agents win. It was the Airplane.');
    expect(data(s).reveal).toMatchObject({ outcome: 'spyCaught', spyId: alice, locationId: 'airplane', points: { [bob]: 3, [carol]: 1, [dave]: 1 } });
    expect([score(s, alice), score(s, bob), score(s, carol), score(s, dave)]).toEqual([0, 3, 1, 1]);
    expect(view(s, carol).reveal?.points).toEqual({ [bob]: 3, [carol]: 1, [dave]: 1 });
  });

  it('a passed vote on an agent ends the round with wrongAccusation: the spy +2', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(bob, { t: 'accuse', playerId: carol });
    const effects = s.game(dave, { t: 'vote', yes: true });
    expect(chatTexts(effects)).toContain('Carol was not the spy. Alice wins the round — it was the Airplane.');
    expect(data(s).reveal).toMatchObject({ outcome: 'wrongAccusation', points: { [alice]: 2 } });
    expect([score(s, alice), score(s, bob), score(s, carol), score(s, dave)]).toEqual([2, 0, 0, 0]);
    // The location is revealed to everyone, the spy included.
    expect(view(s, alice).locationId).toBe('airplane');
    expect(view(s, dave).role).toBe('agent');
  });

  it('with three players an accusation of the only other agent passes on the accuser\'s vote alone', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(bob, { t: 'accuse', playerId: carol });
    expect(data(s).reveal).toMatchObject({ outcome: 'wrongAccusation', points: { [alice]: 2 } });
  });

  it('drops the vote when the accused leaves and lets a leaving voter stop counting', () => {
    const s = sim('spygame');
    const [, bob, carol, dave, eve] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    s.game(bob, { t: 'accuse', playerId: carol });
    const effects = s.apply({ type: 'leave', playerId: carol });
    expect(chatTexts(effects)).toContain('The accused left — the vote is off.');
    expect(data(s)).toMatchObject({ phase: 'playing', vote: null });
    expect(data(s).current.accusers).toEqual([]);
    expect(view(s, bob).roundPlayers).toEqual([s.playerId('Alice'), bob, dave, eve]);
    s.game(bob, { t: 'accuse', playerId: dave });
    expect(data(s).phase).toBe('voting');
    expect(data(s).vote?.eligible).toEqual([bob, eve]);

    const t = sim('spygame');
    const [, bob2, carol2, dave2, eve2] = startGame(t, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    t.game(bob2, { t: 'accuse', playerId: carol2 });
    t.apply({ type: 'leave', playerId: dave2 });
    expect(data(t).vote?.eligible).toEqual([bob2, eve2]);
    t.game(eve2, { t: 'vote', yes: true });
    expect(data(t).reveal?.outcome).toBe('wrongAccusation');
  });

  it('calls the vote off when the accuser leaves mid-vote: no dangling accuser, the clock resumes', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave, eve] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    s.now += 20_000;
    s.game(bob, { t: 'accuse', playerId: alice });
    s.now += 5_000;
    const effects = s.apply({ type: 'leave', playerId: bob });
    expect(chatTexts(effects)).toContain('The accuser left — the vote is off.');
    expect(data(s)).toMatchObject({ phase: 'playing', vote: null });
    expect(data(s).current.clock).toEqual({ kind: 'running', endsAt: s.now + ROUND_MS - 20_000 });
    expect(view(s, carol)).toMatchObject({ phase: 'playing', vote: null, roundPlayers: [alice, carol, dave, eve] });
    expect(view(s, carol).players[alice].isAccused).toBe(false);
    expect(s.data.players.every((p) => p.score === 0)).toBe(true);
    // Play goes on: another agent may still call a vote.
    s.game(carol, { t: 'accuse', playerId: alice });
    expect(data(s).phase).toBe('voting');
    s.game(dave, { t: 'vote', yes: true });
    s.game(eve, { t: 'vote', yes: true });
    expect(data(s).reveal).toMatchObject({ outcome: 'spyCaught', points: { [carol]: 3, [dave]: 1, [eve]: 1 } });
  });

  it('never tells anyone who may vote: the view and the chat read the same whether the accused is the spy or an agent', () => {
    // Alice is the spy in both rooms. Bob accuses her in one and Carol in the other; Dave (a voter), Bob and
    // every other viewer must not be able to tell the two apart from anything but the accused's id.
    const onSpy = sim('spygame');
    const [alice, bob, carol, dave] = startGame(onSpy, ['Alice', 'Bob', 'Carol', 'Dave']);
    const onAgent = sim('spygame');
    startGame(onAgent, ['Alice', 'Bob', 'Carol', 'Dave']);
    onSpy.game(bob, { t: 'accuse', playerId: alice });
    onAgent.game(bob, { t: 'accuse', playerId: carol });
    const stripped = (s: Sim, viewer: string | null): unknown => {
      const v = view(s, viewer);
      return { ...v, vote: v.vote ? { ...v.vote, accusedId: 'x' } : null, players: Object.fromEntries(Object.entries(v.players).map(([id, p]) => [id, { ...p, isAccused: false }])) };
    };
    for (const viewer of [bob, dave, null]) expect(stripped(onSpy, viewer)).toEqual(stripped(onAgent, viewer));
    expect(view(onSpy, dave).vote).not.toHaveProperty('eligible');
    expect(JSON.stringify(view(onSpy, dave))).not.toContain('eligible');
    // Nobody else votes and both run out: 1 yes vs 2 missing (spy accused) and 1 yes vs 1 missing (agent accused) both fail.
    onSpy.now += VOTE_MS;
    onAgent.now += VOTE_MS;
    const spyLine = chatTexts(onSpy.tick());
    const agentLine = chatTexts(onAgent.tick());
    expect(spyLine).toEqual(agentLine);
    expect(spyLine).toContain('The vote failed — play on.');
    expect(data(onSpy).phase).toBe('playing');
    expect(data(onAgent).phase).toBe('playing');
  });
});

describe('The Spy Game: the clock and the spy\'s connection', () => {
  it('ends the round with timeUp when the clock runs out: agents +1', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.now += ROUND_MS - 1;
    expect(s.tick()).toEqual([]);
    s.now += 1;
    const effects = s.tick();
    expect(chatTexts(effects)).toContain("Time's up! Alice was the spy — the agents win. It was the Airplane.");
    expect(data(s).reveal).toMatchObject({ outcome: 'timeUp', spyId: alice, points: { [bob]: 1, [carol]: 1 }, endsAt: s.now + REVEAL_MS });
    expect(nextDeadline(s.data)).toBe(s.now + REVEAL_MS);
  });

  it('pauses the clock while the spy is away (everyone sees whom they wait for, and how to end it) and resumes it on rejoin', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.now += 60_000;
    const dropped = s.apply({ type: 'connectionClosed', playerId: alice, connectionId: 'conn-Alice' });
    // The pause can last the whole reconnect grace, so the room is told how to move on without them.
    expect(chatTexts(dropped)).toEqual(['Bob is now the host', 'Alice lost connection — the clock is paused until they are back. The host can remove them from the players list.']);
    expect(data(s).current).toMatchObject({ spyAway: true, clock: { kind: 'paused', remainingMs: ROUND_MS - 60_000 } });
    expect(view(s, bob).clock).toEqual({ endsAt: null, pausedRemainingMs: ROUND_MS - 60_000, pausedReason: 'spyAway', waitingForId: alice });
    // No game deadline while paused: only the platform's reconnect grace is pending.
    expect(spygameModule.nextDeadline(data(s))).toBeNull();

    s.now += 20_000;
    reconnect(s, alice, 'Alice');
    expect(data(s).current).toMatchObject({ spyAway: false, clock: { kind: 'running', endsAt: s.now + ROUND_MS - 60_000 } });
    expect(view(s, bob).clock.endsAt).toBe(s.now + ROUND_MS - 60_000);
    s.now += ROUND_MS - 60_000;
    s.tick();
    expect(data(s).reveal?.outcome).toBe('timeUp');
  });

  it('keeps the clock paused after a failed vote while the spy is still away', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(bob, { t: 'accuse', playerId: carol });
    disconnect(s, alice, 'Alice');
    expect(view(s, bob).clock.pausedReason).toBe('vote');
    s.now += VOTE_MS;
    s.tick(); // 1-1: fails
    expect(data(s).phase).toBe('playing');
    expect(view(s, bob).clock).toMatchObject({ pausedRemainingMs: ROUND_MS, pausedReason: 'spyAway', waitingForId: alice });
    reconnect(s, alice, 'Alice');
    expect(data(s).current.clock).toEqual({ kind: 'running', endsAt: s.now + ROUND_MS });
  });

  it('ends the round with spyLeft when the spy leaves for good: agents +1', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    const effects = s.apply({ type: 'leave', playerId: alice });
    expect(chatTexts(effects)).toContain('Alice (the spy) left — the agents win the round. It was the Airplane.');
    expect(data(s).reveal).toMatchObject({ outcome: 'spyLeft', spyId: alice, spyName: 'Alice', points: { [bob]: 1, [carol]: 1, [dave]: 1 } });
    expect([score(s, bob), score(s, carol), score(s, dave)]).toEqual([1, 1, 1]);
    expect(view(s, bob).roundPlayers).toEqual([bob, carol, dave]);
    // The seat is gone, but the reveal still names the spy.
    expect(s.data.players.find((p) => p.id === alice)).toBeUndefined();
    expect(view(s, bob).reveal).toMatchObject({ spyId: alice, spyName: 'Alice' });
  });

  it('names the spy on the reveal when the reconnect grace runs out on them', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    disconnect(s, alice, 'Alice');
    s.now += RECONNECT_GRACE_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toContain('Alice (the spy) left — the agents win the round. It was the Airplane.');
    expect(view(s, bob).reveal).toMatchObject({ outcome: 'spyLeft', spyName: 'Alice' });
  });

  it('an agent dropping does not touch the clock', () => {
    const s = sim('spygame');
    const [, bob] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    const before = data(s);
    disconnect(s, bob, 'Bob');
    expect(data(s)).toEqual(before);
    expect(data(s).current.clock).toEqual({ kind: 'running', endsAt: START + ROUND_MS });
  });
});

describe('The Spy Game: reveal, rounds and the end', () => {
  it('auto-advances from the reveal after 15 s; the host may skip it, nobody else', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    spyWins(s);
    const endedAt = s.now;
    expect(nextDeadline(s.data)).toBe(endedAt + REVEAL_MS);
    expect(s.game(bob, { t: 'nextRound' })).toEqual([expect.objectContaining({ msg: { t: 'error', code: 'NOT_ALLOWED', message: 'Only the host can skip the reveal.' } })]);
    s.now = endedAt + REVEAL_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toContain('Round 2 of 3 — look at your phone');
    expect(data(s)).toMatchObject({ phase: 'playing', round: 2, reveal: null });
    expect(data(s).current.spyId).toBe(bob);
    expect(data(s).current.clock).toEqual({ kind: 'running', endsAt: s.now + ROUND_MS });
    expect(s.game(alice, { t: 'nextRound' })).toEqual([expect.objectContaining({ msg: { t: 'error', code: 'NOT_ALLOWED', message: 'There is no reveal to skip.' } })]);

    spyWins(s);
    s.now += 1000;
    s.game(alice, { t: 'nextRound' });
    expect(data(s)).toMatchObject({ phase: 'playing', round: 3 });
    expect(view(s, alice).reveal).toBeNull();
  });

  it('lets the host end the game from the reveal (back to the lobby), nobody else and never mid-round', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    expect(s.game(alice, { t: 'endGame' })).toEqual([expect.objectContaining({ msg: { t: 'error', code: 'NOT_ALLOWED', message: 'The game can only be ended from the reveal.' } })]);
    spyWins(s);
    expect(s.game(bob, { t: 'endGame' })).toEqual([expect.objectContaining({ msg: { t: 'error', code: 'NOT_ALLOWED', message: 'Only the host can end the game.' } })]);
    const effects = s.game(alice, { t: 'endGame' });
    expect(chatTexts(effects)).toContain('The host ended the game — back to the lobby.');
    expect(s.data.phase).toBe('lobby');
    expect(s.data.game).toBeNull();
    expect(s.data.players.map((p) => p.score)).toEqual([0, 0, 0]);
  });

  it('ends the game with the podium after the last round\'s reveal', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 2 });
    spyWins(s); // Alice +4
    s.game(alice, { t: 'nextRound' });
    s.now += ROUND_MS;
    s.tick(); // round 2: Bob is the spy, time runs out: Alice and Carol +1
    expect(s.data.phase).toBe('playing');
    s.now += REVEAL_MS;
    const effects = s.tick();
    expect(s.data.phase).toBe('ended');
    expect(chatTexts(effects)).toContain('Game over! Alice wins with 5 points.');
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 5, rank: 1 },
      { playerId: carol, score: 1, rank: 2 },
      { playerId: bob, score: 0, rank: 3 },
    ]);
    expect(nextDeadline(s.data)).toBeNull();
    // The view still renders under the podium.
    expect(view(s, bob)).toMatchObject({ phase: 'reveal', locationId: data(s).current.locationId });
    expect(view(s, bob).reveal?.outcome).toBe('timeUp');
  });

  it('survives JSON at every phase', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { rounds: 2 });
    const roundTrip = (): void => expect(JSON.parse(JSON.stringify(s.data))).toStrictEqual(s.data);
    roundTrip();
    s.game(alice, { t: 'guess', locationId: decoy(s) });
    s.game(bob, { t: 'accuse', playerId: carol });
    disconnect(s, alice, 'Alice');
    roundTrip();
    s.now += VOTE_MS;
    s.tick();
    roundTrip();
    reconnect(s, alice, 'Alice');
    s.now += ROUND_MS;
    s.tick();
    roundTrip();
  });

  it('is a pure module: the same object comes back when nothing changed', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const current = data(s);
    const ctx = { now: s.now, rng: () => 0, newId: () => 'x', settings: { rounds: 1, roundMinutes: 3, voteSeconds: 15 }, players: s.data.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: p.connected, score: p.score })), hostId: alice };
    expect(spygameModule.handle(ctx, current, { type: 'tick' }).data).toBe(current);
    expect(spygameModule.handle(ctx, current, { type: 'chat', playerId: bob, text: 'is it cold there?' })).toEqual({ data: current, effects: [] });
    expect(spygameModule.handle(ctx, current, { type: 'playerJoined', playerId: 'new' })).toEqual({ data: current, effects: [] });
    expect(spygameModule.handle(ctx, current, { type: 'playerDisconnected', playerId: bob }).data).toBe(current);
    const guessed = spygameModule.handle(ctx, current, { type: 'message', playerId: alice, msg: { t: 'guess', locationId: 'beach' } });
    expect(guessed.data).not.toBe(current);
    expect(current.current.guessesLeft).toBe(2);
    expect(spygameModule.view(current, bob, ctx).locationId).toBe('airplane');
  });
});

describe('The Spy Game: holding for missing players', () => {
  /** Ends round one and drops `names` during the reveal, so the next tick crosses the round boundary short-handed. */
  const holdAfterRoundOne = (s: Sim, names: string[]): { endedAt: number; effects: ReturnType<Sim['tick']> } => {
    spyWins(s);
    const endedAt = s.now;
    for (const name of names) disconnect(s, s.playerId(name), name);
    s.now = endedAt + REVEAL_MS;
    return { endedAt, effects: s.tick() };
  };

  it('holds at the round boundary while a seated player is away: the reveal stays up, nothing is scheduled, the room is told', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    const { endedAt, effects } = holdAfterRoundOne(s, ['Bob']);
    expect(chatTexts(effects)).toEqual(['Waiting for Bob to reconnect…']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ phase: 'waiting', round: 1, vote: null });
    expect(data(s).reveal?.outcome).toBe('spyGuessed');
    expect(viewFor(s.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 3, connected: 2 });
    // The game view keeps the reveal; the platform's waiting state sits over it.
    expect(view(s, alice)).toMatchObject({ phase: 'reveal', round: 1, locationId: 'airplane', roundPlayers: [alice, bob, carol] });
    expect(view(s, alice).reveal?.outcome).toBe('spyGuessed');
    expect(view(s, alice).clock).toEqual({ endsAt: null, pausedRemainingMs: ROUND_MS, pausedReason: 'reveal', waitingForId: null });
    expect(spygameModule.nextDeadline(data(s))).toBeNull();
    expect(nextDeadline(s.data)).toBe(endedAt + RECONNECT_GRACE_MS);
    s.now += 60_000;
    expect(s.tick()).toEqual([]);
    expect(JSON.parse(JSON.stringify(s.data))).toStrictEqual(s.data);

    // Bob is back: the game settles for a moment (nobody is missing, so no hold shows), then round two starts with everyone.
    const resumed = s.apply({ type: 'rejoin', token: token(s, bob), connectionId: 'conn-Bob-2' });
    expect(chatTexts(resumed)).toEqual(['Bob reconnected']);
    expect(data(s)).toMatchObject({ phase: 'waiting', round: 1, resumeAt: s.now + RESUME_SETTLE_MS });
    expect(nextDeadline(s.data)).toBe(s.now + RESUME_SETTLE_MS);
    expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
    s.now += RESUME_SETTLE_MS;
    const started = s.tick();
    expect(chatTexts(started)).toEqual(['Round 2 of 3 — look at your phone']);
    expect(data(s)).toMatchObject({ phase: 'playing', round: 2, reveal: null, resumeAt: null });
    expect(data(s).current).toMatchObject({ playerIds: [alice, bob, carol], clock: { kind: 'running', endsAt: s.now + ROUND_MS } });
    expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
  });

  it('refreshes the hold as more players drop, and a joiner or a returning player may end it', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { rounds: 3 });
    holdAfterRoundOne(s, ['Bob', 'Carol']);
    expect(viewFor(s.data, alice, s.now).waiting).toMatchObject({ missing: [bob, carol], connected: 2 });
    // One more away: the list grows, the chat line is not repeated.
    const more = s.apply({ type: 'connectionClosed', playerId: dave, connectionId: 'conn-Dave' });
    expect(chatTexts(more)).toEqual([]);
    expect(viewFor(s.data, alice, s.now).waiting).toMatchObject({ missing: [bob, carol, dave], connected: 1 });
    // A newcomer counts, but two connected is still too few.
    s.apply({ type: 'join', name: 'Eve', avatar: AVATAR, connectionId: 'conn-Eve' });
    const eve = s.playerId('Eve');
    expect(data(s).phase).toBe('waiting');
    expect(viewFor(s.data, eve, s.now).waiting).toMatchObject({ missing: [bob, carol, dave], connected: 2 });
    reconnect(s, carol, 'Carol');
    expect(data(s)).toMatchObject({ phase: 'waiting', resumeAt: s.now + RESUME_SETTLE_MS });
    expect(viewFor(s.data, eve, s.now).waiting).toEqual({ reason: 'players', missing: [bob, dave], needed: 3, connected: 3 });
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'playing', round: 2 });
    expect(data(s).current.playerIds).toEqual([alice, carol, eve]);
    expect(viewFor(s.data, eve, s.now).waiting).toBeNull();
  });

  it('seats the next round with everyone back after a simultaneous cut: a straggler restarts the settle instead of spectating the round', () => {
    const s = sim('spygame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { rounds: 3 });
    holdAfterRoundOne(s, ['Bob', 'Carol']);
    // Hosting cuts the remaining sockets too; the clients reconnect at once, in any order.
    disconnect(s, alice, 'Alice');
    disconnect(s, dave, 'Dave');
    expect(viewFor(s.data, null, s.now).waiting).toMatchObject({ missing: [alice, bob, carol, dave], connected: 0 });
    reconnect(s, alice, 'Alice');
    reconnect(s, bob, 'Bob');
    expect(data(s)).toMatchObject({ phase: 'waiting', resumeAt: null });
    reconnect(s, carol, 'Carol');
    const settleFrom = s.now;
    expect(data(s)).toMatchObject({ phase: 'waiting', resumeAt: settleFrom + RESUME_SETTLE_MS });
    expect(viewFor(s.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [dave], needed: 3, connected: 3 });
    s.now += 50;
    reconnect(s, dave, 'Dave');
    expect(data(s).resumeAt).toBe(s.now + RESUME_SETTLE_MS);
    expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
    // The first settle's instant passes without a round; the restarted one starts it, with all four.
    s.now = settleFrom + RESUME_SETTLE_MS;
    expect(s.tick()).toEqual([]);
    expect(data(s).phase).toBe('waiting');
    s.now += 50;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'playing', round: 2, resumeAt: null });
    expect(data(s).current.playerIds).toEqual([alice, bob, carol, dave]);
    expect(view(s, dave).role).not.toBe('spectator');
    expect(nextDeadline(s.data)).toBe(s.now + ROUND_MS);
  });

  it('lets the host end the game during a hold, since the reveal and its controls stay on screen', () => {
    const s = sim('spygame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    holdAfterRoundOne(s, ['Bob']);
    expect(data(s).phase).toBe('waiting');
    expect(s.game(s.playerId('Carol'), { t: 'endGame' })).toEqual([expect.objectContaining({ msg: { t: 'error', code: 'NOT_ALLOWED', message: 'Only the host can end the game.' } })]);
    const effects = s.game(alice, { t: 'endGame' });
    expect(chatTexts(effects)).toContain('The host ended the game — back to the lobby.');
    expect(s.data).toMatchObject({ phase: 'lobby', game: null, waiting: null });
    expect(s.data.players.map((p) => p.id)).toContain(bob);
  });

  it('abandons the game when a missing seat expires, when the player leaves, or when the host removes them', () => {
    const expired = sim('spygame');
    const [alice, bob] = startGame(expired, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    const { endedAt } = holdAfterRoundOne(expired, ['Bob']);
    expired.now = endedAt + RECONNECT_GRACE_MS;
    const effects = expired.tick();
    expect(chatTexts(effects)).toEqual(['Bob left', 'Not enough players — back to the lobby.']);
    expect(expired.data).toMatchObject({ phase: 'lobby', game: null, podium: null, waiting: null });
    expect(expired.data.players.map((p) => p.id)).not.toContain(bob);
    expect(expired.data.players.every((p) => p.score === 0)).toBe(true);
    expect(viewFor(expired.data, alice, expired.now).waiting).toBeNull();

    const left = sim('spygame');
    startGame(left, ['Alice', 'Bob', 'Carol'], { rounds: 3 });
    holdAfterRoundOne(left, ['Bob']);
    left.apply({ type: 'leave', playerId: left.playerId('Bob') });
    expect(left.data).toMatchObject({ phase: 'lobby', game: null, waiting: null });

    // With a seat to spare, removing one missing player narrows the hold; removing the last one needed ends it.
    const kicked = sim('spygame');
    const [host, , , d] = startGame(kicked, ['Alice', 'Bob', 'Carol', 'Dave'], { rounds: 3 });
    holdAfterRoundOne(kicked, ['Bob', 'Carol']);
    kicked.platform(host, { t: 'kick', playerId: kicked.playerId('Bob') });
    expect(kicked.data.phase).toBe('playing');
    expect(viewFor(kicked.data, host, kicked.now).waiting).toEqual({ reason: 'players', missing: [kicked.playerId('Carol')], needed: 3, connected: 2 });
    kicked.platform(host, { t: 'kick', playerId: kicked.playerId('Carol') });
    expect(kicked.data).toMatchObject({ phase: 'lobby', game: null, waiting: null });
    expect(kicked.data.players.map((p) => p.id)).toEqual([host, d]);
  });
});
