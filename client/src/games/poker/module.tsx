/**
 * Poker's client module: the table screen, the settings rows, the player-list badges, the chat
 * placeholder and the cues (sound, haptics, local state) that react to snapshots. Snapshots carry
 * everything, so there are no server messages to handle.
 */
import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { formatChips } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { CardsIcon, OutIcon } from './components/Icons';
import { isInHand, isMyTurn, phaseEntered, seatOf, stepOf } from './hooks';
import { chatPlaceholderFor } from './lib/text';
import { PokerScreen } from './Screen';
import { PokerSettingsFields } from './SettingsFields';
import { usePokerStore } from './store';
import './poker.css';

const meta = gameById('poker');

export const pokerClient = defineGameClient<PokerView, PokerSettings>({
  meta,
  Screen: PokerScreen,
  SettingsFields: PokerSettingsFields,

  playerBadge(room, player) {
    const view = room.game;
    const seat = seatOf(view, player.id);
    if (!view || !seat) return null;
    if (seat.busted) {
      return (
        <span className="player__badge player__badge--out" title="Out of chips" aria-label="Out of chips">
          <OutIcon size={11} />
        </span>
      );
    }
    if (isMyTurn(view, player.id)) {
      return (
        <span className="player__badge player__badge--acting" title="To act" aria-label="To act">
          <CardsIcon size={11} />
        </span>
      );
    }
    if (seat.isDealer) {
      return (
        <span className="player__badge player__badge--dealer" title="Dealer" aria-label="Dealer">
          D
        </span>
      );
    }
    return null;
  },

  playerMeta(room, player) {
    const seat = seatOf(room.game, player.id);
    if (!seat) return null;
    if (seat.busted) return <span className="player__turn-points pk-player__out">out</span>;
    if (seat.status === 'folded') return <span className="player__turn-points pk-player__folded">folded</span>;
    if (seat.status === 'allIn') return <span className="player__turn-points">all in</span>;
    return seat.bet > 0 ? <span className="player__turn-points">{`bet ${formatChips(seat.bet)}`}</span> : null;
  },

  playerClassName(room, player) {
    const view = room.game;
    if (isMyTurn(view, player.id)) return 'player--acting';
    const seat = seatOf(view, player.id);
    if (seat?.busted) return 'player--out';
    return seat?.status === 'folded' ? 'player--folded' : undefined;
  },

  chatPlaceholder(room, meId) {
    return chatPlaceholderFor(room.game?.phase, isInHand(room.game, meId));
  },

  onRoom(room, prev) {
    const store = usePokerStore.getState();
    if (room.phase === 'lobby') {
      store.reset();
      return;
    }
    const view = room.game;
    if (!view) return;
    if (stepOf(prev) !== stepOf(room)) store.newTurn();
    if (room.phase !== 'playing') store.setConfirmEnd(false);
    // A fresh entry (welcome) is not a turn starting under this player's feet.
    if (!prev) return;
    const me = usePlatformStore.getState().playerId;
    if (isMyTurn(view, me) && !isMyTurn(prev.game, me)) {
      playCue('yourTurn');
      vibrate(40);
    } else if (phaseEntered(prev, room, 'results') && me !== null && view.results) {
      playCue((view.results.net[me] ?? 0) > 0 ? 'correct' : 'turnEnd');
    }
  },

  onLeave() {
    usePokerStore.getState().reset();
  },
});
