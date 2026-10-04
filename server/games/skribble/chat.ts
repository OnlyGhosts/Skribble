/** Chat and guessing: who sees what, scoring a correct guess, close-guess hints. */
import { containsWord, isCloseGuess, isCorrectGuess } from '../../../shared/games/skribble/guess.js';
import { guesserPoints } from '../../../shared/games/skribble/scoring.js';
import { everyoneGuessed, findPlayer } from './state.js';
import { endTurn, snapshot, type Gx } from './turns.js';

/** Returns true when the line was consumed (the platform must not broadcast it as plain chat). */
export function chat(gx: Gx, playerId: string, text: string): boolean {
  const { data, ctx } = gx;
  const player = findPlayer(ctx, playerId);
  if (!player) return false;
  const turn = data.turn;
  if (!turn || (data.phase.kind !== 'drawing' && data.phase.kind !== 'choosing')) return false;
  if (player.id === turn.drawerId) {
    // While choosing, the drawer already knows every candidate: none of them may reach the guessers.
    const secrets = data.phase.kind === 'choosing' ? turn.choices : [turn.word];
    if (secrets.some((w) => containsWord(text, w))) {
      gx.effects.push({ type: 'chat', to: [playerId], kind: 'system', text: "You can't give away the word!" });
      return true;
    }
    gx.effects.push({ type: 'chat', to: guessedRecipients(gx), kind: 'guessed', text, playerId, name: player.name });
    return true;
  }
  if (data.phase.kind === 'choosing') return false;
  if (turn.guessed.includes(player.id)) {
    gx.effects.push({ type: 'chat', to: guessedRecipients(gx), kind: 'guessed', text, playerId, name: player.name });
    return true;
  }
  if (isCorrectGuess(text, turn.word)) {
    const remaining = Math.max(0, turn.endsAt - ctx.now);
    const pts = guesserPoints(remaining, ctx.settings.drawTime * 1000);
    turn.guessed.push(player.id);
    turn.points[player.id] = (turn.points[player.id] ?? 0) + pts;
    turn.correct += 1;
    if (!turn.guesserIds.includes(player.id)) turn.guesserIds.push(player.id);
    gx.effects.push({ type: 'score', playerId: player.id, delta: pts });
    gx.effects.push({ type: 'chat', to: 'all', kind: 'correct', text: `${player.name} guessed the word!`, playerId, name: player.name });
    if (everyoneGuessed(ctx, data)) endTurn(gx, 'allGuessed');
    else snapshot(gx);
    return true;
  }
  if (isCloseGuess(text, turn.word)) gx.effects.push({ type: 'chat', to: [playerId], kind: 'close', text: `'${text}' is close!` });
  return false;
}

/** The drawer and everyone who already solved the word. */
function guessedRecipients(gx: Gx): string[] {
  const guessed = gx.data.turn?.guessed ?? [];
  return gx.ctx.players.filter((p) => p.connected && guessed.includes(p.id)).map((p) => p.id);
}
