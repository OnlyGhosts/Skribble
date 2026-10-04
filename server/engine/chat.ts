/** Chat and guessing: who sees what, scoring a correct guess, close-guess hints. */
import { containsWord, isCloseGuess, isCorrectGuess } from '../../shared/guess';
import { guesserPoints } from '../../shared/scoring';
import { broadcastSnapshot, pushChat, sendPrivate, type Cx } from './messaging';
import { everyoneGuessed, findPlayer } from './players';
import type { PlayerData } from './state';
import { endTurn } from './turns';

export function chat(cx: Cx, playerId: string, text: string): void {
  const { data } = cx;
  const player = findPlayer(data, playerId);
  if (!player) return;
  const turn = data.turn;
  if (!turn || (data.phase.kind !== 'drawing' && data.phase.kind !== 'choosing')) {
    pushChat(cx, 'chat', text, player);
    return;
  }
  if (player.id === turn.drawerId) {
    // While choosing, the drawer already knows every candidate: none of them may reach the guessers.
    const secrets = data.phase.kind === 'choosing' ? turn.choices : [turn.word];
    if (secrets.some((w) => containsWord(text, w))) {
      return sendPrivate(cx, playerId, 'system', "You can't give away the word!");
    }
    return pushChat(cx, 'guessed', text, player, guessedRecipients(cx));
  }
  if (data.phase.kind === 'choosing') {
    pushChat(cx, 'chat', text, player);
    return;
  }
  if (player.guessedThisTurn) {
    return pushChat(cx, 'guessed', text, player, guessedRecipients(cx));
  }
  if (isCorrectGuess(text, turn.word)) {
    const remaining = Math.max(0, turn.endsAt - cx.now);
    const pts = guesserPoints(remaining, data.settings.drawTime * 1000);
    player.guessedThisTurn = true;
    player.score += pts;
    player.turnPoints += pts;
    turn.correct += 1;
    if (!turn.guesserIds.includes(player.id)) turn.guesserIds.push(player.id);
    pushChat(cx, 'correct', `${player.name} guessed the word!`, player);
    if (everyoneGuessed(data)) return endTurn(cx, 'allGuessed');
    broadcastSnapshot(cx);
    return;
  }
  pushChat(cx, 'chat', text, player);
  if (isCloseGuess(text, turn.word)) sendPrivate(cx, playerId, 'close', `'${text}' is close!`);
}

/** The drawer and everyone who already solved the word. */
function guessedRecipients(cx: Cx): PlayerData[] {
  return cx.data.players.filter((p) => p.connected && p.guessedThisTurn);
}
