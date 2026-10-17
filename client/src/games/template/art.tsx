/**
 * Click Race's lobby picture: a big lime button on a paper base, mid-tap. The template of a game's
 * picture: a few flat shapes from the ART palette, each with the OUTLINE, inside the GameArt frame,
 * which draws the hard shadow.
 */
import { ART, GameArt, OUTLINE } from '../../platform/components/GameArt';

export function ClickRaceArt() {
  return (
    <GameArt game="template">
      <path d="M32 2v6M19 6l4 5M45 6l-4 5" fill="none" {...OUTLINE} />
      <rect x="12" y="27" width="40" height="12" rx="6" fill={ART.paper} {...OUTLINE} />
      <ellipse cx="32" cy="23" rx="15" ry="10" fill={ART.lime} {...OUTLINE} />
      <path d="M23 20c1.5-3 4.5-5 8.5-5" fill="none" stroke={ART.paper} strokeWidth={2.5} strokeLinecap="round" />
    </GameArt>
  );
}
