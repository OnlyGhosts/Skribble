/**
 * Every live game started by a full room of 50 (the room limit): each one seats as many as it
 * takes (everyone, or Poker's 23 with the rest watching), deals every seat in and gives every
 * player, seated or watching, a view.
 */
import { describe, expect, it } from 'vitest';
import { GAME_LIST, type GameId } from '../../shared/platform/games.js';
import { ROOM_HARD_CAP, seatLimit } from '../../shared/platform/settings.js';
import { sim, startGame, type Sim } from '../platform/engine/testHarness.js';
import { viewFor } from '../platform/engine/view.js';
import type { BlackjackData } from './blackjack/module.js';
import type { PokerView } from '../../shared/games/poker/protocol.js';
import { moduleFor } from '../platform/engine/module.js';
import type { PokerData } from './poker/module.js';
import type { QuipgameData } from './quipgame/module.js';
import type { SkribbleData } from './skribble/state.js';
import type { SpygameData } from './spygame/module.js';

type LiveGameId = Exclude<GameId, 'template'>;

/** The players each game dealt into its first round or hand, read from its own state. */
const DEALT_IN: Record<LiveGameId, (game: unknown) => string[]> = {
  skribble: (g) => (g as SkribbleData).turnQueue,
  spygame: (g) => (g as SpygameData).current.playerIds,
  quipgame: (g) => (g as QuipgameData).roundPlayers,
  blackjack: (g) => Object.keys((g as BlackjackData).seats),
  poker: (g) => (g as PokerData).order,
};

const names = Array.from({ length: ROOM_HARD_CAP }, (_, i) => `P${i}`);
const live = GAME_LIST.filter((g) => g.status === 'live');

function dealtIn(s: Sim, id: LiveGameId): string[] {
  return DEALT_IN[id](s.data.game);
}

describe('a full room of 50', () => {
  it('covers every live game', () => {
    expect(live.map((g) => g.id).sort()).toEqual(Object.keys(DEALT_IN).sort());
  });

  for (const meta of live) {
    const id = meta.id as LiveGameId;
    it(`starts ${meta.name} with ${Math.min(seatLimit(meta), ROOM_HARD_CAP)} seated and the rest watching`, () => {
      const s = sim(id);
      const ids = startGame(s, names);
      expect(s.data.players).toHaveLength(ROOM_HARD_CAP);
      expect(s.data.phase).toBe('playing');
      const seats = Math.min(seatLimit(meta), ROOM_HARD_CAP);
      const seated = ids.slice(0, seats);
      // A game that queues its own seats (Poker) keeps everyone in it, the extras waiting for a seat.
      const players = moduleFor(id).queuesSeats ? ids : seated;
      expect(s.data.players.filter((p) => p.participating).map((p) => p.id)).toEqual(players);
      expect([...dealtIn(s, id)].sort()).toEqual([...seated].sort());
      for (const viewer of ids) expect(viewFor(s.data, viewer, s.now).game, viewer).not.toBeNull();
      // The first deadline passes without a hitch and nobody is dropped from the game.
      s.tick();
      expect(s.data.phase).toBe('playing');
      expect(s.data.players.filter((p) => p.participating)).toHaveLength(players.length);
    });
  }

  it('seats 23 at Poker and has the other 27 watch, waiting for a seat', () => {
    const s = sim('poker');
    const ids = startGame(s, names);
    expect((s.data.game as PokerData).order).toEqual(ids.slice(0, 23));
    const waiting = ids.slice(23).filter((viewer) => (viewFor(s.data, viewer, s.now).game as PokerView).players[viewer]?.waitingForSeat);
    expect(waiting).toHaveLength(27);
  });
});
