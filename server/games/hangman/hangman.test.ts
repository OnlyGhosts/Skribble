/** Hangman's rules through the pure engine: choosing, the guess rotation, scoring, the drawing steps, the holds and the edges. */
import { describe, expect, it } from 'vitest';
import {
  HANGMAN_CHOOSE_SECONDS,
  HANGMAN_MAX_WRONG,
  HANGMAN_POINTS,
  HANGMAN_TURN_END_SECONDS,
  type HangmanView,
} from '../../../shared/games/hangman/protocol.js';
import { hangmanWordPool } from '../../../shared/games/hangman/words.js';
import { RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, TEST_WORDS, chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { hangmanCanvasPolicy } from './canvas.js';
import { hangmanModule, type HangmanData } from './module.js';

const CHOOSE_MS = HANGMAN_CHOOSE_SECONDS * 1000;
const GUESS_MS = 10_000; // the fixture's guessSeconds
const DRAW_MS = 10_000; // the fixture's drawSeconds
const TURN_END_MS = HANGMAN_TURN_END_SECONDS * 1000;

const view = (s: Sim, viewer: string | null = null): HangmanView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as HangmanView;
};
const data = (s: Sim): HangmanData => s.data.game as HangmanData;
const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const waiting = (s: Sim): string[] | null => viewFor(s.data, null, s.now).waiting?.missing ?? null;
const disconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${name}` });
const reconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });
const letter = (s: Sim, id: string, letter: string): Effect[] => s.game(id, { t: 'letter', letter });
const word = (s: Sim, id: string, text: string): Effect[] => s.game(id, { t: 'word', text });
const drawDone = (s: Sim, id: string): Effect[] => s.game(id, { t: 'drawDone' });
const waits = (effects: Effect[]): Array<string[] | null> =>
  effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'room' ? [(e.msg as { room: { waiting: { missing: string[] } | null } }).room.waiting?.missing ?? null] : []));

/** A wrong letter guess followed by the hangman finishing the section at once. */
function wrongAndDraw(s: Sim, guesser: string, hangman: string, wrongLetter: string): void {
  letter(s, guesser, wrongLetter);
  expect(view(s).phase).toBe('drawing');
  drawDone(s, hangman);
}

// With the fixture (custom words only, rng () => 0) the host is the first hangman and APPLE, BANANA, CHERRY their choices.

describe('Hangman: choosing', () => {
  it('starts with the host choosing from three words, a fresh canvas, the clock and a system line; only they see the choices', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ round: 1, roundPlayerIds: [alice, bob, carol], turnQueue: [alice, bob, carol], turnIndex: 0, usedWords: [] });
    expect(data(s).turn).toMatchObject({ hangmanId: alice, choices: ['APPLE', 'BANANA', 'CHERRY'], word: '', wrong: 0, out: [], points: {}, outcome: null });
    expect(s.effects.some((e) => e.type === 'side' && e.name === 'reset' && e.stamp === data(s).canvasId)).toBe(true);
    expect(s.effects.some((e) => e.type === 'send' && e.msg.t === 'clear')).toBe(true);
    expect(chatTexts(s.effects)).toContain('Alice is the hangman. Choosing a word…');
    expect(nextDeadline(s.data)).toBe(START + CHOOSE_MS);

    const mine = view(s, alice);
    expect(mine).toMatchObject({ phase: 'choosing', round: 1, totalRounds: 1, turn: 1, turnsInRound: 3, hangmanId: alice, guesserId: null, mask: '', wrong: 0, maxWrong: HANGMAN_MAX_WRONG, lives: HANGMAN_MAX_WRONG, section: null, endsAt: START + CHOOSE_MS, paused: false, outcome: null, points: {} });
    expect(mine.choices).toEqual(['APPLE', 'BANANA', 'CHERRY']);
    expect(mine.word).toBeUndefined();
    expect(mine.players).toEqual({ [alice]: { out: false, playing: true }, [bob]: { out: false, playing: true }, [carol]: { out: false, playing: true } });
    expect(view(s, bob).choices).toBeUndefined();
    expect(view(s).choices).toBeUndefined();
  });

  it('accepts one of the choices from the hangman only, and the word is secret while guessed', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(errorsOf(s.game(bob, { t: 'chooseWord', index: 0 }))).toEqual(['You are not choosing a word right now.']);
    expect(errorsOf(s.game(alice, { t: 'chooseWord', index: 5 }))).toEqual(['That is not one of your choices.']);
    const effects = s.game(alice, { t: 'chooseWord', index: 1 });
    expect(chatTexts(effects)).toEqual(['The word has 6 letters. Guess a letter or risk the whole word!']);
    expect(data(s).usedWords).toEqual(['BANANA']);
    expect(view(s, bob)).toMatchObject({ phase: 'guessing', mask: '______', guesserId: bob, endsAt: s.now + GUESS_MS, paused: false });
    expect(view(s, bob).word).toBeUndefined();
    expect(view(s).word).toBeUndefined();
    expect(view(s, alice).word).toBe('BANANA');
    expect(nextDeadline(s.data)).toBe(s.now + GUESS_MS);
    expect(errorsOf(s.game(alice, { t: 'chooseWord', index: 0 }))).toEqual(['You are not choosing a word right now.']);
  });

  it('takes a typed word or phrase, normalised, and rejects anything that is not 3-24 letters', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    for (const bad of ['ab', 'a'.repeat(25), '3d printer', 'café', '   ']) {
      const effects = s.game(alice, { t: 'customWord', text: bad });
      expect(effects).toEqual([{ type: 'send', to: [alice], msg: { t: 'error', code: 'INVALID_MESSAGE', message: 'A word or phrase has 3 to 24 letters: letters, spaces, hyphens and apostrophes only.' } }]);
      expect(view(s).phase).toBe('choosing');
    }
    s.game(alice, { t: 'customWord', text: "  ice-cream   o'clock " });
    expect(view(s, alice).word).toBe("ICE-CREAM O'CLOCK");
    expect(view(s, bob).mask).toBe("___-_____ _'_____");
    expect(data(s).usedWords).toEqual(["ICE-CREAM O'CLOCK"]);
  });

  it('takes a word typed with a smart apostrophe or dash, and matches a guess typed the same way', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(errorsOf(s.game(alice, { t: 'customWord', text: 'o\u2019clock' }))).toEqual([]);
    expect(view(s, alice).word).toBe("O'CLOCK");
    expect(view(s, bob).mask).toBe("_'_____");
    word(s, bob, 'O\u2019CLOCK');
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'solved', solverId: bob }, wrong: 0 });
    expect(view(s).players[bob]?.out).toBe(false);
    s.now += TURN_END_MS;
    s.tick();
    expect(errorsOf(s.game(bob, { t: 'customWord', text: 'ice\u2014cream' }))).toEqual([]);
    expect(view(s, bob).word).toBe('ICE-CREAM');
    word(s, alice, 'ice\u2013cream');
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'solved', solverId: alice } });
  });

  it('picks the first choice when the choose clock runs out', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.now += CHOOSE_MS;
    s.tick();
    expect(view(s, alice)).toMatchObject({ phase: 'guessing', word: 'APPLE', guesserId: bob, endsAt: s.now + GUESS_MS });
  });

  it('draws words from the content mode pool merged with the custom words, never repeating one while it can', () => {
    const s = sim('hangman', 'ABCD', START, () => 0.999);
    const [alice] = startGame(s, ['Alice', 'Bob'], { customWordsOnly: false, contentMode: 'unhinged' });
    const pool = hangmanWordPool('unhinged', TEST_WORDS, false);
    const first = data(s).turn?.choices ?? [];
    expect(first).toHaveLength(3);
    for (const w of first) expect(pool).toContain(w);
    expect(first.some((w) => !hangmanWordPool('family', TEST_WORDS, false).includes(w))).toBe(true);
    s.game(alice, { t: 'chooseWord', index: 0 });
    // The second turn (Bob's) offers three words that were not played yet.
    word(s, s.playerId('Bob'), first[0]);
    s.now += TURN_END_MS;
    s.tick();
    expect(view(s).phase).toBe('choosing');
    for (const w of data(s).turn?.choices ?? []) expect(w).not.toBe(first[0]);
  });
});

describe('Hangman: guessing', () => {
  it('rotates the guess in join order, reveals every occurrence of a right letter for 10 points each, and refuses out-of-turn or repeated guesses', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(view(s).guesserId).toBe(bob);
    expect(errorsOf(letter(s, carol, 'a'))).toEqual(['It is not your turn to guess.']);
    expect(errorsOf(letter(s, alice, 'a'))).toEqual(['It is not your turn to guess.']);
    const effects = letter(s, bob, 'p');
    expect(score(s, bob)).toBe(2 * HANGMAN_POINTS.letter);
    expect(chatTexts(effects)).toEqual(['P: 2 letters!']);
    expect(view(s)).toMatchObject({ mask: '_PP__', usedLetters: ['P'], wrongLetters: [], wrong: 0, guesserId: carol, points: { [bob]: 20 }, endsAt: s.now + GUESS_MS });
    expect(errorsOf(letter(s, carol, 'P'))).toEqual(['P was already guessed.']);
    expect(view(s).guesserId).toBe(carol);
    letter(s, carol, 'E');
    expect(score(s, carol)).toBe(HANGMAN_POINTS.letter);
    expect(view(s)).toMatchObject({ mask: '_PP_E', guesserId: bob });
  });

  it('passes the guess without penalty when the clock runs out; a whole lap without a guess costs a life, never the word', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.now += GUESS_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(['Bob ran out of time.']);
    expect(view(s)).toMatchObject({ guesserId: carol, wrong: 0, lives: HANGMAN_MAX_WRONG, endsAt: s.now + GUESS_MS });
    expect(score(s, alice)).toBe(0);
    // A guess resets the lap: Carol's timeout then Bob's make no lap either.
    letter(s, carol, 'q');
    drawDone(s, alice);
    expect(view(s).guesserId).toBe(bob);
    s.now += GUESS_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: carol, wrong: 1 });
    // Carol's timeout completes a lap (two guessers in a row): the hangman scores and draws, the guessers lose a life.
    s.now += GUESS_MS;
    const lap = s.tick();
    expect(chatTexts(lap)).toEqual(['Carol ran out of time.', 'Nobody guessed for a whole lap. That costs a life (2 of 10).']);
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 2, wrong: 2, lives: 8, outcome: null, endsAt: s.now + DRAW_MS });
    expect(score(s, alice)).toBe(2 * HANGMAN_POINTS.wrongGuess);
    expect(score(s, bob)).toBe(0);
    drawDone(s, alice);
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: bob, wrong: 2 });
    // A word that nobody ever guesses at ends with the figure, and the hangman wins it like any complete figure.
    for (let lives = 8; lives > 0; lives--) {
      s.now += 2 * GUESS_MS;
      s.tick();
      s.tick();
      expect(view(s)).toMatchObject({ phase: 'drawing', section: 11 - lives });
      drawDone(s, alice);
    }
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanWins' }, word: 'APPLE', wrong: HANGMAN_MAX_WRONG });
    expect(score(s, alice)).toBe(HANGMAN_MAX_WRONG * HANGMAN_POINTS.wrongGuess + HANGMAN_POINTS.hangmanWins);
  });

  it('goes on from the departed guesser in join order, not from the first guesser, when the guesser leaves', () => {
    const s = sim('hangman');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    letter(s, bob, 'a');
    expect(view(s).guesserId).toBe(carol);
    s.apply({ type: 'leave', playerId: carol });
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: dave, endsAt: s.now + GUESS_MS });
    letter(s, dave, 'p');
    expect(view(s).guesserId).toBe(bob);
    // The same when the departed guesser was the last in join order: the rotation wraps.
    s.now += GUESS_MS;
    s.tick();
    expect(view(s).guesserId).toBe(dave);
    s.apply({ type: 'leave', playerId: dave });
    expect(view(s).guesserId).toBe(bob);
  });

  it('a wrong letter scores 15 for the hangman and sends them to draw the next section, during which only they may draw', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    const effects = letter(s, bob, 'z');
    expect(chatTexts(effects)).toEqual(['Bob: Z is not in the word (1 of 10).']);
    expect(score(s, alice)).toBe(HANGMAN_POINTS.wrongGuess);
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 1, wrong: 1, lives: 9, wrongLetters: ['Z'], usedLetters: ['Z'], guesserId: null, endsAt: s.now + DRAW_MS, paused: false });
    expect(nextDeadline(s.data)).toBe(s.now + DRAW_MS);
    const game = data(s);
    expect(hangmanCanvasPolicy.stamp(game)).toBe(game.canvasId);
    expect(hangmanCanvasPolicy.segment?.(game)).toBe('section-1');
    expect(hangmanCanvasPolicy.check(game, alice, s.now)).toBe('ok');
    expect(hangmanCanvasPolicy.check(game, alice, s.now + DRAW_MS)).toBe('silent');
    expect(hangmanCanvasPolicy.check(game, bob, s.now)).toBe('forbidden');
    expect(hangmanCanvasPolicy.forbiddenMessage).toBe('Only the hangman can draw right now.');
    // Guesses wait for the drawing to end; only the hangman ends it early.
    expect(errorsOf(letter(s, carol, 'a'))).toEqual(['Nobody is guessing right now.']);
    expect(errorsOf(drawDone(s, carol))).toEqual(['You are not drawing right now.']);
    drawDone(s, alice);
    expect(view(s)).toMatchObject({ phase: 'guessing', section: null, guesserId: carol, endsAt: s.now + GUESS_MS });
    expect(hangmanCanvasPolicy.check(data(s), alice, s.now)).toBe('silent');
    expect(hangmanCanvasPolicy.segment?.(data(s))).toBe('');
    // The draw clock ends the step too, and sections are numbered by wrong guesses.
    letter(s, carol, 'x');
    expect(view(s).section).toBe(2);
    expect(hangmanCanvasPolicy.segment?.(data(s))).toBe('section-2');
    s.now += DRAW_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: bob, wrong: 2 });
  });

  it('naming the word solves it for 100 plus 10 per life and reveals it to everyone', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    wrongAndDraw(s, bob, alice, 'z');
    expect(errorsOf(word(s, carol, '   '))).toEqual(['Type the word you want to guess.']);
    const effects = word(s, carol, ' apple ');
    expect(chatTexts(effects)).toEqual(['Carol solved it! The word was APPLE.']);
    expect(effects.some((e) => e.type === 'send' && e.msg.t === 'chat' && (e.msg as { message: { kind: string } }).message.kind === 'correct')).toBe(true);
    expect(score(s, carol)).toBe(HANGMAN_POINTS.solveWord + 9 * HANGMAN_POINTS.perLife);
    expect(score(s, alice)).toBe(HANGMAN_POINTS.wrongGuess);
    expect(view(s, bob)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'solved', solverId: carol }, word: 'APPLE', mask: '_____', guesserId: null, points: { [carol]: 190, [alice]: 15 }, endsAt: s.now + TURN_END_MS });
    expect(view(s).word).toBe('APPLE');
    expect(nextDeadline(s.data)).toBe(s.now + TURN_END_MS);
  });

  it('revealing the last hidden letter solves it for the letters plus 50 and 10 per life', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    letter(s, bob, 'a');
    letter(s, carol, 'p');
    letter(s, bob, 'l');
    expect(view(s).mask).toBe('APPL_');
    letter(s, carol, 'e');
    expect(score(s, bob)).toBe(2 * HANGMAN_POINTS.letter);
    expect(score(s, carol)).toBe(3 * HANGMAN_POINTS.letter + HANGMAN_POINTS.solveLastLetter + HANGMAN_MAX_WRONG * HANGMAN_POINTS.perLife);
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'solved', solverId: carol }, word: 'APPLE', mask: 'APPLE' });
  });

  it('a wrong word counts as a wrong guess and puts that guesser out for the word; with nobody left in, the hangman wins it', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    const effects = word(s, bob, 'banana');
    expect(chatTexts(effects)).toEqual(['Bob guessed “BANANA”: wrong, and out for this word (1 of 10).']);
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 1, wrong: 1, wrongLetters: [] });
    expect(view(s).players[bob]).toEqual({ out: true, playing: true });
    expect(score(s, alice)).toBe(HANGMAN_POINTS.wrongGuess);
    drawDone(s, alice);
    // Bob is skipped for the rest of the word: Carol keeps the guess.
    expect(view(s).guesserId).toBe(carol);
    expect(errorsOf(letter(s, bob, 'a'))).toEqual(['It is not your turn to guess.']);
    letter(s, carol, 'q');
    drawDone(s, alice);
    expect(view(s).guesserId).toBe(carol);
    word(s, carol, 'cherry');
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 3 });
    const done = drawDone(s, alice);
    expect(chatTexts(done)).toEqual(['Nobody is left to guess. Alice wins! The word was APPLE.']);
    expect(score(s, alice)).toBe(3 * HANGMAN_POINTS.wrongGuess + HANGMAN_POINTS.hangmanWins);
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanWins' }, word: 'APPLE' });
  });

  it('ten wrong guesses complete the figure after section 10 is drawn: the hangman wins the word', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    const wrongs = ['z', 'x', 'q', 'w', 'k', 'j', 'v', 'b', 'm', 'n'];
    for (let i = 0; i < 9; i++) {
      wrongAndDraw(s, bob, alice, wrongs[i]);
      expect(view(s)).toMatchObject({ phase: 'guessing', wrong: i + 1, lives: 9 - i, guesserId: bob });
    }
    letter(s, bob, wrongs[9]);
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 10, wrong: 10, lives: 0 });
    expect(s.data.phase).toBe('playing');
    const done = drawDone(s, alice);
    expect(chatTexts(done)).toEqual(['The figure is complete. Alice wins! The word was APPLE.']);
    expect(score(s, alice)).toBe(10 * HANGMAN_POINTS.wrongGuess + HANGMAN_POINTS.hangmanWins);
    expect(score(s, bob)).toBe(0);
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanWins' }, wrongLetters: wrongs.map((w) => w.toUpperCase()) });
  });
});

describe('Hangman: turns, rounds and the podium', () => {
  it('runs every participant as the hangman once per round in join order, then ends on the podium', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 2 });
    const turns: Array<[string, string]> = [];
    for (let i = 0; i < 4; i++) {
      const hangmanId = view(s).hangmanId;
      const guesser = hangmanId === alice ? bob : alice;
      turns.push([hangmanId, `${view(s).round}/${view(s).turn}`]);
      s.game(hangmanId, { t: 'chooseWord', index: 0 });
      word(s, guesser, view(s, hangmanId).word ?? '');
      expect(view(s).phase).toBe('turnEnd');
      s.now += TURN_END_MS;
      s.tick();
    }
    expect(turns).toEqual([[alice, '1/1'], [bob, '1/2'], [alice, '2/1'], [bob, '2/2']]);
    expect(data(s).usedWords).toEqual(['APPLE', 'BANANA', 'CHERRY', 'DRAGON']);
    expect(s.data.phase).toBe('ended');
    expect(view(s).phase).toBe('gameOver');
    expect(nextDeadline(s.data)).toBeNull();
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 400, rank: 1 },
      { playerId: bob, score: 400, rank: 1 },
    ]);
    expect(chatTexts(s.effects).at(-1)).toMatch(/^Game over!/);
    expect(errorsOf(letter(s, bob, 'a'))).toEqual(['The game is not running.']);
  });

  it('seats late joiners as watchers until the next round, when they join the rotation', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 2 });
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    expect(view(s).players[dave]).toEqual({ out: false, playing: false });
    expect(view(s, dave).word).toBeUndefined();
    expect(view(s)).toMatchObject({ guesserId: bob, turnsInRound: 2 });
    expect(errorsOf(letter(s, dave, 'a'))).toEqual(['It is not your turn to guess.']);
    s.now += GUESS_MS;
    s.tick();
    // Only Bob is in the rotation: his timeout alone is a whole idle lap, and the guess is his again after it.
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 1 });
    drawDone(s, alice);
    expect(view(s).guesserId).toBe(bob);
    word(s, bob, 'apple');
    s.now += TURN_END_MS;
    s.tick();
    expect(view(s)).toMatchObject({ hangmanId: bob, round: 1, turn: 2, turnsInRound: 2 });
    expect(view(s).players[dave]?.playing).toBe(false);
    s.game(bob, { t: 'chooseWord', index: 0 });
    expect(view(s).guesserId).toBe(alice);
    word(s, alice, 'banana');
    s.now += TURN_END_MS;
    s.tick();
    expect(view(s)).toMatchObject({ hangmanId: alice, round: 2, turn: 1, turnsInRound: 3 });
    expect(data(s).roundPlayerIds).toEqual([alice, bob, dave]);
    expect(view(s).players[dave]).toEqual({ out: false, playing: true });
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(view(s).guesserId).toBe(bob);
    s.now += GUESS_MS;
    s.tick();
    expect(view(s).guesserId).toBe(dave);
  });

  it('keeps sitting-out players as spectators: they see no secrets and never guess', () => {
    const s = sim('hangman');
    s.apply({ type: 'create', gameId: 'hangman', name: 'Alice', avatar: AVATAR, connectionId: 'a' });
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const [alice, bob, carol] = ['Alice', 'Bob', 'Carol'].map((n) => s.playerId(n));
    s.platform(alice, { t: 'updateSettings', settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1 } });
    s.platform(carol, { t: 'sitOut', sitOut: true });
    s.platform(bob, { t: 'ready', ready: true });
    s.platform(alice, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    expect(data(s).roundPlayerIds).toEqual([alice, bob]);
    expect(view(s).players[carol]).toBeUndefined();
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(view(s, carol).word).toBeUndefined();
    expect(view(s, carol).mask).toBe('_____');
    expect(errorsOf(letter(s, carol, 'a'))).toEqual(['You are sitting this game out.']);
    expect(view(s).guesserId).toBe(bob);
    // A spectator's socket is none of the turn's business.
    disconnect(s, carol, 'c');
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: bob, paused: false });
    expect(waiting(s)).toBeNull();
  });

  it('holds the turn boundary while fewer than two are connected and goes on after the settle', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    word(s, bob, 'apple');
    disconnect(s, bob, 'Bob');
    s.now += TURN_END_MS;
    const held = s.tick();
    expect(chatTexts(held)).toEqual(['Waiting for Bob to reconnect…']);
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: null });
    expect(waiting(s)).toEqual([bob]);
    expect(view(s)).toMatchObject({ phase: 'turnEnd', endsAt: null, paused: false });
    // Only the seat expiry is pending: the game itself has no deadline while it holds.
    expect(hangmanModule.nextDeadline(data(s))).toBeNull();
    s.now += 60_000;
    expect(s.tick()).toEqual([]);
    reconnect(s, bob, 'Bob');
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    expect(nextDeadline(s.data)).toBe(s.now + RESUME_SETTLE_MS);
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: bob });
  });

  it('resumes a held boundary when the hangman of the turn that just ended reconnects', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 2 });
    s.game(alice, { t: 'chooseWord', index: 0 });
    word(s, bob, 'apple');
    disconnect(s, alice, 'Alice');
    s.now += TURN_END_MS;
    const held = s.tick();
    expect(chatTexts(held)).toEqual(['Waiting for Alice to reconnect…']);
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: null });
    expect(waiting(s)).toEqual([alice]);
    const back = reconnect(s, alice, 'Alice');
    expect(waits(back).at(-1)).toBeNull();
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    expect(nextDeadline(s.data)).toBe(s.now + RESUME_SETTLE_MS);
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: bob, round: 1, turn: 2 });

    // The hold also waits for the hangman who was away for the whole solve and refreshes on the first of several returns.
    s.game(bob, { t: 'chooseWord', index: 0 });
    disconnect(s, bob, 'Bob-2');
    s.apply({ type: 'rejoin', token: token(s, bob), connectionId: 'conn-Bob-3' });
    disconnect(s, bob, 'Bob-3');
    s.apply({ type: 'rejoin', token: token(s, bob), connectionId: 'conn-Bob-4' });
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: alice });
    word(s, alice, view(s, bob).word ?? '');
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob-4' });
    s.now += TURN_END_MS;
    s.tick();
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: null });
    s.apply({ type: 'rejoin', token: token(s, bob), connectionId: 'conn-Bob-5' });
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: alice, round: 2, turn: 1 });
  });

  it('holds for a participant in reconnect grace even when a late-joining watcher is connected', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    word(s, bob, 'apple');
    disconnect(s, bob, 'Bob');
    s.now += TURN_END_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(['Waiting for Bob to reconnect…']);
    expect(chatTexts(effects)).not.toContain('Bob is away. Skipping their turn.');
    expect(s.data.phase).toBe('playing');
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: null });
    expect(waiting(s)).toEqual([bob]);
    // Dave's socket is none of the hold's business.
    s.apply({ type: 'connectionClosed', playerId: dave, connectionId: 'd' });
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: null });
    reconnect(s, bob, 'Bob');
    expect(data(s).phase).toMatchObject({ kind: 'turnEnd', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: bob, turn: 2, turnsInRound: 2 });
    // The round over, the next one seats the watcher too: with Bob gone for good, Alice and Dave carry on.
    s.game(bob, { t: 'chooseWord', index: 0 });
    s.apply({ type: 'rejoin', token: token(s, dave), connectionId: 'd2' });
    s.apply({ type: 'leave', playerId: bob });
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanLeft' } });
    s.now += TURN_END_MS;
    s.tick();
    expect(s.data.phase).toBe('ended');
  });

  it('skips a hangman whose socket is down when their turn comes and queues them again on return', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    disconnect(s, bob, 'Bob');
    word(s, carol, 'apple');
    s.now += TURN_END_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toContain('Bob is away. Skipping their turn.');
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: carol, turn: 2, turnsInRound: 2 });
    reconnect(s, bob, 'Bob');
    expect(data(s).turnQueue).toEqual([alice, carol, bob]);
    expect(view(s).turnsInRound).toBe(3);
  });
});

describe('Hangman: disconnects and leaves', () => {
  it('pauses the choose clock while the hangman is away and resumes it where it stopped', () => {
    const s = sim('hangman');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.now += 10_000;
    const effects = disconnect(s, alice, 'Alice');
    expect(chatTexts(effects)).toContain('Waiting for Alice to reconnect…');
    expect(waits(effects).at(-1)).toEqual([alice]);
    expect(data(s).phase).toEqual({ kind: 'choosing', clock: { kind: 'paused', remainingMs: CHOOSE_MS - 10_000 } });
    expect(view(s, bob)).toMatchObject({ phase: 'choosing', paused: true, endsAt: null });
    expect(hangmanModule.nextDeadline(data(s))).toBeNull();
    s.now += 5 * 60_000;
    expect(s.tick()).toEqual([]);
    expect(view(s).phase).toBe('choosing');
    reconnect(s, alice, 'Alice');
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'choosing', paused: false, endsAt: s.now + CHOOSE_MS - 10_000 });
    s.now += CHOOSE_MS - 10_000;
    s.tick();
    expect(view(s, alice)).toMatchObject({ phase: 'guessing', word: 'APPLE' });
  });

  it('pauses a drawing step while the hangman is away, including one that starts while they are away', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    letter(s, bob, 'z');
    s.now += 5_000;
    disconnect(s, alice, 'Alice');
    expect(data(s).phase).toEqual({ kind: 'drawing', section: 1, clock: { kind: 'paused', remainingMs: DRAW_MS - 5_000 } });
    expect(hangmanCanvasPolicy.check(data(s), alice, s.now)).toBe('silent');
    expect(waiting(s)).toEqual([alice]);
    expect(hangmanModule.nextDeadline(data(s))).toBeNull();
    reconnect(s, alice, 'Alice');
    expect(view(s)).toMatchObject({ phase: 'drawing', paused: false, endsAt: s.now + DRAW_MS - 5_000 });
    expect(hangmanCanvasPolicy.check(data(s), alice, s.now)).toBe('ok');
    drawDone(s, alice);
    // Guessing goes on without the hangman; the next wrong guess opens a paused drawing step.
    s.apply({ type: 'connectionClosed', playerId: alice, connectionId: 'conn-Alice-2' });
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: carol, paused: false });
    expect(waiting(s)).toBeNull();
    letter(s, carol, 'x');
    expect(data(s).phase).toEqual({ kind: 'drawing', section: 2, clock: { kind: 'paused', remainingMs: DRAW_MS } });
    expect(waiting(s)).toEqual([alice]);
    reconnect(s, alice, 'Alice');
    expect(view(s)).toMatchObject({ phase: 'drawing', section: 2, endsAt: s.now + DRAW_MS });
  });

  it('reveals the word with no points and moves on when the hangman leaves for good', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    letter(s, bob, 'p');
    letter(s, carol, 'z');
    disconnect(s, alice, 'Alice');
    s.now += RECONNECT_GRACE_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(['Alice left', 'The hangman left. The word was APPLE.']);
    expect(waits(effects).at(-1)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanLeft' }, word: 'APPLE', points: { [bob]: 20, [alice]: 15 } });
    expect(score(s, bob)).toBe(20);
    s.now += TURN_END_MS;
    s.tick();
    // Alice's turn stays in the count: this is turn 2 of 4.
    expect(view(s)).toMatchObject({ phase: 'choosing', hangmanId: bob, turn: 2, turnsInRound: 4 });
    // Leaving before choosing reveals nothing.
    s.apply({ type: 'leave', playerId: bob });
    expect(chatTexts(s.effects).at(-1)).toBe('The hangman left before choosing a word.');
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanLeft' } });
    expect(view(s).word).toBeUndefined();
  });

  it('skips a guesser whose socket drops, pauses when no guesser is connected and resumes on the first one back', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(view(s).guesserId).toBe(bob);
    disconnect(s, bob, 'Bob');
    expect(view(s)).toMatchObject({ guesserId: carol, paused: false, endsAt: s.now + GUESS_MS });
    expect(waiting(s)).toBeNull();
    const effects = disconnect(s, carol, 'Carol');
    expect(chatTexts(effects)).toEqual(['Waiting for Bob, Carol to reconnect…']);
    expect(data(s).phase).toMatchObject({ kind: 'guessing', clock: { kind: 'paused' } });
    expect(view(s)).toMatchObject({ phase: 'guessing', guesserId: null, paused: true, endsAt: null });
    expect(waiting(s)).toEqual([bob, carol]);
    expect(hangmanModule.nextDeadline(data(s))).toBeNull();
    expect(errorsOf(letter(s, alice, 'a'))).toEqual(['It is not your turn to guess.']);
    s.now += 30_000;
    reconnect(s, carol, 'Carol');
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ guesserId: carol, paused: false, endsAt: s.now + GUESS_MS });
    // A leaving guesser who held the guess hands it on.
    reconnect(s, bob, 'Bob');
    s.apply({ type: 'leave', playerId: carol });
    expect(view(s)).toMatchObject({ guesserId: bob, endsAt: s.now + GUESS_MS });
    expect(data(s).turnQueue).toEqual([alice, bob]);
  });

  it('scores nobody when every guesser left before a single guess, and keeps the hangman the word once it was contested', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { rounds: 2 });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    s.apply({ type: 'leave', playerId: bob });
    expect(view(s).phase).toBe('choosing');
    // The last guesser of the round leaves while the word is being chosen: no word is chosen for nobody.
    const left = s.apply({ type: 'leave', playerId: carol });
    expect(chatTexts(left)).toContain('Nobody was left to guess.');
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'noGuessers' }, points: {} });
    expect(view(s).word).toBeUndefined();
    expect(score(s, alice)).toBe(0);
    s.now += TURN_END_MS;
    s.tick();
    // Round 2 seats Dave: Alice is the hangman, Dave the only guesser.
    expect(view(s)).toMatchObject({ phase: 'choosing', round: 2, hangmanId: alice });
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(view(s).guesserId).toBe(dave);
    // Nobody left to guess during guessing, before any guess: the word is revealed, nobody scores.
    s.apply({ type: 'join', name: 'Eve', avatar: AVATAR, connectionId: 'e' });
    const eve = s.playerId('Eve');
    const gone = s.apply({ type: 'leave', playerId: dave });
    expect(chatTexts(gone)).toContain('Nobody was left to guess. The word was APPLE.');
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'noGuessers' }, word: 'APPLE' });
    expect(score(s, alice)).toBe(0);
    s.now += TURN_END_MS;
    s.tick();
    expect(s.data.phase).toBe('ended');
    expect(eve).toBeTruthy();
  });

  it('gives the hangman the word when the last guesser still in leaves', () => {
    const s = sim('hangman');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    word(s, bob, 'banana');
    drawDone(s, alice);
    expect(view(s).guesserId).toBe(carol);
    s.apply({ type: 'leave', playerId: carol });
    expect(view(s)).toMatchObject({ phase: 'turnEnd', outcome: { kind: 'hangmanWins' } });
    expect(score(s, alice)).toBe(HANGMAN_POINTS.wrongGuess + HANGMAN_POINTS.hangmanWins);
  });
});

describe('Hangman: module purity', () => {
  it('returns the same object when nothing changed and never mutates its input', () => {
    const s = sim('hangman');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    const game = data(s);
    const ctx = {
      now: s.now,
      rng: () => 0,
      newId: () => 'x',
      settings: { ...defaultPlatformSettings(gameById('hangman')), ...hangmanModule.settings.defaults },
      players: s.data.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: true, score: 0 })),
      spectators: [],
      hostId: alice,
    };
    expect(hangmanModule.handle(ctx, game, { type: 'tick' }).data).toBe(game);
    expect(hangmanModule.handle(ctx, game, { type: 'chat', playerId: alice, text: 'apple' }).data).toBe(game);
    expect(hangmanModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'undo' } }).data).toBe(game);
    const chosen = hangmanModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    expect(chosen.data).not.toBe(game);
    expect(game.turn?.word).toBe('');
    expect(JSON.parse(JSON.stringify(chosen.data))).toEqual(chosen.data);
  });
});

describe('Hangman: settings', () => {
  it('normalises custom words and only honours customWordsOnly with at least ten of them', () => {
    const normalize = hangmanModule.settings.normalize;
    if (!normalize) throw new Error('no normalize');
    const base = hangmanModule.settings.defaults;
    expect(normalize({ ...base, customWords: ['cat, dog', ' hot   dog ', 'Cat'], customWordsOnly: true })).toMatchObject({ customWords: ['cat', 'dog', 'hot dog'], customWordsOnly: false });
    expect(normalize({ ...base, customWords: TEST_WORDS, customWordsOnly: true })).toMatchObject({ customWords: TEST_WORDS, customWordsOnly: true });
    expect(hangmanModule.settings.patchSchema.safeParse({ rounds: 6 }).success).toBe(false);
    expect(hangmanModule.settings.patchSchema.safeParse({ guessSeconds: 10, drawSeconds: 60 }).success).toBe(true);
  });
});
