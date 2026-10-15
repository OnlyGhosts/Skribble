import { useLayoutEffect, useRef, useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule, PlayerStatus } from '../game';
import { Avatar } from './Avatar';
import { CheckIcon, EyeIcon, MoonIcon } from './Icons';

/** The size of the icon in a chip's status badge; games pass it to their own icons. */
export const CHIP_ICON = { size: 9, strokeWidth: 2.8 } as const;

/** A chip's width and the gap between chips, in px, unless the stylesheet's `--chip-w` / `--chip-gap` on the row say otherwise. */
export const CHIP_WIDTH = 64;
export const CHIP_GAP = 6;

/** Players taking part first, then the ones sitting it out; join order inside each group. */
export function chipOrder(players: readonly PlayerPublic[]): PlayerPublic[] {
  return players.slice().sort((a, b) => Number(b.participating) - Number(a.participating) || a.joinOrder - b.joinOrder);
}

/** How many chips fit in a row `width` px wide (always at least one). */
export function chipCapacity(width: number, chip = CHIP_WIDTH, gap = CHIP_GAP): number {
  return Math.max(1, Math.floor((width + gap) / (chip + gap)));
}

/** A length custom property of `el` in px, or `fallback`. */
function cssPx(el: HTMLElement, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The row never scrolls: every chip when they all fit, otherwise one slot gives way to a "+K" chip. */
export function chipLayout(count: number, capacity: number): { shown: number; more: number } {
  if (count <= capacity) return { shown: count, more: 0 };
  const shown = Math.max(0, capacity - 1);
  return { shown, more: count - shown };
}

/** Offline and sitting out are the platform's to say; otherwise the game's status, or "Ready". */
export function chipStatus(room: RoomState, player: PlayerPublic, game: AnyGameClientModule | null): PlayerStatus {
  if (!player.connected) return { label: 'Away', icon: <MoonIcon {...CHIP_ICON} />, tone: 'muted' };
  if (!player.participating) return { label: 'Watching', icon: <EyeIcon {...CHIP_ICON} />, tone: 'muted' };
  return game?.playerStatus?.(room, player) ?? { label: 'Ready', icon: <CheckIcon {...CHIP_ICON} strokeWidth={3} />, tone: 'ready' };
}

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
  open: boolean;
  onOpen(): void;
  label: string;
}

/**
 * The players under the game's name: avatar, name and a status badge per chip. The whole row opens
 * the players sheet; when more players are in than fit, the last slot is a "+K" chip.
 */
export function PlayerChips({ room, game, open, onOpen, label }: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [capacity, setCapacity] = useState(4);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The stylesheet sizes the chips (smaller on a phone on its side), so they are read from it.
    const measure = () => setCapacity(chipCapacity(el.clientWidth, cssPx(el, '--chip-w', CHIP_WIDTH), cssPx(el, '--chip-gap', CHIP_GAP)));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const players = chipOrder(room.players);
  const { shown, more } = chipLayout(players.length, capacity);

  return (
    <button ref={ref} type="button" className="chips" onClick={onOpen} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label} (${players.length})`} data-testid="players-toggle">
      {players.slice(0, shown).map((p) => {
        const status = chipStatus(room, p, game);
        return (
          <span key={p.id} className={`chip${p.connected ? '' : ' chip--away'}`} data-testid="player-chip" data-player={p.id} data-status={status.tone} data-label={status.label}>
            <Avatar avatar={p.avatar} size="md" />
            <span className="chip__name">{p.name}</span>
            <span className={`chip__status chip__status--${status.tone}`}>
              <span className="chip__icon">{status.icon}</span>
              {status.label}
            </span>
          </span>
        );
      })}
      {more > 0 && (
        <span className="chip chip--more" data-testid="chips-more">
          +{more}
        </span>
      )}
    </button>
  );
}
