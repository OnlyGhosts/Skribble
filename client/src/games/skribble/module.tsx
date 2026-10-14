/**
 * Skribble's client module: the game screen, its settings rows, the player-list and chat hooks,
 * and the handling of its own server messages (the drawing stream) and lifecycle events.
 */
import type { SkribbleRoomState, SkribbleSettings, SkribbleView } from '@shared/games/skribble/protocol';
import { gameById } from '@shared/platform/games';
import type { PlayerPublic } from '@shared/platform/protocol';
import { CheckIcon } from '../../platform/components/Icons';
import { defineGameClient } from '../../platform/game';
import { formatPoints } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { ONLOOKER_VOLUME, createSoundSchedule, playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { skribbleCanvas } from './canvas';
import { SkribbleChatInput } from './components/ChatInput';
import { PencilIcon } from './components/Icons';
import { SkribbleSettingsFields } from './components/SettingsFields';
import { drawerIdOf, hasGuessed, isNewTurn } from './hooks';
import { placeholderFor } from './lib/format';
import { SkribbleScreen } from './Screen';
import { skribbleSounds as sfx } from './sounds';
import { useSkribbleStore } from './store';
import './styles/skribble.css';

/** The turn's sting waits for the buzzer when the clock ran out. */
const BUZZER_MS = 350;
const sounds = createSoundSchedule();

function isDrawerOf(room: SkribbleRoomState, player: PlayerPublic): boolean {
  return drawerIdOf(room.game) === player.id;
}

export const skribbleClient = defineGameClient<SkribbleView, SkribbleSettings>({
  meta: gameById('skribble'),
  Screen: SkribbleScreen,
  sounds: sfx,
  SettingsFields: SkribbleSettingsFields,
  ChatInput: SkribbleChatInput,

  playerBadge(room, player) {
    if (isDrawerOf(room, player)) {
      return (
        <span className="player__badge player__badge--drawer" title="Drawing" aria-label="Drawing">
          <PencilIcon size={11} />
        </span>
      );
    }
    if (hasGuessed(room.game, player.id)) {
      return (
        <span className="player__badge player__badge--guessed" title="Guessed the word" aria-label="Guessed the word">
          <CheckIcon size={11} />
        </span>
      );
    }
    return null;
  },

  playerMeta(room, player) {
    const kind = room.game?.phase.kind;
    const turnPoints = room.game?.players[player.id]?.turnPoints ?? 0;
    if ((kind !== 'drawing' && kind !== 'turnEnd') || turnPoints <= 0) return null;
    return <span className="player__turn-points">{formatPoints(turnPoints)}</span>;
  },

  playerClassName(room, player) {
    return hasGuessed(room.game, player.id) && !isDrawerOf(room, player) ? 'player--guessed' : undefined;
  },

  chatPlaceholder(room, meId) {
    const kind = room.game?.phase.kind;
    const participating = room.players.find((p) => p.id === meId)?.participating ?? false;
    return placeholderFor(kind, meId !== null && drawerIdOf(room.game) === meId, hasGuessed(room.game, meId), participating);
  },

  /** The drawing stream is the platform canvas's. */
  onServerMessage(raw) {
    return skribbleCanvas.handleServerMessage(raw);
  },

  onWelcome(extra) {
    skribbleCanvas.onWelcome(extra);
  },

  onRoom(room, prev) {
    const store = useSkribbleStore.getState();
    const me = usePlatformStore.getState().playerId;
    const next = room.game?.phase;
    const before = prev?.game?.phase;
    // A new turn (or a return to the lobby) always starts on a blank canvas. A welcome (no prev)
    // brought the authoritative canvas along, so it is never wiped here.
    if (prev && ((next?.kind === 'choosing' && before?.kind !== 'choosing') || (room.phase === 'lobby' && prev.phase !== 'lobby'))) skribbleCanvas.store.getState().clear();
    if (isNewTurn(prev, room) || room.phase === 'lobby') store.setGuessDraft('');
    if (next?.kind === 'choosing' && next.drawerId === me && !(before?.kind === 'choosing' && before.drawerId === me)) playCue('yourTurn');
    if (prev && next?.kind === 'drawing' && before?.kind === 'choosing') sfx.play('chosen', { volume: next.drawerId === me ? 1 : ONLOOKER_VOLUME });
    // A welcome without a room before it (a join during the summary) never replays the end of a turn.
    if (prev && next?.kind === 'turnEnd' && before?.kind !== 'turnEnd') {
      const timeUp = next.reason === 'timeUp';
      if (timeUp) sfx.play('timeUp');
      sounds.at(Date.now() + (timeUp ? BUZZER_MS : 0), () => sfx.play('turnEnd'));
    }
    // A little buzz when this player cracks the word (the drawer is marked as guessed too; skip them).
    if (next?.kind === 'drawing' && before?.kind === 'drawing' && next.drawerId !== me && hasGuessed(room.game, me) && !hasGuessed(prev?.game ?? null, me)) vibrate(30);
  },

  onChat(message) {
    const me = usePlatformStore.getState().playerId;
    if (message.kind === 'correct') sfx.play('correct', { volume: message.playerId === me ? 1 : ONLOOKER_VOLUME });
    if (message.kind === 'close') sfx.play('close');
  },

  onLeave() {
    sounds.clear();
    skribbleCanvas.onLeave();
    useSkribbleStore.getState().reset();
  },
});
