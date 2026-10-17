/** Poker's lobby picture: a stack of chips, lime on top, with a lilac one leaning on it. */
import { ART, DETAIL, GameArt, OUTLINE } from '../../platform/components/GameArt';

export function PokerArt() {
  return (
    <GameArt game="poker">
      <path d="M12 30c0 3.3 7.2 6 16 6s16-2.7 16-6v5c0 3.3-7.2 6-16 6s-16-2.7-16-6z" fill={ART.lilac} {...OUTLINE} />
      <path d="M12 24c0 3.3 7.2 6 16 6s16-2.7 16-6v6c0 3.3-7.2 6-16 6s-16-2.7-16-6z" fill={ART.paper} {...OUTLINE} />
      <path d="M12 18c0 3.3 7.2 6 16 6s16-2.7 16-6v6c0 3.3-7.2 6-16 6s-16-2.7-16-6z" fill={ART.lime} {...OUTLINE} />
      <ellipse cx="28" cy="18" rx="16" ry="6" fill={ART.lime} {...OUTLINE} />
      <ellipse cx="28" cy="18" rx="9" ry="3.3" {...DETAIL} />
      <path d="M28 12v2M28 22v2M13.5 16l3 .8M42.5 16l-3 .8" fill="none" {...OUTLINE} />
      <g transform="rotate(-24 52 28)">
        <ellipse cx="52" cy="28" rx="8" ry="9" fill={ART.lilac} {...OUTLINE} />
        <ellipse cx="52" cy="28" rx="4.5" ry="5" {...DETAIL} />
      </g>
    </GameArt>
  );
}
