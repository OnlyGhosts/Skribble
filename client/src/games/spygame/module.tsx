/**
 * The Spy Game's client module: the screen, the settings rows, the player-list badges and the
 * cues (sound, haptics, the vote sheet) that react to snapshots. Snapshots carry everything, so
 * there are no server messages to handle.
 */
import type { SpygameSettings, SpygameView } from '@shared/games/spygame/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { formatPoints } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { AlertIcon, EyeIcon, SpyIcon } from './components/Icons';
import { canGuessNow, isNewRound, nameOf, roundEnded, spyWentAway, voteEnded, voteStarted, wrongGuessAdded } from './hooks';
import { chatPlaceholderFor, voteNotice, waitingNotice, wrongGuessNotice } from './lib/text';
import { SpyGameScreen } from './Screen';
import { SpygameSettingsFields } from './SettingsFields';
import { useSpygameStore } from './store';
import './spygame.css';

export const spygameClient = defineGameClient<SpygameView, SpygameSettings>({
  meta: gameById('spygame'),
  Screen: SpyGameScreen,
  SettingsFields: SpygameSettingsFields,

  playerBadge(room, player) {
    const view = room.game;
    if (!view) return null;
    // The spy's identity is a secret until the reveal.
    if (view.reveal && view.reveal.spyId === player.id) {
      return (
        <span className="player__badge player__badge--spy" title="The spy" aria-label="The spy">
          <SpyIcon size={11} />
        </span>
      );
    }
    const p = view.players[player.id];
    if (p?.isAccused) {
      return (
        <span className="player__badge player__badge--accused" title="Accused" aria-label="Accused">
          <AlertIcon size={11} />
        </span>
      );
    }
    if (p?.isSpectator) {
      return (
        <span className="player__badge player__badge--spectator" title="Watching this round" aria-label="Watching this round">
          <EyeIcon size={11} />
        </span>
      );
    }
    return null;
  },

  playerMeta(room, player) {
    const points = room.game?.reveal?.points[player.id] ?? 0;
    return points > 0 ? <span className="player__turn-points">{formatPoints(points)}</span> : null;
  },

  chatPlaceholder(room) {
    return room.game ? chatPlaceholderFor(room.game.role, room.game.phase) : undefined;
  },

  onRoom(room, prev) {
    const store = useSpygameStore.getState();
    const { playerId: me, addToast } = usePlatformStore.getState();
    if (room.phase === 'lobby') {
      store.reset();
      return;
    }
    if (!room.game) return;
    if (isNewRound(prev, room)) {
      store.clearSelections();
      // A fresh entry (welcome) is not a round starting under this player's feet.
      if (prev) playCue('yourTurn');
    }
    // The phone column scrolls, so a change that lands above the fold is also announced as a toast.
    if (voteStarted(prev, room)) {
      const vote = room.game.vote;
      if (prev) {
        playCue('correct');
        vibrate(40);
      }
      store.highlightPlayer(null);
      if (vote?.canVote) store.setVoteSheetOpen(true);
      else if (vote && prev && vote.accuserId !== me) addToast('info', voteNotice(nameOf(room, vote.accuserId), nameOf(room, vote.accusedId), vote.accusedId === me));
    }
    if (voteEnded(prev, room)) store.setVoteSheetOpen(false);
    if (wrongGuessAdded(prev, room)) {
      playCue('correct');
      addToast('warning', wrongGuessNotice(room.game.guessesLeft));
      store.highlightLocation(null);
    }
    if (spyWentAway(prev, room) && prev) addToast('info', waitingNotice(nameOf(room, room.game.clock.waitingForId)));
    // A tile awaiting its confirming tap is forgotten whenever the grid stops being tappable (a vote,
    // the spy's pause, a wrong guess, the reveal): the next tap must never send a guess on its own.
    if (!canGuessNow(room.game) && store.highlightedLocation !== null) store.highlightLocation(null);
    if (roundEnded(prev, room)) {
      playCue('turnEnd');
      store.clearSelections();
    }
  },

  onLeave() {
    useSpygameStore.getState().reset();
  },
});
