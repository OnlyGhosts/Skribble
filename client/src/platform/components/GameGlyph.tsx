import type { GameMeta } from '@shared/platform/games';
import { Icon, type IconProps } from './Icons';

/** A game's 24px line glyph (GameMeta.glyph) in currentColor. */
export function GameGlyph({ game, ...props }: IconProps & { game: GameMeta }) {
  return <Icon size={24} {...props} paths={game.glyph} data-glyph={game.id} />;
}
