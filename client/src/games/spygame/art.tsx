/** The Spy Game's lobby picture: a lilac hat with a lime band over a pair of dark glasses. */
import { ART, GameArt, OUTLINE } from '../../platform/components/GameArt';

export function SpygameArt() {
  return (
    <GameArt game="spygame">
      <path d="M22 20c1-10 3-13 10-13s9 3 10 13z" fill={ART.lilac} {...OUTLINE} />
      <rect x="21" y="16" width="22" height="5" fill={ART.lime} {...OUTLINE} />
      <path d="M8 24c10-5 38-5 48 0c-10 4-38 4-48 0z" fill={ART.lilac} {...OUTLINE} />
      <g transform="translate(0 2)">
        <rect x="19" y="29" width="11" height="8" rx="3" fill={ART.ink} {...OUTLINE} />
        <rect x="34" y="29" width="11" height="8" rx="3" fill={ART.ink} {...OUTLINE} />
        <path d="M30 32h4" fill="none" {...OUTLINE} />
      </g>
    </GameArt>
  );
}
