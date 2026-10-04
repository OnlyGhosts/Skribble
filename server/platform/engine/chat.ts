/** Chat: the running game sees every line first (a guess, say) and may consume it. */
import { runGame } from './delegate.js';
import { pushChat, type Cx } from './messaging.js';
import { findPlayer } from './players.js';

export function chat(cx: Cx, playerId: string, text: string): void {
  const player = findPlayer(cx.data, playerId);
  if (!player) return;
  const mark = cx.effects.length;
  const handled = runGame(cx, { type: 'chat', playerId, text });
  if (handled) return;
  // The line itself precedes the game's reaction to it (a "close!" nudge, for instance).
  const reactions = cx.effects.splice(mark);
  pushChat(cx, 'chat', text, 'all', { id: player.id, name: player.name });
  cx.effects.push(...reactions);
}
