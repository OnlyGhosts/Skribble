/**
 * Blackjack's client module: the table screen, the settings rows, the player-list badges, the chat
 * placeholder and what reacts to snapshots: the table's animation timeline (planned in the store
 * from each snapshot) and the cues. Snapshots carry everything, so there are no server messages.
 */
import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { CardsIcon, OutIcon, StarIcon } from './components/Icons';
import { cancelCue, cueAt } from '../../platform/table/cues';
import { createEntryFlag } from '../../platform/table/entry';
import { isActing, isInRound, prefersReducedMotion, seatOf } from './hooks';
import { outcomesAt } from './lib/timeline';
import { chatPlaceholderFor, formatChips } from './lib/text';
import { BlackjackScreen } from './Screen';
import { BlackjackSettingsFields } from './SettingsFields';
import { useBlackjackStore } from './store';
import './blackjack.css';

/** A welcome (a join or a reconnect) shows the table at once. */
const entry = createEntryFlag();

const meta = gameById('blackjack');

export const blackjackClient = defineGameClient<BlackjackView, BlackjackSettings>({
  meta,
  Screen: BlackjackScreen,
  SettingsFields: BlackjackSettingsFields,

  playerBadge(room, player) {
    const view = room.game;
    const seat = seatOf(view, player.id);
    if (!view || !seat) return null;
    if (seat.bustedOut) {
      return (
        <span className="player__badge player__badge--out" title="Out of chips" aria-label="Out of chips">
          <OutIcon size={11} />
        </span>
      );
    }
    if (isActing(view, player.id)) {
      return (
        <span className="player__badge player__badge--acting" title="Playing their hand" aria-label="Playing their hand">
          <CardsIcon size={11} />
        </span>
      );
    }
    if (seat.hands.some((h) => h.status === 'blackjack')) {
      return (
        <span className="player__badge player__badge--natural" title="Blackjack" aria-label="Blackjack">
          <StarIcon size={11} />
        </span>
      );
    }
    return null;
  },

  playerMeta(room, player) {
    const seat = seatOf(room.game, player.id);
    if (!seat) return null;
    if (seat.bustedOut) return <span className="player__turn-points bj-player__out">out</span>;
    return seat.bet > 0 ? <span className="player__turn-points">{`bet ${formatChips(seat.bet)}`}</span> : null;
  },

  playerClassName(room, player) {
    const view = room.game;
    if (isActing(view, player.id)) return 'player--acting';
    return seatOf(view, player.id)?.bustedOut ? 'player--out' : undefined;
  },

  chatPlaceholder(room, meId) {
    return chatPlaceholderFor(room.game?.phase, isInRound(room.game, meId));
  },

  onWelcome() {
    entry.mark();
  },

  onRoom(room, prev) {
    const fresh = entry.take() || !prev?.game;
    const store = useBlackjackStore.getState();
    if (room.phase === 'lobby' || !room.game) {
      cancelCue();
      if (room.phase === 'lobby') store.reset();
      return;
    }
    const view = room.game;
    const before = store.timeline;
    const timeline = store.applyView(view, Date.now(), fresh, !prefersReducedMotion());
    if (fresh || !prev?.game) return;
    const me = usePlatformStore.getState().playerId;
    if (me === null) return;
    if (isActing(view, me) && !isActing(prev.game, me)) {
      playCue('yourTurn');
      vibrate(40);
    }
    // My round's outcome sounds once the reveal has shown it.
    const table = useBlackjackStore.getState().table;
    const mine = table?.settled ? table.hands[me] : undefined;
    const at = outcomesAt(timeline);
    if (mine && mine.length > 0 && at !== null && at !== outcomesAt(before)) {
      const net = mine.reduce((sum, h) => sum + (h.payout ?? 0) - h.bet, 0);
      if (net !== 0) cueAt(at, () => playCue(net > 0 ? 'correct' : 'turnEnd'));
    }
  },

  onLeave() {
    cancelCue();
    useBlackjackStore.getState().reset();
  },
});
