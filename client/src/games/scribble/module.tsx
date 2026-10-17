/**
 * Scribble's client module: the game screen, its settings rows, the player-list and guess hooks,
 * and the handling of its own server messages (the drawing stream) and lifecycle events.
 */
import type { ScribbleRoomState, ScribbleSettings, ScribbleView } from '@shared/games/scribble/protocol';
import { gameById } from '@shared/platform/games';
import type { PlayerPublic } from '@shared/platform/protocol';
import { ChatIcon, CheckIcon } from '../../platform/components/Icons';
import { CHIP_ICON } from '../../platform/components/PlayerChips';
import { defineGameClient } from '../../platform/game';
import { formatPoints } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { ONLOOKER_VOLUME, createSoundSchedule, playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { scribbleCanvas } from './canvas';
import { PencilIcon } from './components/Icons';
import { ScribbleSettingsFields } from './components/SettingsFields';
import { drawerIdOf, hasGuessed, isNewTurn } from './hooks';
import { scribbleRules } from './rules';
import { ScribbleScreen } from './Screen';
import { scribbleSounds as sfx } from './sounds';
import { useScribbleStore } from './store';
import './styles/scribble.css';

/** The turn's sting waits for the buzzer when the clock ran out. */
const BUZZER_MS = 350;
const sounds = createSoundSchedule();

/**
 * Where this game's guess feed starts: after the last line from before the game (the lobby's, an
 * earlier game's and the start announcements, which share the game's start time).
 */
function feedStart(game: ScribbleView | null): number {
  let from = 0;
  for (const line of usePlatformStore.getState().chat) if (line.ts <= (game?.startedAt ?? 0)) from = Math.max(from, line.id);
  return from;
}

function isDrawerOf(room: ScribbleRoomState, player: PlayerPublic): boolean {
  return drawerIdOf(room.game) === player.id;
}

export const scribbleClient = defineGameClient<ScribbleView, ScribbleSettings>({
  meta: gameById('scribble'),
  Screen: ScribbleScreen,
  rules: scribbleRules,
  sounds: sfx,
  SettingsFields: ScribbleSettingsFields,

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

  playerStatus(room, player) {
    const kind = room.game?.phase.kind;
    if (isDrawerOf(room, player)) return { label: kind === 'choosing' ? 'Choosing' : 'Drawing', icon: <PencilIcon {...CHIP_ICON} />, tone: 'active' };
    if (hasGuessed(room.game, player.id)) return { label: 'Guessed', icon: <CheckIcon {...CHIP_ICON} strokeWidth={3} />, tone: 'done' };
    return kind === 'drawing' ? { label: 'Guessing', icon: <ChatIcon {...CHIP_ICON} />, tone: 'muted' } : null;
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

  /** The drawing stream is the platform canvas's. */
  onServerMessage(raw) {
    return scribbleCanvas.handleServerMessage(raw);
  },

  onWelcome(extra) {
    scribbleCanvas.onWelcome(extra);
  },

  onRoom(room, prev) {
    const store = useScribbleStore.getState();
    const me = usePlatformStore.getState().playerId;
    const next = room.game?.phase;
    const before = prev?.game?.phase;
    // A new turn (or a return to the lobby) always starts on a blank canvas. A welcome (no prev)
    // brought the authoritative canvas along, so it is never wiped here.
    if (prev && ((next?.kind === 'choosing' && before?.kind !== 'choosing') || (room.phase === 'lobby' && prev.phase !== 'lobby'))) scribbleCanvas.store.getState().clear();
    if (isNewTurn(prev, room) || room.phase === 'lobby') store.setGuessDraft('');
    // A game starting under this player's eyes, or a welcome into a running one: the feed holds only this game's lines.
    if (room.phase === 'playing' && (!prev || prev.phase !== 'playing')) store.setFeedFrom(feedStart(room.game));
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
    scribbleCanvas.onLeave();
    useScribbleStore.getState().reset();
  },
});
