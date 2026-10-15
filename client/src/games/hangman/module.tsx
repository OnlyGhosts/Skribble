/**
 * Hangman's client module: the screen, the settings rows, the player-list hooks, the shared canvas
 * stream (the hangman's drawing) and the cues that react to snapshots.
 */
import { isHangmanWelcomeExtra, type HangmanSettings, type HangmanView } from '@shared/games/hangman/protocol';
import { gameById } from '@shared/platform/games';
import { CHIP_ICON } from '../../platform/components/PlayerChips';
import { defineGameClient } from '../../platform/game';
import { formatPoints } from '../../platform/lib/format';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { hangmanCanvas } from './canvas';
import { KeyboardIcon, RopeIcon, SkullIcon } from './components/Icons';
import { isGuesser, isHangman, isNewSection, isNewTurn, isOut } from './hooks';
import { chatPlaceholderFor } from './lib/text';
import { HangmanScreen } from './Screen';
import { HangmanSettingsFields } from './SettingsFields';
import { playHangmanSounds } from './sfx';
import { hangmanSounds } from './sounds';
import { useHangmanStore } from './store';
import './hangman.css';

const meta = gameById('hangman');

export const hangmanClient = defineGameClient<HangmanView, HangmanSettings>({
  meta,
  Screen: HangmanScreen,
  SettingsFields: HangmanSettingsFields,
  sounds: hangmanSounds,

  playerBadge(room, player) {
    const view = room.game;
    if (isHangman(view, player.id)) {
      return (
        <span className="player__badge player__badge--hangman" style={{ background: meta.accent }} title="The hangman" aria-label="The hangman">
          <RopeIcon size={11} />
        </span>
      );
    }
    if (isOut(view, player.id)) {
      return (
        <span className="player__badge player__badge--out" title="Out for this word" aria-label="Out for this word">
          <SkullIcon size={11} />
        </span>
      );
    }
    if (isGuesser(view, player.id)) {
      return (
        <span className="player__badge player__badge--guessing" title="Guessing" aria-label="Guessing">
          <KeyboardIcon size={11} />
        </span>
      );
    }
    return null;
  },

  playerStatus(room, player) {
    const view = room.game;
    if (isHangman(view, player.id)) return { label: 'Hangman', icon: <RopeIcon {...CHIP_ICON} />, tone: 'active' };
    if (isOut(view, player.id)) return { label: 'Out', icon: <SkullIcon {...CHIP_ICON} />, tone: 'out' };
    if (isGuesser(view, player.id)) return { label: 'Guessing', icon: <KeyboardIcon {...CHIP_ICON} />, tone: 'active' };
    return null;
  },

  playerMeta(room, player) {
    const points = room.game?.points[player.id] ?? 0;
    return points > 0 ? <span className="player__turn-points">{formatPoints(points)}</span> : null;
  },

  playerClassName(room, player) {
    const view = room.game;
    if (isOut(view, player.id)) return 'player--out';
    return isGuesser(view, player.id) ? 'player--guessing' : undefined;
  },

  chatPlaceholder(room, meId) {
    const participating = room.players.find((p) => p.id === meId)?.participating ?? false;
    return chatPlaceholderFor(room.game?.phase, isGuesser(room.game, meId), participating);
  },

  /** The drawing stream is the platform canvas's. */
  onServerMessage(raw) {
    return hangmanCanvas.handleServerMessage(raw);
  },

  onWelcome(extra) {
    hangmanCanvas.onWelcome(extra);
    // A rejoin mid-section: the server says where the section began; otherwise nothing is undoable yet.
    const canvas = hangmanCanvas.store.getState().canvas.length;
    useHangmanStore.getState().setSectionFloor(isHangmanWelcomeExtra(extra) && extra.floor !== undefined ? Math.min(extra.floor, canvas) : canvas);
  },

  onRoom(room, prev) {
    const store = useHangmanStore.getState();
    const me = usePlatformStore.getState().playerId;
    if (room.phase === 'lobby') {
      if (prev && prev.phase !== 'lobby') hangmanCanvas.store.getState().clear();
      store.reset();
      return;
    }
    const view = room.game;
    if (!view) return;
    const before = prev?.game ?? null;
    if (isNewTurn(prev, room)) {
      // A new word starts on a blank canvas and with empty drafts. A welcome (no prev) brought the
      // authoritative canvas along and may land in the same turn, so it wipes nothing.
      if (prev) {
        hangmanCanvas.store.getState().clear();
        store.newTurn();
      }
      if (prev && isHangman(view, me)) playCue('yourTurn');
    }
    if (prev && isNewSection(prev, room)) {
      // The section's strokes begin here: undo and clear stop at this count.
      store.setSectionFloor(hangmanCanvas.store.getState().canvas.length);
      hangmanCanvas.store.getState().dropRedo();
      if (isHangman(view, me)) playCue('yourTurn');
    }
    if (isGuesser(view, me) && !isGuesser(before, me)) {
      store.setGuessMode('letters');
      if (prev) {
        playCue('yourTurn');
        vibrate(30);
      }
    }
    if (prev && before) playHangmanSounds(view, before, me);
  },

  onLeave() {
    hangmanCanvas.onLeave();
    useHangmanStore.getState().reset();
  },
});
