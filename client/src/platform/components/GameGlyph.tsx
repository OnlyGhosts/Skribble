import type { GameMeta } from '@shared/platform/games';
import { Icon, type IconProps } from './Icons';

/** A game's 24px line glyph (GameMeta.glyph) in currentColor. */
export function GameGlyph({ game, ...props }: IconProps & { game: GameMeta }) {
  return <Icon size={24} {...props} paths={game.glyph} data-glyph={game.id} />;
}

/** The glyph on the game's accent plate (ink on the accent, as on the lobby tiles): the mark in a game's own header. */
export function GameMark({ game, size = 'md' }: { game: GameMeta; size?: 'sm' | 'md' }) {
  return (
    <span className={`game-mark game-mark--${size}`} style={{ background: `var(--game-${game.id}, ${game.accent})` }} aria-hidden="true" data-testid="game-mark" data-game={game.id}>
      <GameGlyph game={game} size={size === 'sm' ? 18 : 22} />
    </span>
  );
}
