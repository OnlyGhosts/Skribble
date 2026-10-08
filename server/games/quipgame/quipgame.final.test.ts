/** Quip Game's final round, the announcer, the hold for missing players at a round boundary and the module's purity through the pure engine. */
import { describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { AVATAR, START, chatTexts, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { viewFor } from '../../platform/engine/view.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { quipgameModule, type QuipgameData } from './module.js';
import { answerText, authors, castVotes, data, disconnect, errors, matchup, playRound, reconnect, score, view, voters, writeAll } from './testHarness.js';

const VOTE_MS = 10_000;
const RESULT_MS = 4_000;

/** Plays both regular rounds (everyone votes A, the host skips results) so the final begins. */
function reachFinal(s: Sim, host: string): void {
  for (let round = 1; round <= 2; round++) {
    writeAll(s);
    playRound(s, host);
  }
  expect(data(s)).toMatchObject({ phase: 'finalWriting', round: 3 });
}

/** The final answer id written by `id`. */
const finalAnswerOf = (s: Sim, id: string): string => {
  const a = data(s).answers.find((x) => x.authorId === id);
  if (!a) throw new Error(`no final answer for ${id}`);
  return a.id;
};

describe('Quip Game: the final round', () => {
  it('gives everyone the same single prompt and one answer each, then opens an anonymous shuffled ranking', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    expect(chatTexts(s.effects)).toContain('Final round — one prompt, everyone answers!');
    expect(data(s).prompts).toEqual([{ id: 'r3-p0', text: expect.any(String), authorIds: [alice, bob, carol] }]);
    expect(data(s).final).toEqual({ order: [], rankings: {}, announcerId: null, result: null });
    for (const id of [alice, bob, carol]) {
      expect(view(s, id)).toMatchObject({ phase: 'finalWriting', round: 3, totalRounds: 3, finalPrompt: data(s).prompts[0].text, finalAnswers: [], maxPicks: 0, total: 3 });
      expect(view(s, id).myPrompts).toEqual([{ id: 'r3-p0', text: data(s).prompts[0].text }]);
    }
    expect(errors(s.game(alice, { t: 'rank', answerIds: ['x'] }))).toEqual(['There is no ranking open.']);

    writeAll(s, [carol]);
    expect(view(s, alice)).toMatchObject({ done: 2, total: 3, phase: 'finalWriting' });
    s.game(carol, { t: 'answer', promptId: 'r3-p0', text: answerText(s, carol, 'r3-p0') });
    expect(data(s)).toMatchObject({ phase: 'finalVoting', endsAt: s.now + VOTE_MS });
    const order = data(s).final?.order ?? [];
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(data(s).answers.map((a) => a.id)));
    for (const viewer of [alice, bob, carol, null]) {
      const v = view(s, viewer);
      expect(v.finalAnswers).toEqual(order.map((id) => ({ id, text: data(s).answers.find((a) => a.id === id)?.text })));
      expect(JSON.stringify(v.finalAnswers)).not.toContain('author');
      expect(v.finalResult).toBeNull();
    }
    expect(view(s, alice)).toMatchObject({ myAnswerId: finalAnswerOf(s, alice), maxPicks: 2, myRanking: [], ranked: 0 });
    expect(view(s, null)).toMatchObject({ myAnswerId: null, maxPicks: 0 });
  });

  it('validates rankings: never your own answer, no duplicates, at most min(3, pickable) picks, only real answers', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    writeAll(s);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    expect(errors(s.game(alice, { t: 'rank', answerIds: [a] }))).toEqual(["You can't pick your own answer."]);
    expect(errors(s.game(alice, { t: 'rank', answerIds: [b, b] }))).toEqual(['Pick each answer once.']);
    expect(errors(s.game(alice, { t: 'rank', answerIds: [b, 'ghost'] }))).toEqual(["That's not one of the answers."]);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    // A spectator has nothing of their own in the list: three picks from three answers.
    expect(view(s, dave).maxPicks).toBe(3);
    expect(errors(s.game(dave, { t: 'rank', answerIds: [a, b, c] }))).toEqual([]);
    expect(view(s, dave).myRanking).toEqual([a, b, c]);
    expect(data(s).phase).toBe('finalVoting');
    // Alice may pick two; a third is refused even though the schema allows three.
    expect(errors(s.game(alice, { t: 'rank', answerIds: [b, c, a] }))).toEqual(["You can't pick your own answer."]);
    s.apply({ type: 'join', name: 'Erin', avatar: AVATAR, connectionId: 'conn-Erin' });
    const erin = s.playerId('Erin');
    s.game(erin, { t: 'answer', promptId: 'r3-p0', text: 'nope' });
    expect(view(s, erin).maxPicks).toBe(3);
    expect(view(s, alice).maxPicks).toBe(2);
    expect(s.data.players).toHaveLength(5);
  });

  it('sums 1500 / 1000 / 500 per voter, ranks the answers, pays the authors, then ends on the podium', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    const before = [alice, bob, carol].map((id) => score(s, id));
    writeAll(s);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    s.game(alice, { t: 'rank', answerIds: [b, c] });
    s.game(carol, { t: 'rank', answerIds: [b] });
    expect(view(s, carol)).toMatchObject({ ranked: 2, phase: 'finalVoting', myRanking: [b] });
    // A ranking can change until the last voter is in.
    s.game(carol, { t: 'rank', answerIds: [b, a] });
    expect(view(s, carol)).toMatchObject({ ranked: 2, phase: 'finalVoting', myRanking: [b, a] });
    s.game(bob, { t: 'rank', answerIds: [c, a] });
    expect(data(s)).toMatchObject({ phase: 'finalResult', endsAt: s.now + RESULT_MS });
    expect(data(s).final?.result).toEqual([
      { answerId: b, points: 3000, rank: 1 },
      { answerId: c, points: 2500, rank: 2 },
      { answerId: a, points: 2000, rank: 3 },
    ]);
    expect([alice, bob, carol].map((id) => score(s, id))).toEqual([before[0] + 2000, before[1] + 3000, before[2] + 2500]);
    expect(chatTexts(s.effects)).toContain('Final ranking: 1. Bob (3000), 2. Carol (2500), 3. Alice (2000)');
    expect(view(s, null).finalResult).toEqual([
      { id: b, text: answerText(s, bob, 'r3-p0'), authorId: bob, authorName: 'Bob', points: 3000, rank: 1, fallback: false },
      { id: c, text: answerText(s, carol, 'r3-p0'), authorId: carol, authorName: 'Carol', points: 2500, rank: 2, fallback: false },
      { id: a, text: answerText(s, alice, 'r3-p0'), authorId: alice, authorName: 'Alice', points: 2000, rank: 3, fallback: false },
    ]);
    expect(view(s, alice).canSkip).toBe(true);
    s.now += RESULT_MS;
    s.tick();
    expect(s.data.phase).toBe('ended');
    expect(data(s).phase).toBe('over');
    expect(view(s, alice)).toMatchObject({ phase: 'finalResult', canSkip: false });
    expect(s.data.podium?.[0]).toMatchObject({ playerId: bob, rank: 1 });
    expect(nextDeadline(s.data)).toBeNull();
  });

  it('withdraws the ranking of a voter who leaves, so their picks pay nobody', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    writeAll(s);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    s.game(dave, { t: 'rank', answerIds: [a, b, c] });
    s.game(alice, { t: 'rank', answerIds: [b, c] });
    expect(view(s, bob).ranked).toBe(2);
    s.apply({ type: 'leave', playerId: dave });
    expect(data(s).phase).toBe('finalVoting');
    expect(data(s).final?.rankings).toEqual({ [alice]: [b, c] });
    expect(view(s, bob)).toMatchObject({ ranked: 1, voted: [alice] });
    s.game(carol, { t: 'rank', answerIds: [b, a] });
    s.game(bob, { t: 'rank', answerIds: [c, a] });
    expect(data(s).phase).toBe('finalResult');
    // Without Dave's 1500 / 1000 / 500 the totals are exactly the three remaining voters' picks.
    expect(data(s).final?.result).toEqual([
      { answerId: b, points: 3000, rank: 1 },
      { answerId: c, points: 2500, rank: 2 },
      { answerId: a, points: 2000, rank: 3 },
    ]);
  });

  it('resolves the ranking at the deadline with what was submitted, shares tied ranks, and lets the host skip the final result', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    writeAll(s);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    s.game(alice, { t: 'rank', answerIds: [b, c] });
    s.now += VOTE_MS;
    s.tick();
    expect(data(s).phase).toBe('finalResult');
    expect(data(s).final?.result).toEqual([
      { answerId: b, points: 1500, rank: 1 },
      { answerId: c, points: 1000, rank: 2 },
      { answerId: a, points: 0, rank: 3 },
    ]);
    expect(errors(s.game(bob, { t: 'next' }))).toEqual(['Only the host can skip ahead.']);
    s.game(alice, { t: 'next' });
    expect(s.data.phase).toBe('ended');

    const t = sim('quipgame');
    const [x, y, z] = startGame(t, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(t, x);
    writeAll(t);
    const [ax, ay, az] = [x, y, z].map((id) => finalAnswerOf(t, id));
    t.game(x, { t: 'rank', answerIds: [ay] });
    t.game(y, { t: 'rank', answerIds: [az] });
    t.game(z, { t: 'rank', answerIds: [ax] });
    expect(data(t).final?.result?.map((e) => e.rank)).toEqual([1, 1, 1]);
  });

  it('keeps the ranking open for a voter whose socket dropped, and resolves once everyone seated with something to pick has ranked', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { finalRound: true });
    const dave = s.playerId('Dave');
    reachFinal(s, alice);
    writeAll(s);
    disconnect(s, dave);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    s.game(alice, { t: 'rank', answerIds: [b] });
    s.game(bob, { t: 'rank', answerIds: [c] });
    s.game(carol, { t: 'rank', answerIds: [a] });
    // Dave keeps his seat, so his picks are still awaited (the deadline would resolve without them).
    expect(data(s).phase).toBe('finalVoting');
    expect(view(s, dave).maxPicks).toBe(0);
    reconnect(s, dave);
    expect(data(s).phase).toBe('finalVoting');
    expect(view(s, dave).maxPicks).toBe(3);
    s.game(dave, { t: 'rank', answerIds: [a, b] });
    expect(data(s).phase).toBe('finalResult');
    expect(data(s).final?.rankings[dave]).toEqual([a, b]);
    expect(view(s, dave).finalResult).toHaveLength(4);
  });

  it('opens the ranking even when nobody is connected at the writing deadline, so returning players can still rank', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    reachFinal(s, alice);
    writeAll(s, [carol]);
    // Every socket is cut just before the writing deadline.
    for (const id of [alice, bob, carol]) disconnect(s, id);
    s.now = data(s).endsAt;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'finalVoting', endsAt: s.now + VOTE_MS });
    expect(data(s).final?.result).toBeNull();
    for (const id of [alice, bob, carol]) reconnect(s, id);
    const [a, b, c] = [alice, bob, carol].map((id) => finalAnswerOf(s, id));
    s.game(alice, { t: 'rank', answerIds: [b, c] });
    s.game(bob, { t: 'rank', answerIds: [c, a] });
    expect(data(s).phase).toBe('finalVoting');
    s.game(carol, { t: 'rank', answerIds: [a, b] });
    expect(data(s).phase).toBe('finalResult');
  });
});

describe('Quip Game: the announcer', () => {
  it('rotates through connected non-authors in join order, matchup after matchup, and reads the final', () => {
    const s = sim('quipgame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { announcer: true, finalRound: true });
    writeAll(s);
    const seen: Array<string | null> = [];
    for (let i = 0; i < 4; i++) {
      const announcer = matchup(s).announcerId;
      seen.push(announcer);
      expect(announcer).not.toBeNull();
      expect(authors(s)).not.toContain(announcer);
      for (const viewer of [alice, bob, carol, dave]) expect(view(s, viewer)).toMatchObject({ announcerId: announcer, isAnnouncer: viewer === announcer });
      castVotes(s, voters(s).map(() => 'a'));
      expect(view(s, alice).announcerId).toBe(announcer);
      if (i < 3) s.game(alice, { t: 'next' });
    }
    expect(seen).toEqual([carol, dave, alice, bob]);
    s.game(alice, { t: 'next' });
    expect(data(s).round).toBe(2);
    writeAll(s);
    playRound(s, alice);
    writeAll(s);
    expect(data(s).phase).toBe('finalVoting');
    expect(data(s).final?.announcerId).not.toBeNull();
    expect(view(s, alice).announcerId).toBe(data(s).final?.announcerId);
  });

  it('hands the job on when the announcer drops, and names nobody when the setting is off', () => {
    const s = sim('quipgame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { announcer: true });
    writeAll(s);
    expect(matchup(s).announcerId).toBe(carol);
    disconnect(s, carol);
    expect(matchup(s).announcerId).toBe(dave);
    expect(view(s, dave).isAnnouncer).toBe(true);
    expect([alice, bob]).toEqual(authors(s));

    const t = sim('quipgame');
    startGame(t, ['Alice', 'Bob', 'Carol']);
    writeAll(t);
    expect(matchup(t).announcerId).toBeNull();
    expect(view(t, null)).toMatchObject({ announcerId: null, isAnnouncer: false });
  });
});

describe('Quip Game: holding for missing players', () => {
  /** Plays the current round up to its last result, drops `ids` there, and ticks across the round boundary. */
  function holdAtRoundEnd(s: Sim, host: string, ids: string[]): { droppedAt: number; effects: ReturnType<Sim['tick']> } {
    writeAll(s);
    while (data(s).matchupIndex + 1 < data(s).matchups.length) {
      castVotes(s, voters(s).map(() => 'a'));
      s.game(host, { t: 'next' });
    }
    castVotes(s, voters(s).map(() => 'a'));
    expect(data(s).phase).toBe('result');
    const droppedAt = s.now;
    for (const id of ids) disconnect(s, id);
    s.now += RESULT_MS;
    return { droppedAt, effects: s.tick() };
  }

  it('holds at the round boundary while a seated player is away: the last result stays up, nothing is scheduled, the room is told', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const { droppedAt, effects } = holdAtRoundEnd(s, alice, [bob]);
    expect(chatTexts(effects)).toEqual(['Waiting for Bob to reconnect…']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ phase: 'waiting', round: 1, matchupIndex: 2 });
    expect(viewFor(s.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 3, connected: 2 });
    // The game view keeps the last result (and nobody can skip it); the platform's waiting state sits over it.
    expect(view(s, alice)).toMatchObject({ phase: 'result', round: 1, canSkip: false, roundPlayers: [alice, bob, carol] });
    expect(view(s, alice).result).toMatchObject({ index: 2, total: 3 });
    expect(quipgameModule.nextDeadline(data(s))).toBeNull();
    expect(nextDeadline(s.data)).toBe(droppedAt + RECONNECT_GRACE_MS);
    s.now += 60_000;
    expect(s.tick()).toEqual([]);
    expect(JSON.parse(JSON.stringify(s.data))).toStrictEqual(s.data);

    // Bob is back: the game settles for a moment (nobody is missing, so no hold shows), then round two starts with everyone.
    reconnect(s, bob);
    expect(data(s)).toMatchObject({ phase: 'waiting', round: 1, resumeAt: s.now + RESUME_SETTLE_MS });
    expect(nextDeadline(s.data)).toBe(s.now + RESUME_SETTLE_MS);
    expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
    s.now += RESUME_SETTLE_MS;
    const started = s.tick();
    expect(chatTexts(started)).toEqual(['Round 2 of 2 — write your answers! Double points!']);
    expect(data(s)).toMatchObject({ phase: 'writing', round: 2, roundPlayers: [alice, bob, carol], endsAt: s.now + 30_000, resumeAt: null });
    expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
    expect(view(s, bob).myPrompts).toHaveLength(2);
  });

  it('holds before the final too, and a joiner may end the hold', () => {
    const s = sim('quipgame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { finalRound: true });
    writeAll(s);
    playRound(s, alice);
    expect(data(s).round).toBe(2);
    holdAtRoundEnd(s, alice, [bob]);
    expect(data(s)).toMatchObject({ phase: 'waiting', round: 2 });
    expect(view(s, alice)).toMatchObject({ phase: 'result', round: 2, finalPrompt: null });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'conn-Dave' });
    const dave = s.playerId('Dave');
    expect(data(s)).toMatchObject({ phase: 'waiting', resumeAt: s.now + RESUME_SETTLE_MS });
    expect(viewFor(s.data, dave, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 3, connected: 3 });
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'finalWriting', round: 3, roundPlayers: [alice, carol, dave], resumeAt: null });
    expect(viewFor(s.data, dave, s.now).waiting).toBeNull();
    expect(view(s, bob).isSpectator).toBe(true);
  });

  it('seats the next round with everyone back after a simultaneous cut: a straggler restarts the settle instead of spectating the round', () => {
    const s = sim('quipgame');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    holdAtRoundEnd(s, alice, [bob, carol]);
    // Hosting cuts the remaining sockets too; the clients reconnect at once, in any order.
    disconnect(s, alice);
    disconnect(s, dave);
    expect(viewFor(s.data, null, s.now).waiting).toMatchObject({ missing: [alice, bob, carol, dave], connected: 0 });
    reconnect(s, alice);
    reconnect(s, bob);
    expect(data(s)).toMatchObject({ phase: 'waiting', resumeAt: null });
    reconnect(s, carol);
    const settleFrom = s.now;
    expect(data(s).resumeAt).toBe(settleFrom + RESUME_SETTLE_MS);
    s.now += 50;
    reconnect(s, dave);
    expect(data(s).resumeAt).toBe(s.now + RESUME_SETTLE_MS);
    // The first settle's instant passes without a round; the restarted one starts it, with all four writing.
    s.now = settleFrom + RESUME_SETTLE_MS;
    expect(s.tick()).toEqual([]);
    expect(data(s).phase).toBe('waiting');
    s.now += 50;
    s.tick();
    expect(data(s)).toMatchObject({ phase: 'writing', round: 2, roundPlayers: [alice, bob, carol, dave], resumeAt: null });
    expect(view(s, dave).myPrompts).toHaveLength(2);
  });

  it('abandons the game when a missing seat expires, when the player leaves, or when the host removes them', () => {
    const expired = sim('quipgame');
    const [alice, bob] = startGame(expired, ['Alice', 'Bob', 'Carol']);
    const { droppedAt } = holdAtRoundEnd(expired, alice, [bob]);
    expired.now = droppedAt + RECONNECT_GRACE_MS;
    const effects = expired.tick();
    expect(chatTexts(effects)).toEqual(['Bob left', 'Not enough players — back to the lobby.']);
    expect(expired.data).toMatchObject({ phase: 'lobby', game: null, podium: null, waiting: null });
    expect(expired.data.players.map((p) => p.id)).not.toContain(bob);
    expect(expired.data.players.every((p) => p.score === 0)).toBe(true);
    expect(viewFor(expired.data, alice, expired.now).waiting).toBeNull();

    const left = sim('quipgame');
    const [host2, bob2] = startGame(left, ['Alice', 'Bob', 'Carol']);
    holdAtRoundEnd(left, host2, [bob2]);
    left.apply({ type: 'leave', playerId: bob2 });
    expect(left.data).toMatchObject({ phase: 'lobby', game: null, waiting: null });

    // With a seat to spare, removing one missing player narrows the hold; removing the last one needed ends it.
    const kicked = sim('quipgame');
    const [host3, bob3, carol3, dave3] = startGame(kicked, ['Alice', 'Bob', 'Carol', 'Dave']);
    const more = holdAtRoundEnd(kicked, host3, [bob3, carol3]);
    expect(chatTexts(more.effects)).toEqual(['Waiting for Bob, Carol to reconnect…']);
    kicked.platform(host3, { t: 'kick', playerId: bob3 });
    expect(kicked.data.phase).toBe('playing');
    expect(viewFor(kicked.data, host3, kicked.now).waiting).toEqual({ reason: 'players', missing: [carol3], needed: 3, connected: 2 });
    kicked.platform(host3, { t: 'kick', playerId: carol3 });
    expect(kicked.data).toMatchObject({ phase: 'lobby', game: null, waiting: null });
    expect(kicked.data.players.map((p) => p.id)).toEqual([host3, dave3]);
  });
});

describe('Quip Game: edges', () => {
  it('survives JSON at every phase', () => {
    const s = sim('quipgame');
    const [alice, bob, , dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { finalRound: true, announcer: true });
    const roundTrip = (): void => expect(JSON.parse(JSON.stringify(s.data))).toStrictEqual(s.data);
    roundTrip();
    writeAll(s, [dave]);
    disconnect(s, dave);
    roundTrip();
    s.now += 30_000;
    s.tick();
    roundTrip();
    castVotes(s, ['a']);
    roundTrip();
    reconnect(s, dave);
    playRound(s, alice);
    writeAll(s);
    playRound(s, alice);
    writeAll(s);
    roundTrip();
    s.game(bob, { t: 'rank', answerIds: [data(s).final?.order.find((id) => data(s).answers.find((a) => a.id === id)?.authorId !== bob) ?? ''] });
    roundTrip();
    s.now += VOTE_MS;
    s.tick();
    roundTrip();
    expect(JSON.parse(JSON.stringify(view(s, alice)))).toStrictEqual(view(s, alice));
  });

  it('is a pure module: the same object comes back when nothing changed', () => {
    const s = sim('quipgame');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const game = data(s);
    const ctx = { now: s.now, rng: () => 0, newId: () => 'x', settings: { ...quipgameModule.settings.defaults }, players: s.data.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: p.connected, score: p.score })), hostId: alice };
    expect(quipgameModule.handle(ctx, game, { type: 'tick' }).data).toBe(game);
    expect(quipgameModule.handle(ctx, game, { type: 'chat', playerId: alice, text: 'hi' }).data).toBe(game);
    expect(quipgameModule.handle(ctx, game, { type: 'playerJoined', playerId: 'new' }).data).toBe(game);
    expect(quipgameModule.handle(ctx, game, { type: 'playerDisconnected', playerId: bob }).data).toBe(game);
    const refused = quipgameModule.handle(ctx, game, { type: 'message', playerId: bob, msg: { t: 'vote', choice: 'a' } });
    expect(refused.data).toBe(game);
    expect(refused.effects).toEqual([{ type: 'error', playerId: bob, code: 'NOT_ALLOWED', message: 'There is no matchup to vote on.' }]);
    const written = quipgameModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'answer', promptId: 'r1-p0', text: 'hello' } });
    expect(written.data).not.toBe(game);
    expect(game.answers).toEqual([]);
    const over: QuipgameData = { ...game, phase: 'over' };
    expect(quipgameModule.handle(ctx, over, { type: 'tick' }).data).toBe(over);
    expect(quipgameModule.nextDeadline(over)).toBeNull();
    expect(quipgameModule.nextDeadline(game)).toBe(START + 30_000);
  });
});
