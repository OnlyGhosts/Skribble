import type { ReactNode } from 'react';
import type { GameId } from '@shared/platform/games';

/**
 * The frame every game's lobby picture (GameClientModule.Art) is drawn in: a 64x46 canvas in the
 * mascots' style, flat fills in lime, lilac and paper with an ink outline and a hard ink shadow.
 * The shadow is the same drawing once more, in solid ink, offset right and down underneath
 * (components.css recolours it), so a game draws its picture once with the `ART` palette and
 * `OUTLINE` and gets the shadow for free.
 */
export const ART_VIEWBOX = '0 0 64 46';

/** The palette a picture may use, through the theme tokens (the same colours in both themes). */
export const ART = {
  ink: 'var(--game-ink)',
  lime: 'var(--color-primary)',
  lilac: 'var(--color-secondary)',
  paper: 'var(--game-paper)',
} as const;

/** The outline every shape in a picture gets: 2.5 units of ink with round joins. */
export const OUTLINE = { stroke: ART.ink, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Fine ink detail inside a shape (a card's inner frame, a chip's ring). */
export const DETAIL = { fill: 'none', stroke: ART.ink, strokeWidth: 1.8 } as const;

/** How far the hard shadow sits right and down. */
const SHADOW_OFFSET = 2.2;

interface Props {
  game: GameId;
  children: ReactNode;
}

export function GameArt({ game, children }: Props) {
  return (
    <svg className="game-art" viewBox={ART_VIEWBOX} aria-hidden="true" focusable="false" data-art={game}>
      <g className="game-art__shadow" transform={`translate(${SHADOW_OFFSET} ${SHADOW_OFFSET})`}>
        {children}
      </g>
      <g>{children}</g>
    </svg>
  );
}
