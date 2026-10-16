/**
 * The contract between the platform shell and a game's client module. The platform renders the
 * front door, the room, players, settings and the podium; the module supplies
 * what happens on screen while the room is 'playing' or 'ended' and reacts to its own messages.
 *
 * `V` is the game's per-recipient view (RoomState.game), `S` its settings (flat next to the
 * platform settings in RoomState.settings).
 */
import type { ComponentType, ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { ChatMessage, PlayerPublic, RoomState, WireMessage } from '@shared/platform/protocol';
import type { PlatformSettings } from '@shared/platform/settings';
import type { AnySoundBank } from './lib/sound';

export interface GameScreenProps<V = unknown, S = Record<string, unknown>> {
  room: RoomState<V, S>;
  meId: string;
  isHost: boolean;
}

/** The host's settings rows: only the host's room shows settings, so every row is editable. */
export interface SettingsFieldsProps<S = Record<string, unknown>> {
  settings: PlatformSettings & S;
  /** Sends one flat settings patch (game fields only; the platform fields have their own controls). */
  patch(partial: Partial<S>): void;
}

/**
 * A player's state in one word and an icon, for the chip under their avatar in the game's top
 * bar ("Drawing", "Guessed", "Out", "Folded"). The tone picks the badge colour: `ready` and
 * `done` read as finished (check green), `active` as their move now (lime), `out` as knocked out,
 * `muted` as not taking part.
 */
export interface PlayerStatus {
  label: string;
  icon: ReactNode;
  tone: 'ready' | 'done' | 'active' | 'out' | 'muted';
}

export interface GameClientModule<V = unknown, S = Record<string, unknown>> {
  meta: GameMeta;
  /** Rendered while the room is 'playing' or 'ended' (the platform adds the podium overlay for 'ended'). */
  Screen: ComponentType<GameScreenProps<V, S>>;
  /** The game's sound effects; the platform starts loading them when the game screen mounts. */
  sounds?: AnySoundBank;
  /** Extra rows inside the lobby settings panel, under the platform fields. */
  SettingsFields?: ComponentType<SettingsFieldsProps<S>>;
  /** A small badge in the corner of the player's avatar (Skribble: pencil / check). */
  playerBadge?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /** Extra text next to the score in the player list (Skribble: "+120" this turn). */
  playerMeta?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /**
   * The player's chip status in the top bar; null falls back to the platform's ("Ready", or
   * "Watching" / "Away" for players sitting the game out or offline, which the platform decides).
   */
  playerStatus?(room: RoomState<V, S>, player: PlayerPublic): PlayerStatus | null;
  /** Extra class for the player's row (Skribble: the green "guessed" tint). */
  playerClassName?(room: RoomState<V, S>, player: PlayerPublic): string | undefined;
  /** A server message that is not a platform message; return true when handled. */
  onServerMessage?(msg: WireMessage): boolean;
  /** `welcome.extra`, the game's bootstrap (Skribble: the canvas history). The room is already in the store. */
  onWelcome?(extra: unknown): void;
  /** Every snapshot, welcome included; `prev` is null when this one enters the room. */
  onRoom?(room: RoomState<V, S>, prev: RoomState<V, S> | null): void;
  /** A freshly appended chat line (history from a welcome does not count): Scribble's guesses and the game's lines. */
  onChat?(message: ChatMessage): void;
  /** The room is being left (leave, kick, seat lost): drop local game state, flush what must still go out. */
  onLeave?(): void;
}

/** The erased module type the registry and the platform shell work with. */
export type AnyGameClientModule = GameClientModule<unknown, Record<string, unknown>>;

/**
 * Erases a module's type parameters for the registry. Safe because the platform only ever hands a
 * module the room of its own game, so the view and settings are the ones it was written for.
 */
export function defineGameClient<V, S extends Record<string, unknown>>(module: GameClientModule<V, S>): AnyGameClientModule {
  return module as unknown as AnyGameClientModule;
}
