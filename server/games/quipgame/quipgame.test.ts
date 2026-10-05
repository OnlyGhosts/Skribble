/** Quip Game's regular rounds through the pure engine: assignment, writing, matchups, votes, scoring and the flow between them. */
import { describe, expect, it } from 'vitest';
import { FALLBACK_ANSWERS, PROMPTS } from '../../../shared/games/quipgame/prompts.js';
import { DEFAULT_QUIPGAME_SETTINGS, QUIPGAME_ANSWER_MAX_LENGTH } from '../../../shared/games/quipgame/protocol.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { AVATAR, START, chatTexts, sim, startGame } from '../../platform/engine/testHarness.js';
import { drawPrompts, promptPool } from './prompts.js';
import type { Gx } from './state.js';
import { answerText, authors, castVotes, data, disconnect, errorCodes, errors, lcg, matchup, nameOf, playRound, score, view, voters, writeAll } from './testHarness.js';

const WRITE_MS = 30_000; // the fixture's writeSeconds
const VOTE_MS = 10_000; // the fixture's voteSeconds
const RESULT_MS = 4_000; // the fixture's resultsSeconds
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Fay', 'Gus', 'Hal'];

describe('Quip Game: round setup', () => {
  it.each([3, 5, 8])('with %i players gives every prompt two authors and every player two prompts', (n) => {
    const s = sim('quipgame', 'ABCD', START, lcg(n));
    const ids = startGame(s, NAMES.slice(0, n));
    const g = data(s);
    expect(g).toMatchObject({ phase: 'writing', round: 1, totalRounds: 2, roundPlayers: ids, matchups: [], answers: [], final: null, endsAt: START + WRITE_MS });
    expect(g.prompts).toHaveLength(n);
    expect(new Set(g.prompts.map((p) => p.text)).size).toBe(n);
    for (const p of g.prompts) {
      expect(p.authorIds).toHaveLength(2);
      expect(new Set(p.authorIds).size).toBe(2);
      expect(ids).toEqual(expect.arrayContaining(p.authorIds));
    }
    for (const id of ids) {
      expect(g.prompts.filter((p) => p.authorIds.includes(id))).toHaveLength(2);
      expect(view(s, id).myPrompts).toHaveLength(2);
      expect(view(s, id)).toMatchObject({ isSpectator: false, myAnswers: {}, done: 0, total: n, matchup: null, result: null, canVote: false, announcerId: null });
    }
    expect(view(s, null)).toMatchObject({ isSpectator: true, myPrompts: [], spectators: [] });
    expect(nextDeadline(s.data)).toBe(START + WRITE_MS);
    expect(chatTexts(s.effects)).toContain('Round 1 of 2 — write your answers!');
  });

  it('shuffles the writing order but publishes the round players in join order, so the list gives nothing away', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(data(s).roundPlayers).toEqual([alice, bob, carol]);
    // rng () => 0 puts the host last in the writing order: they write prompt 0 (the fixture's validMessage relies on it) and prompt 2.
    expect(view(s, alice).myPrompts.map((p) => p.id)).toEqual(['r1-p0', 'r1-p2']);
    expect(view(s, bob).myPrompts.map((p) => p.id)).toEqual(['r1-p0', 'r1-p1']);
    expect(view(s, carol).myPrompts.map((p) => p.id)).toEqual(['r1-p1', 'r1-p2']);
  });

  it('counts three rounds with the final enabled and announces double points in round two', () => {
    const s = sim('quipgame');
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    expect(view(s, alice)).toMatchObject({ round: 1, totalRounds: 3, multiplier: 1 });
    writeAll(s);
    playRound(s, alice);
    expect(view(s, alice)).toMatchObject({ phase: 'writing', round: 2, totalRounds: 3, multiplier: 2 });
    expect(chatTexts(s.effects)).toContain('Round 2 of 3 — write your answers! Double points!');
  });
});

describe('Quip Game: the prompt pool', () => {
  const gx = (settings: Partial<typeof DEFAULT_QUIPGAME_SETTINGS>, rng: () => number = lcg(1)): Gx => ({
    ctx: { now: 0, rng, newId: () => 'x', settings: { ...DEFAULT_QUIPGAME_SETTINGS, ...settings }, players: [], hostId: 'a' },
    data: { phase: 'writing', round: 1, totalRounds: 2, roundPlayers: [], prompts: [], answers: [], matchups: [], matchupIndex: 0, endsAt: 0, usedPrompts: [], announcerCursor: 0, final: null },
    effects: [],
  });
  const custom = Array.from({ length: 10 }, (_, i) => `Custom prompt ${i}`);

  it('is the clean pack by default, adds the cheeky tier on request, merges custom prompts and can be custom-only', () => {
    const clean = promptPool(DEFAULT_QUIPGAME_SETTINGS);
    expect(clean).toEqual(PROMPTS.filter((p) => p.tier === 'clean').map((p) => p.text));
    expect(promptPool({ ...DEFAULT_QUIPGAME_SETTINGS, cheeky: true })).toHaveLength(PROMPTS.length);
    expect(promptPool({ ...DEFAULT_QUIPGAME_SETTINGS, customPrompts: [...custom, clean[0].toUpperCase()] })).toHaveLength(clean.length + custom.length);
    expect(promptPool({ ...DEFAULT_QUIPGAME_SETTINGS, customPrompts: custom, customPromptsOnly: true })).toEqual(custom);
  });

  it('never repeats a prompt while the pool lasts, then starts over without repeating within a draw', () => {
    const g = gx({ customPrompts: custom, customPromptsOnly: true });
    const first = drawPrompts(g, 8);
    const second = drawPrompts(g, 8);
    expect(new Set(first).size).toBe(8);
    expect(new Set(second).size).toBe(8);
    // Two of the second draw are the last unseen prompts; the other six come back after the reset.
    expect(second.slice(0, 2).every((t) => !first.includes(t))).toBe(true);
    expect(g.data.usedPrompts).toHaveLength(6);
  });

  it('keeps prompts unique across a whole game', () => {
    const s = sim('quipgame', 'ABCD', START, lcg(3));
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    const seen: string[] = [];
    for (let round = 1; round <= 3; round++) {
      seen.push(...data(s).prompts.map((p) => p.text));
      writeAll(s);
      if (round < 3) playRound(s, alice);
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
});

describe('Quip Game: writing', () => {
  it('stores a cleaned answer, lets the author resubmit, and shows everyone who is done', () => {
    const s = sim('quipgame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const effects = s.game(alice, { t: 'answer', promptId: 'r1-p0', text: '  a \t fine   answer ' });
    expect(effects.filter((e) => e.type === 'send' && e.msg.t === 'room')).toHaveLength(3);
    expect(data(s).answers).toEqual([{ id: expect.any(String), promptId: 'r1-p0', authorId: alice, authorName: 'Alice', text: 'a fine answer', fallback: false }]);
    expect(view(s, alice).myAnswers).toEqual({ 'r1-p0': 'a fine answer' });
    expect(view(s, bob).myAnswers).toEqual({});
    expect(view(s, bob)).toMatchObject({ done: 0, total: 3 });

    s.game(alice, { t: 'answer', promptId: 'r1-p0', text: 'second thoughts' });
    expect(data(s).answers).toHaveLength(1);
    expect(view(s, alice).myAnswers['r1-p0']).toBe('second thoughts');
    s.game(alice, { t: 'answer', promptId: 'r1-p2', text: 'done' });
    expect(view(s, bob)).toMatchObject({ done: 1, total: 3, finished: [alice], voted: [] });
    expect(s.data.phase).toBe('playing');
    expect(data(s).phase).toBe('writing');
  });

  it('lists who has written everything and, later, who has voted, so the player list can badge them', () => {
    const s = sim('quipgame', 'ABCD', START, lcg(7));
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    expect(view(s, null).finished).toEqual([]);
    writeAll(s, [alice, bob]);
    expect(view(s, null).finished).toEqual([carol, dave]);
    writeAll(s);
    expect(data(s).phase).toBe('voting');
    expect(view(s, null)).toMatchObject({ finished: [], voted: [] });
    const [first] = voters(s);
    s.game(first, { t: 'vote', choice: 'b' });
    expect(view(s, bob).voted).toEqual([first]);
  });

  it('refuses blank or overlong answers at the schema, and prompts that are not yours at the rules', () => {
    const s = sim('quipgame');
    const [alice, , carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(errorCodes(s.game(alice, { t: 'answer', promptId: 'r1-p0', text: '   ' }))).toEqual(['INVALID_MESSAGE']);
    expect(errorCodes(s.game(alice, { t: 'answer', promptId: 'r1-p0', text: 'x'.repeat(QUIPGAME_ANSWER_MAX_LENGTH + 1) }))).toEqual(['INVALID_MESSAGE']);
    expect(errorCodes(s.game(alice, { t: 'answer', promptId: 'r1-p0', text: 'x'.repeat(QUIPGAME_ANSWER_MAX_LENGTH) }))).toEqual([]);
    expect(errors(s.game(alice, { t: 'answer', promptId: 'r1-p1', text: 'not mine' }))).toEqual(["That's not one of your prompts."]);
    expect(errors(s.game(carol, { t: 'answer', promptId: 'nope', text: 'what' }))).toEqual(["That's not one of your prompts."]);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    expect(view(s, dave)).toMatchObject({ isSpectator: true, myPrompts: [], spectators: [dave] });
    expect(errors(s.game(dave, { t: 'answer', promptId: 'r1-p0', text: 'hello' }))).toEqual(['You are watching this round.']);
  });

  it('ends early once everyone has written, with the matchups built and a system line', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    writeAll(s, [carol]);
    expect(data(s).phase).toBe('writing');
    s.game(carol, { t: 'answer', promptId: 'r1-p1', text: 'one' });
    expect(data(s).phase).toBe('writing');
    const effects = s.game(carol, { t: 'answer', promptId: 'r1-p2', text: 'two' });
    expect(chatTexts(effects)).toEqual(["Everyone's in — time to vote!"]);
    expect(data(s)).toMatchObject({ phase: 'voting', matchupIndex: 0, endsAt: START + VOTE_MS });
    expect(data(s).matchups).toHaveLength(3);
    expect(data(s).answers).toHaveLength(6);
    expect(data(s).answers.every((a) => !a.fallback)).toBe(true);
    expect(nextDeadline(s.data)).toBe(START + VOTE_MS);
    expect(errors(s.game(alice, { t: 'answer', promptId: 'r1-p0', text: 'late' }))).toEqual(['Writing is over.']);
    expect(errors(s.game(bob, { t: 'answer', promptId: 'r1-p0', text: 'late' }))).toEqual(['Writing is over.']);
  });

  it('fills missing answers from the fallbacks at the deadline so every matchup still works', () => {
    const s = sim('quipgame');
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    writeAll(s, [alice]);
    s.now += WRITE_MS - 1;
    expect(s.tick()).toEqual([]);
    s.now += 1;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(["Time's up — time to vote!"]);
    const mine = data(s).answers.filter((a) => a.authorId === alice);
    expect(mine).toHaveLength(2);
    for (const a of mine) {
      expect(a.fallback).toBe(true);
      expect(FALLBACK_ANSWERS).toContain(a.text);
    }
    expect(data(s).phase).toBe('voting');
    expect(nextDeadline(s.data)).toBe(START + WRITE_MS + VOTE_MS);
  });

  it('does not wait for a writer who left the room', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    const dave = s.playerId('Dave');
    writeAll(s, [dave]);
    expect(data(s).phase).toBe('writing');
    expect(view(s, alice)).toMatchObject({ done: 3, total: 4 });
    s.apply({ type: 'leave', playerId: dave });
    expect(data(s).phase).toBe('voting');
    expect(data(s).answers.filter((a) => a.authorId === dave).every((a) => a.fallback)).toBe(true);
    expect(data(s).roundPlayers).toEqual([alice, bob, carol, dave]);
  });
});

describe('Quip Game: matchups and votes', () => {
  it('shows everyone the same prompt and A/B answers with the authors hidden until the result', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    writeAll(s);
    const m = matchup(s);
    // rng () => 0 flips every matchup: A is the second author's answer.
    expect(authors(s)).toEqual([alice, bob]);
    const expected = { index: 0, total: 3, prompt: data(s).prompts[0].text, a: answerText(s, alice, 'r1-p0'), b: answerText(s, bob, 'r1-p0'), votes: 0 };
    for (const viewer of [alice, bob, carol, null]) {
      const v = view(s, viewer);
      expect(v.matchup).toEqual(expected);
      expect(v.result).toBeNull();
      expect(JSON.stringify(v.matchup)).not.toContain('author');
    }
    expect(view(s, alice)).toMatchObject({ isAuthor: true, canVote: false, myVote: null });
    expect(view(s, bob)).toMatchObject({ isAuthor: true, canVote: false });
    expect(view(s, carol)).toMatchObject({ isAuthor: false, canVote: true, myVote: null });
    expect(view(s, null)).toMatchObject({ isAuthor: false, canVote: false });
    expect(m.votes).toEqual({});
  });

  it('refuses the authors, counts spectators, lets a voter change their mind and shows the live count', () => {
    const s = sim('quipgame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    writeAll(s);
    s.apply({ type: 'join', name: 'Erin', avatar: AVATAR, connectionId: 'conn-Erin' });
    const erin = s.playerId('Erin');
    expect(authors(s)).toEqual([alice, bob]);
    expect(voters(s)).toEqual([carol, dave, erin]);
    expect(errors(s.game(alice, { t: 'vote', choice: 'a' }))).toEqual(["This one's yours — sit tight."]);
    expect(view(s, erin)).toMatchObject({ isSpectator: true, canVote: true });
    s.game(erin, { t: 'vote', choice: 'b' });
    s.game(carol, { t: 'vote', choice: 'a' });
    expect(view(s, alice).matchup?.votes).toBe(2);
    expect(view(s, carol).myVote).toBe('a');
    s.game(carol, { t: 'vote', choice: 'b' });
    expect(view(s, carol).myVote).toBe('b');
    expect(matchup(s).votes).toEqual({ [erin]: 'b', [carol]: 'b' });
    expect(data(s).phase).toBe('voting');
    const effects = s.game(dave, { t: 'vote', choice: 'b' });
    expect(data(s).phase).toBe('result');
    expect(matchup(s).result).toEqual({ votes: { a: 0, b: 3 }, points: { a: 0, b: 1250 }, flawless: 'b', outcome: 'b' });
    expect(chatTexts(effects)).toEqual(['Bob took it 3-0 (+1250) — flawless!']);
    expect(score(s, bob)).toBe(1250);
    expect(score(s, alice)).toBe(0);
    expect(errors(s.game(carol, { t: 'vote', choice: 'a' }))).toEqual(['There is no matchup to vote on.']);
  });

  it('ignores disconnected voters in the all-voted check and resolves when the last connected voter leaves', () => {
    const s = sim('quipgame');
    const [, , carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Erin']);
    const erin = s.playerId('Erin');
    writeAll(s);
    expect(voters(s)).toEqual([carol, dave, erin]);
    s.game(carol, { t: 'vote', choice: 'a' });
    disconnect(s, erin);
    expect(data(s).phase).toBe('voting');
    expect(view(s, erin).canVote).toBe(false);
    // Dave is the last connected voter: his vote resolves the matchup without Erin.
    s.game(dave, { t: 'vote', choice: 'a' });
    expect(data(s).phase).toBe('result');
    expect(matchup(s).result?.votes).toEqual({ a: 2, b: 0 });

    // Next matchup: Carol votes, Dave leaves, so Carol is the only connected voter left and the matchup resolves.
    s.game(s.playerId('Alice'), { t: 'next' });
    expect(data(s).phase).toBe('voting');
    const pending = voters(s);
    expect(pending).not.toContain(erin);
    s.game(pending[0], { t: 'vote', choice: 'b' });
    for (const id of pending.slice(1)) s.apply({ type: 'leave', playerId: id });
    expect(data(s).phase).toBe('result');
  });

  it('resolves at the deadline with the votes cast so far, and scores nothing without any', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    const dave = s.playerId('Dave');
    writeAll(s);
    const votingStart = s.now;
    s.game(carol, { t: 'vote', choice: 'a' });
    s.now = votingStart + VOTE_MS;
    let effects = s.tick();
    expect(data(s).phase).toBe('result');
    expect(matchup(s).result).toEqual({ votes: { a: 1, b: 0 }, points: { a: 1000, b: 0 }, flawless: null, outcome: 'a' });
    expect(chatTexts(effects)).toEqual(['Alice took it 1-0 (+1000)']);
    expect(score(s, alice)).toBe(1000);
    expect(nextDeadline(s.data)).toBe(s.now + RESULT_MS);

    s.game(alice, { t: 'next' });
    expect(authors(s)).toEqual([bob, carol]);
    s.now += VOTE_MS;
    effects = s.tick();
    expect(matchup(s).result).toEqual({ votes: { a: 0, b: 0 }, points: { a: 0, b: 0 }, flawless: null, outcome: 'noVotes' });
    expect(chatTexts(effects)).toEqual([`Nobody voted on "${data(s).prompts[1].text}" — no points.`]);
    expect([score(s, bob), score(s, carol), score(s, dave)]).toEqual([0, 0, 0]);
  });
});

describe('Quip Game: scoring', () => {
  it('splits the pool by votes (3-1 is 750/250), splits a tie evenly and doubles everything in round two', () => {
    const s = sim('quipgame');
    const [alice, bob] = startGame(s, NAMES.slice(0, 6));
    writeAll(s);
    expect(authors(s)).toEqual([alice, bob]);
    let effects = castVotes(s, ['a', 'a', 'b', 'a']);
    expect(matchup(s).result).toEqual({ votes: { a: 3, b: 1 }, points: { a: 750, b: 250 }, flawless: null, outcome: 'a' });
    expect(chatTexts(effects)).toEqual(['Alice took it 3-1 (+750)']);
    expect([score(s, alice), score(s, bob)]).toEqual([750, 250]);
    expect(view(s, null).result).toMatchObject({
      index: 0,
      total: 6,
      outcome: 'a',
      a: { authorId: alice, authorName: 'Alice', votes: 3, points: 750, flawless: false, fallback: false, text: answerText(s, alice, 'r1-p0') },
      b: { authorId: bob, authorName: 'Bob', votes: 1, points: 250, flawless: false },
    });

    s.game(alice, { t: 'next' });
    const [x, y] = authors(s);
    effects = castVotes(s, ['a', 'b', 'b', 'a']);
    expect(matchup(s).result).toMatchObject({ points: { a: 500, b: 500 }, flawless: null, outcome: 'tie' });
    expect(chatTexts(effects)).toEqual([`${nameOf(s, x)} and ${nameOf(s, y)} tie 2-2 (+500 each)`]);

    // Round two: the same split is worth double.
    playRound(s, alice);
    expect(data(s).round).toBe(2);
    writeAll(s);
    const before = authors(s).map((id) => score(s, id));
    effects = castVotes(s, ['a', 'a', 'b', 'a']);
    expect(matchup(s).result).toEqual({ votes: { a: 3, b: 1 }, points: { a: 1500, b: 500 }, flawless: null, outcome: 'a' });
    expect(authors(s).map((id) => score(s, id))).toEqual([before[0] + 1500, before[1] + 500]);
    expect(chatTexts(effects)).toEqual([`${nameOf(s, authors(s)[0])} took it 3-1 (+1500)`]);
  });

  it('pays the flawless bonus for a sweep of two or more votes, never for a single vote', () => {
    const s = sim('quipgame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    writeAll(s);
    expect(authors(s)).toEqual([alice, bob]);
    castVotes(s, ['b', 'b']);
    expect(matchup(s).result).toEqual({ votes: { a: 0, b: 2 }, points: { a: 0, b: 1250 }, flawless: 'b', outcome: 'b' });
    expect(view(s, null).result?.b.flawless).toBe(true);
    expect(score(s, bob)).toBe(1250);

    const t = sim('quipgame');
    const [a2, b2] = startGame(t, ['Alice', 'Bob', 'Carol']);
    writeAll(t);
    expect(authors(t)).toEqual([a2, b2]);
    castVotes(t, ['a']);
    expect(matchup(t).result).toEqual({ votes: { a: 1, b: 0 }, points: { a: 1000, b: 0 }, flawless: null, outcome: 'a' });
    expect(score(t, a2)).toBe(1000);
  });
});

describe('Quip Game: results and the flow between rounds', () => {
  it('advances from a result on its own, lets only the host skip it, and only during a result', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    writeAll(s);
    expect(errors(s.game(alice, { t: 'next' }))).toEqual(['There is no result to skip.']);
    castVotes(s, ['a']);
    expect(data(s)).toMatchObject({ phase: 'result', matchupIndex: 0 });
    expect(view(s, alice).canSkip).toBe(true);
    expect(view(s, bob).canSkip).toBe(false);
    expect(errors(s.game(bob, { t: 'next' }))).toEqual(['Only the host can skip ahead.']);
    expect(data(s).phase).toBe('result');
    s.now += RESULT_MS;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'voting', matchupIndex: 1, endsAt: s.now + VOTE_MS });
    expect(authors(s)).toEqual([bob, carol]);
    castVotes(s, ['b']);
    s.game(alice, { t: 'next' });
    expect(data(s)).toMatchObject({ phase: 'voting', matchupIndex: 2 });
    expect(authors(s)).toEqual([carol, alice]);
  });

  it('starts round two after the last matchup and ends the game after round two without a final', () => {
    const s = sim('quipgame');
    const [alice] = startGame(s, ['Alice', 'Bob', 'Carol']);
    writeAll(s);
    playRound(s, alice);
    expect(data(s)).toMatchObject({ phase: 'writing', round: 2, totalRounds: 2, matchupIndex: 0, matchups: [], answers: [] });
    expect(data(s).prompts.map((p) => p.id)).toEqual(['r2-p0', 'r2-p1', 'r2-p2']);
    writeAll(s);
    playRound(s, alice);
    expect(s.data.phase).toBe('ended');
    expect(data(s).phase).toBe('over');
    expect(view(s, alice)).toMatchObject({ phase: 'result', canSkip: false });
    expect(nextDeadline(s.data)).toBeNull();
    expect(s.data.podium).toHaveLength(3);
    expect(s.data.podium?.[0].score).toBe(Math.max(...s.data.players.map((p) => p.score)));
    expect(chatTexts(s.effects).some((t) => t.startsWith('Game over!'))).toBe(true);
  });

  it('seats mid-game joiners as spectators who vote now and write from the next round', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    expect(view(s, dave)).toMatchObject({ isSpectator: true, roundPlayers: [alice, bob, carol], spectators: [dave], total: 3 });
    writeAll(s);
    expect(view(s, dave).canVote).toBe(true);
    playRound(s, alice);
    expect(data(s).roundPlayers).toEqual([alice, bob, carol, dave]);
    expect(view(s, dave)).toMatchObject({ isSpectator: false, spectators: [], total: 4 });
    expect(view(s, dave).myPrompts).toHaveLength(2);
  });
});
