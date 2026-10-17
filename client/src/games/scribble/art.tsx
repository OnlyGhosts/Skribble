/** Scribble's lobby picture: a lime marker with a lilac cap over a scribbled line. */
import { ART, GameArt, OUTLINE } from '../../platform/components/GameArt';

export function ScribbleArt() {
  return (
    <GameArt game="scribble">
      <path d="M5 39c4-8 9-8 12-1s8 5 12-1s9-6 13 1" fill="none" {...OUTLINE} strokeWidth={3.2} />
      <g transform="rotate(-35 32 20)">
        <rect x="16" y="14" width="30" height="12" rx="1" fill={ART.lime} {...OUTLINE} />
        <rect x="42" y="14" width="7" height="12" rx="1" fill={ART.lilac} {...OUTLINE} />
        <path d="M16 14l-9 6l9 6z" fill={ART.paper} {...OUTLINE} />
        <path d="M11 17.4l-4 2.6l4 2.6z" fill={ART.ink} />
      </g>
    </GameArt>
  );
}
