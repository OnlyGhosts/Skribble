/**
 * Battleships' client module: the screen, the settings rows, the player-list badges and the cues
 * (sound, haptics, toasts, the grid to open) that react to snapshots. Snapshots carry everything,
 * so there are no server messages to handle.
 */
import type { BattleshipsSettings, BattleshipsView } from '@shared/games/battleships/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { vibrate } from '../../platform/lib/haptics';
import { playCue } from '../../platform/lib/sound';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { AnchorIcon, CrosshairIcon, SkullIcon } from './components/Icons';
import { isEliminated, isNewGame, isShooter, isWatching, mySideSunk, nameOf, shotAdded, targetForTurn, turnKey } from './hooks';
import { chatPlaceholderFor } from './lib/text';
import { BattleshipsScreen } from './Screen';
import { BattleshipsSettingsFields } from './SettingsFields';
import { clearBattleshipsSounds, playBattleshipsSounds } from './sfx';
import { battleshipsSounds } from './sounds';
import { useBattleshipsStore } from './store';
import './battleships.css';

const meta = gameById('battleships');

export const battleshipsClient = defineGameClient<BattleshipsView, BattleshipsSettings>({
  meta,
  Screen: BattleshipsScreen,
  SettingsFields: BattleshipsSettingsFields,
  sounds: battleshipsSounds,

  playerBadge(room, player) {
    const view = room.game;
    if (!view) return null;
    if (isEliminated(view, player.id)) {
      return (
        <span className="player__badge player__badge--sunk" title="Fleet sunk" aria-label="Fleet sunk">
          <SkullIcon size={11} />
        </span>
      );
    }
    if (isShooter(view, player.id)) {
      return (
        <span className="player__badge player__badge--shooter" style={{ background: meta.accent }} title="Their turn" aria-label="Their turn">
          <CrosshairIcon size={11} />
        </span>
      );
    }
    if (view.mode === 'teams' && view.phase === 'placing' && view.sides.some((s) => s.captainId === player.id)) {
      return (
        <span className="player__badge player__badge--captain" title="Captain" aria-label="Captain">
          <AnchorIcon size={11} />
        </span>
      );
    }
    return null;
  },

  playerClassName(room, player) {
    const view = room.game;
    if (isEliminated(view, player.id)) return 'player--sunk';
    return isShooter(view, player.id) ? 'player--shooter' : undefined;
  },

  chatPlaceholder(room, meId) {
    const view = room.game;
    return chatPlaceholderFor(view?.phase, isShooter(view, meId), view ? isWatching(view, meId) : false);
  },

  onRoom(room, prev) {
    const store = useBattleshipsStore.getState();
    const { playerId: me, addToast } = usePlatformStore.getState();
    if (room.phase === 'lobby') {
      clearBattleshipsSounds();
      store.reset();
      return;
    }
    const view = room.game;
    if (!view) return;
    if (isNewGame(prev, room)) store.newGame();
    const before = prev?.game ?? null;
    if (view.phase === 'placing' && view.myBoard) store.adoptLayout(view.myBoard.ships);
    const myTurn = isShooter(view, me) && view.phase === 'playing';
    const key = turnKey(view);
    // A turn of the viewer's opens (or comes back with a fresh roll after a hold): the choice, or straight to aiming.
    if (myTurn && useBattleshipsStore.getState().turn.key !== key) {
      store.beginTurn(key, view.moveOrFire && view.turn?.roll !== null);
      store.selectTab(targetForTurn(view, store.tab));
      if (prev && !(isShooter(before, me) && before?.phase === 'playing' && before.turnNumber === view.turnNumber)) {
        playCue('yourTurn');
        vibrate(30);
      }
    }
    // The aim is forgotten whenever the grid stops being tappable: the next tap must never fire on its own.
    if (!myTurn && store.aim !== null) store.setAim(null);
    if (prev && before) playBattleshipsSounds(view, before, me);
    if (prev && shotAdded(before, view) && view.lastShot) {
      const shot = view.lastShot;
      if (shot.targetId === view.mySideId && shot.result !== 'miss') vibrate(shot.result === 'sunk' ? 80 : 30);
    }
    // A move says only who moved: everyone but the mover hears it here too, as the next turn has already begun.
    const action = view.lastAction;
    if (prev && before && before.turnNumber !== view.turnNumber && action?.kind === 'move' && action.playerId !== me) addToast('info', `${nameOf(room, action.playerId)} moved a ship.`);
    // A teammate starts planning a move: their ghost shows on the shared board.
    if (!myTurn && view.myBoard?.plan && !before?.myBoard?.plan) store.selectTab(null);
    if (prev && mySideSunk(before, view, me)) {
      playCue('turnEnd');
      addToast('warning', 'Your fleet is sunk. You can watch the rest of the battle.');
    }
  },

  onLeave() {
    clearBattleshipsSounds();
    useBattleshipsStore.getState().reset();
  },
});
