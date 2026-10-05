/**
 * Quip Game's client module: the screen, the settings rows, the player-list badges, the chat
 * placeholder and the cues (sound, haptics, local state) that react to snapshots. Snapshots carry
 * everything, so there are no server messages to handle.
 */
import type { QuipgameSettings, QuipgameView } from '@shared/games/quipgame/protocol';
import { gameById } from '@shared/platform/games';
import { CheckIcon } from '../../platform/components/Icons';
import { defineGameClient } from '../../platform/game';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { EyeIcon, PenIcon } from './components/Icons';
import { RESULT_PHASES, WRITING_PHASES, phaseEntered, stepChanged } from './hooks';
import { chatPlaceholderFor } from './lib/text';
import { QuipGameScreen } from './Screen';
import { QuipgameSettingsFields } from './SettingsFields';
import { useQuipgameStore } from './store';
import './quipgame.css';

export const quipgameClient = defineGameClient<QuipgameView, QuipgameSettings>({
  meta: gameById('quipgame'),
  Screen: QuipGameScreen,
  SettingsFields: QuipgameSettingsFields,

  playerBadge(room, player) {
    const view = room.game;
    if (!view) return null;
    if (view.spectators.includes(player.id)) {
      return (
        <span className="player__badge player__badge--spectator" title="Watching this round" aria-label="Watching this round">
          <EyeIcon size={11} />
        </span>
      );
    }
    if (WRITING_PHASES.includes(view.phase)) {
      return view.finished.includes(player.id) ? (
        <span className="player__badge player__badge--done" title="Answers in" aria-label="Answers in">
          <CheckIcon size={11} />
        </span>
      ) : (
        <span className="player__badge player__badge--writing" title="Writing" aria-label="Writing">
          <PenIcon size={11} />
        </span>
      );
    }
    if (view.voted.includes(player.id)) {
      return (
        <span className="player__badge player__badge--done" title="Voted" aria-label="Voted">
          <CheckIcon size={11} />
        </span>
      );
    }
    return null;
  },

  chatPlaceholder(room) {
    return room.game ? chatPlaceholderFor(room.game.phase) : undefined;
  },

  onRoom(room, prev) {
    const store = useQuipgameStore.getState();
    if (room.phase === 'lobby') {
      store.reset();
      return;
    }
    const view = room.game;
    if (!view) return;
    if (stepChanged(prev, room)) {
      store.clearPhaseState();
      // A reconnect lands mid-final: the ranking already sent is the starting point.
      if (view.phase === 'finalVoting') store.setPicks(view.myRanking);
    }
    // A fresh entry (welcome) is not a phase starting under this player's feet.
    if (!prev) return;
    if (phaseEntered(prev, room, WRITING_PHASES)) {
      playCue('yourTurn');
      vibrate(40);
    } else if (phaseEntered(prev, room, ['finalVoting'])) {
      playCue('turnEnd');
      vibrate(40);
    } else if (phaseEntered(prev, room, RESULT_PHASES) || (stepChanged(prev, room) && RESULT_PHASES.includes(view.phase))) {
      playCue('correct');
    }
  },

  onLeave() {
    useQuipgameStore.getState().reset();
  },
});
