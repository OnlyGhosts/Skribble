/** Blackjack's lobby picture: a lime card back fanned behind the ace of spades. */
import { ART, DETAIL, GameArt, OUTLINE } from '../../platform/components/GameArt';

const ACE_FONT = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10 } as const;

export function BlackjackArt() {
  return (
    <GameArt game="blackjack">
      <g transform="rotate(-14 30 24)">
        <rect x="18" y="6" width="22" height="32" rx="3" fill={ART.lime} {...OUTLINE} />
        <rect x="22" y="10" width="14" height="24" rx="1.5" {...DETAIL} strokeWidth={1.5} />
        <circle cx="29" cy="22" r="4" fill={ART.ink} />
      </g>
      <g transform="rotate(10 38 26)">
        <rect x="28" y="8" width="22" height="32" rx="3" fill={ART.paper} {...OUTLINE} />
        <text x="31.5" y="19" fill={ART.ink} style={ACE_FONT}>
          A
        </text>
        <path d="M39 20l-6 7a3.3 3.3 0 0 0 5 4l1-1.5l1 1.5a3.3 3.3 0 0 0 5-4z" fill={ART.ink} />
        <path d="M39 29v6" fill="none" {...OUTLINE} />
      </g>
    </GameArt>
  );
}
