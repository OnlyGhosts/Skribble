/** Letter and word guesses: who may guess, what they score, and when a wrong one sends the hangman to the canvas. */
import { HANGMAN_MAX_WRONG, HANGMAN_POINTS } from '../../../shared/games/hangman/protocol.js';
import { countLetter, isFullyRevealed, normalizeHangmanWord } from '../../../shared/games/hangman/words.js';
import { award, fail, nameOf, type Gx, type TurnData } from './state.js';
import { endTurn, nextGuesser, startDrawing } from './turns.js';

/** The turn, if `playerId` holds the guess right now; otherwise an error for them. */
function myGuess(gx: Gx, playerId: string): TurnData | null {
  const { data } = gx;
  if (data.phase.kind !== 'guessing' || !data.turn || data.turn.word === '') {
    fail(gx, playerId, 'Nobody is guessing right now.');
    return null;
  }
  if (data.turn.guesserId !== playerId) {
    fail(gx, playerId, 'It is not your turn to guess.');
    return null;
  }
  data.turn.idleTimeouts = 0;
  return data.turn;
}

/** Lives left: the wrong guesses still allowed before the figure is complete. */
function livesLeft(turn: TurnData): number {
  return HANGMAN_MAX_WRONG - turn.wrong;
}

export function guessLetter(gx: Gx, playerId: string, raw: string): void {
  const turn = myGuess(gx, playerId);
  if (!turn) return;
  const letter = raw.toUpperCase();
  if (turn.usedLetters.includes(letter)) return fail(gx, playerId, `${letter} was already guessed.`);
  turn.usedLetters.push(letter);
  const found = countLetter(turn.word, letter);
  if (found === 0) {
    turn.wrongLetters.push(letter);
    gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${nameOf(gx.ctx, playerId)}: ${letter} — not in the word (${turn.wrong + 1} of ${HANGMAN_MAX_WRONG}).` });
    return startDrawing(gx);
  }
  award(gx, playerId, found * HANGMAN_POINTS.letter);
  gx.effects.push({ type: 'chat', to: 'all', kind: 'guessed', playerId, text: `${letter} — ${found === 1 ? 'one letter' : `${found} letters`}!` });
  if (isFullyRevealed(turn.word, turn.usedLetters)) {
    // The last letter: a solve bonus on top of the letters themselves.
    award(gx, playerId, HANGMAN_POINTS.solveLastLetter + HANGMAN_POINTS.perLife * livesLeft(turn));
    return endTurn(gx, { kind: 'solved', solverId: playerId });
  }
  nextGuesser(gx);
}

export function guessWord(gx: Gx, playerId: string, text: string): void {
  const turn = myGuess(gx, playerId);
  if (!turn) return;
  const word = normalizeHangmanWord(text);
  if (word === '') {
    gx.effects.push({ type: 'error', playerId, code: 'INVALID_MESSAGE', message: 'Type the word you want to guess.' });
    return;
  }
  if (word === turn.word) {
    award(gx, playerId, HANGMAN_POINTS.solveWord + HANGMAN_POINTS.perLife * livesLeft(turn));
    return endTurn(gx, { kind: 'solved', solverId: playerId });
  }
  // A wrong word costs a life like a wrong letter, and the guesser sits the rest of this word out.
  turn.out.push(playerId);
  gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${nameOf(gx.ctx, playerId)} guessed “${word}” — wrong, and out for this word (${turn.wrong + 1} of ${HANGMAN_MAX_WRONG}).` });
  startDrawing(gx);
}
