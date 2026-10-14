/**
 * Blackjack's client module: the table screen, the settings rows, the player-list badges, the chat
 * placeholder and the cues (sound, haptics, local state) that react to snapshots. Snapshots carry
 * everything, so there are no server messages to handle.
 */
import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { CardsIcon, OutIcon, StarIcon } from './components/Icons';
import { isActing, isInRound, netOf, phaseEntered, roundChanged, seatOf } from './hooks';
import { chatPlaceholderFor, formatChips } from './lib/text';
import { BlackjackScreen } from './Screen';
import { BlackjackSettingsFields } from './SettingsFields';
import { useBlackjackStore } from './store';
import './blackjack.css';

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

  onRoom(room, prev) {
    const store = useBlackjackStore.getState();
    const me = usePlatformStore.getState().playerId;
    if (room.phase === 'lobby') {
      store.reset();
      return;
    }
    const view = room.game;
    if (!view) return;
    if (roundChanged(prev, room)) store.newRound();
    // A fresh entry (welcome) is not a turn starting under this player's feet.
    if (!prev) return;
    if (phaseEntered(prev, room, 'betting') && isInRound(view, me)) {
      playCue('yourTurn');
      vibrate(30);
    } else if (isActing(view, me) && !isActing(prev.game, me)) {
      playCue('yourTurn');
      vibrate(40);
    } else if (phaseEntered(prev, room, 'results')) {
      playCue(me !== null && netOf(view, me) > 0 ? 'correct' : 'turnEnd');
    }
  },

  onLeave() {
    useBlackjackStore.getState().reset();
  },
});
