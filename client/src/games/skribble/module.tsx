/**
 * Skribble's client module: the game screen, its settings rows, the player-list and chat hooks,
 * and the handling of its own server messages (the drawing stream) and lifecycle events.
 */
import { isSkribbleWelcomeExtra, type SkribbleRoomState, type SkribbleServerMessage, type SkribbleSettings, type SkribbleView } from '@shared/games/skribble/protocol';
import { gameById } from '@shared/platform/games';
import type { PlayerPublic, WireMessage } from '@shared/platform/protocol';
import { CheckIcon } from '../../platform/components/Icons';
import { defineGameClient } from '../../platform/game';
import { formatPoints } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { canvasBus } from './canvas/bus';
import { SkribbleChatInput } from './components/ChatInput';
import { PencilIcon } from './components/Icons';
import { SkribbleSettingsFields } from './components/SettingsFields';
import { asSkribbleRoom, drawerIdOf, hasGuessed, isNewTurn } from './hooks';
import { placeholderFor } from './lib/format';
import { drawQueue } from './net';
import { SkribbleScreen } from './Screen';
import { useSkribbleStore } from './store';
import './styles/skribble.css';

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(['draw', 'undo', 'clear', 'canvas']);

function asServerMessage(msg: WireMessage): SkribbleServerMessage | null {
  // The server is trusted on shape; only the discriminator is checked here.
  return SERVER_MESSAGE_TYPES.has(msg.t) ? (msg as SkribbleServerMessage) : null;
}

/** The current drawer applies undo/clear when sending them, so their echoes carry nothing new. */
function isOwnCanvasEcho(): boolean {
  const s = usePlatformStore.getState();
  const view = s.room ? asSkribbleRoom(s.room).game : null;
  return view?.phase.kind === 'drawing' && view.phase.drawerId === s.playerId;
}

function isDrawerOf(room: SkribbleRoomState, player: PlayerPublic): boolean {
  return drawerIdOf(room.game) === player.id;
}

export const skribbleClient = defineGameClient<SkribbleView, SkribbleSettings>({
  meta: gameById('skribble'),
  Screen: SkribbleScreen,
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
    return placeholderFor(kind, meId !== null && drawerIdOf(room.game) === meId, hasGuessed(room.game, meId));
  },

  onServerMessage(raw) {
    const msg = asServerMessage(raw);
    if (!msg) return false;
    const store = useSkribbleStore.getState();
    switch (msg.t) {
      case 'draw':
        store.appendOps(msg.ops);
        canvasBus.emit(msg.ops);
        break;
      case 'undo':
        if (!isOwnCanvasEcho()) store.undo();
        break;
      case 'clear':
        if (!isOwnCanvasEcho()) store.clear();
        break;
      case 'canvas':
        store.setCanvas(msg.actions);
        break;
    }
    return true;
  },

  onWelcome(extra) {
    useSkribbleStore.getState().setCanvas(isSkribbleWelcomeExtra(extra) ? extra.canvas : []);
    const s = usePlatformStore.getState();
    if (s.room && s.playerId) drawQueue.resumeOfflineOps(asSkribbleRoom(s.room), s.playerId);
  },

  onRoom(room, prev) {
    const store = useSkribbleStore.getState();
    const me = usePlatformStore.getState().playerId;
    const next = room.game?.phase;
    const before = prev?.game?.phase;
    // A new turn (or a return to the lobby) always starts on a blank canvas. A welcome (no prev)
    // brought the authoritative canvas along, so it is never wiped here.
    if (prev && ((next?.kind === 'choosing' && before?.kind !== 'choosing') || (room.phase === 'lobby' && prev.phase !== 'lobby'))) store.clear();
    if (isNewTurn(prev, room) || room.phase === 'lobby') store.setGuessDraft('');
    if (next?.kind === 'choosing' && next.drawerId === me && !(before?.kind === 'choosing' && before.drawerId === me)) playCue('yourTurn');
    if (next?.kind === 'turnEnd' && before?.kind !== 'turnEnd') playCue('turnEnd');
    // A little buzz when this player cracks the word (the drawer is marked as guessed too; skip them).
    if (next?.kind === 'drawing' && before?.kind === 'drawing' && next.drawerId !== me && hasGuessed(room.game, me) && !hasGuessed(prev?.game ?? null, me)) vibrate(30);
  },

  onChat(message) {
    if (message.kind === 'correct') playCue('correct');
  },

  onLeave() {
    drawQueue.flush();
    drawQueue.dropOffline();
    useSkribbleStore.getState().reset();
  },
});
