/**
 * Poker's client module: the table screen, the settings rows, the player-list badges, the chat
 * placeholder and what reacts to snapshots: the table's animation timeline (planned in the store
 * from each snapshot) and the cues. Snapshots carry everything, so there are no server messages.
 */
import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { CHIP_ICON } from '../../platform/components/PlayerChips';
import { defineGameClient } from '../../platform/game';
import { formatChips } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { prefersReducedMotion } from '../../platform/lib/media';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { cancelCue, cueAt } from '../../platform/table/cues';
import { createEntryFlag } from '../../platform/table/entry';
import { CardsIcon, OutIcon } from './components/Icons';
import { isInHand, isMyTurn, seatOf, stepOf } from './hooks';
import { chatPlaceholderFor } from './lib/text';
import { PokerScreen } from './Screen';
import { PokerSettingsFields } from './SettingsFields';
import { clearPokerSounds, playPokerSounds } from './sfx';
import { pokerSounds } from './sounds';
import { usePokerStore } from './store';
import './poker.css';

/** A welcome (a join or a reconnect) shows the table at once. */
const entry = createEntryFlag();

const meta = gameById('poker');

export const pokerClient = defineGameClient<PokerView, PokerSettings>({
  meta,
  Screen: PokerScreen,
  SettingsFields: PokerSettingsFields,
  sounds: pokerSounds,

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

  playerStatus(room, player) {
    const view = room.game;
    const seat = seatOf(view, player.id);
    if (!view || !seat) return null;
    if (seat.busted) return { label: 'Out', icon: <OutIcon {...CHIP_ICON} />, tone: 'out' };
    if (isMyTurn(view, player.id)) return { label: 'To act', icon: <CardsIcon {...CHIP_ICON} />, tone: 'active' };
    if (seat.status === 'folded') return { label: 'Folded', icon: <OutIcon {...CHIP_ICON} />, tone: 'muted' };
    if (seat.status === 'allIn') return { label: 'All in', icon: <CardsIcon {...CHIP_ICON} />, tone: 'active' };
    return { label: 'Playing', icon: <CardsIcon {...CHIP_ICON} />, tone: 'ready' };
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

  onWelcome() {
    entry.mark();
  },

  onRoom(room, prev) {
    // A welcome (or no room before) is a fresh entry. The snapshot that starts the game comes after
    // the lobby's room and already deals hand 1: it animates from an empty table, with its sounds and cue.
    const fresh = entry.take() || prev === null;
    const store = usePokerStore.getState();
    if (room.phase === 'lobby' || !room.game) {
      cancelCue();
      clearPokerSounds();
      if (room.phase === 'lobby') store.reset();
      return;
    }
    const view = room.game;
    if (stepOf(prev) !== stepOf(room)) store.newTurn();
    if (room.phase !== 'playing') store.setConfirmEnd(false);
    const me = usePlatformStore.getState().playerId;
    const before = store.soundTimeline;
    const timeline = store.applyView(view, me, Date.now(), fresh, !prefersReducedMotion());
    const soundTimeline = usePokerStore.getState().soundTimeline;
    // A fresh entry (welcome) is not a turn starting under this player's feet.
    if (fresh) {
      clearPokerSounds();
      return;
    }
    const prevView = prev?.game ?? null;
    playPokerSounds({ view, prevView, before, timeline: soundTimeline, me });
    if (me === null) return;
    if (isMyTurn(view, me) && !isMyTurn(prevView, me)) {
      // The cue comes when my turn shows: once the cards that came with it have landed.
      cueAt(Math.max(Date.now(), timeline.endsAt), () => {
        playCue('yourTurn');
        vibrate(40);
      });
    }
  },

  onLeave() {
    cancelCue();
    clearPokerSounds();
    usePokerStore.getState().reset();
  },
});
