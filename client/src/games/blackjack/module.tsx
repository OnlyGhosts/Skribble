/**
 * Blackjack's client module: the table screen, the settings rows, the player-list badges and what
 * reacts to snapshots: the table's animation timeline (planned in the store from each snapshot)
 * and the cues. Snapshots carry everything, so there are no server messages.
 */
import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { CHIP_ICON } from '../../platform/components/PlayerChips';
import { defineGameClient } from '../../platform/game';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { CardsIcon, OutIcon, StarIcon } from './components/Icons';
import { createEntryFlag } from '../../platform/table/entry';
import { isActing, prefersReducedMotion, seatOf } from './hooks';
import { formatChips } from './lib/text';
import { BlackjackScreen } from './Screen';
import { BlackjackSettingsFields } from './SettingsFields';
import { clearBlackjackSounds, playBlackjackSounds } from './sfx';
import { blackjackSounds } from './sounds';
import { useBlackjackStore } from './store';
import './blackjack.css';

/** A welcome (a join or a reconnect) shows the table at once. */
const entry = createEntryFlag();

const meta = gameById('blackjack');

export const blackjackClient = defineGameClient<BlackjackView, BlackjackSettings>({
  meta,
  Screen: BlackjackScreen,
  SettingsFields: BlackjackSettingsFields,
  sounds: blackjackSounds,

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

  playerStatus(room, player) {
    const view = room.game;
    const seat = seatOf(view, player.id);
    if (!view || !seat) return null;
    if (seat.bustedOut) return { label: 'Out', icon: <OutIcon {...CHIP_ICON} />, tone: 'out' };
    if (isActing(view, player.id)) return { label: 'Playing', icon: <CardsIcon {...CHIP_ICON} />, tone: 'active' };
    if (seat.hands.some((h) => h.status === 'blackjack')) return { label: 'Blackjack', icon: <StarIcon {...CHIP_ICON} />, tone: 'done' };
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

  onWelcome() {
    entry.mark();
  },

  onRoom(room, prev) {
    const fresh = entry.take() || !prev?.game;
    const store = useBlackjackStore.getState();
    if (room.phase === 'lobby' || !room.game) {
      clearBlackjackSounds();
      if (room.phase === 'lobby') store.reset();
      return;
    }
    const view = room.game;
    const { soundTimeline: before, table: prevTable } = store;
    store.applyView(view, Date.now(), fresh, !prefersReducedMotion());
    if (fresh || !prev?.game) {
      clearBlackjackSounds();
      return;
    }
    const me = usePlatformStore.getState().playerId;
    const { table, soundTimeline: timeline } = useBlackjackStore.getState();
    playBlackjackSounds({ view, prevView: prev.game, table, prevTable, before, timeline, me });
    if (me !== null && isActing(view, me) && !isActing(prev.game, me)) {
      playCue('yourTurn');
      vibrate(40);
    }
  },

  onLeave() {
    clearBlackjackSounds();
    useBlackjackStore.getState().reset();
  },
});
