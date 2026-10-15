/**
 * The two phone characters, from branding/mascots/boredgames-mascots.svg (drawn in Illustrator):
 * flat fills, an ink outline and a hard ink shadow. Both are drawn in that file's coordinates (its
 * 278.81 x 249.91 artboard), the lilac one tilted right behind the lime one tilted left, so the
 * logo's icon is simply the two together. Decorative only; they make the logo's icon and cheer on
 * celebrations, never near controls.
 */

interface Props {
  className?: string;
}

const INK = '#141514';
/** The phone bodies: lilac fill or lime fill with a 6-unit ink outline. */
const OUTLINE = { stroke: INK, strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** Eyes and flat mouths: 7-unit ink strokes. */
const FEATURE = { fill: 'none', stroke: INK, strokeWidth: 7, strokeLinecap: 'round' } as const;

/** The artboard both phones are drawn on. */
export const MASCOTS_VIEWBOX = '0 0 278.81 249.91';
/** Each phone on its own: cropped from the artboard to its outline and shadow, with a unit to spare. */
export const PHONE_BORED_VIEWBOX = '124.6 4 143.6 230.4';
export const PHONE_HAPPY_VIEWBOX = '12.4 5.4 146 229';

/** Lilac, bored: flat eyes and a short flat mouth, tilted right. As SVG content, for the logo. */
export function BoredArt() {
  return (
    <g>
      <rect x="90.98" y="63.51" width="215" height="118" rx="26" fill={INK} transform="translate(52.7 304.58) rotate(-83)" />
      <rect x="138.3" y="11.45" width="112" height="209" rx="23" fill="#A699D5" {...OUTLINE} transform="translate(15.58 -22.82) rotate(7)" />
      <path d="M160.84,101.26l22.83,2.8" {...FEATURE} />
      <path d="M207.49,106.99l22.83,2.8" {...FEATURE} />
      <path d="M181.27,140.04l19.85,2.44" {...FEATURE} />
      <path d="M200.54,24.51l9.82,1.21" fill="none" {...OUTLINE} />
    </g>
  );
}

/** Lime, happy: curved eyes and an open smile, tilted left. As SVG content, for the logo. */
export function HappyArt() {
  return (
    <g>
      <rect x="29.73" y="15.01" width="118" height="215" rx="26" fill={INK} transform="translate(-14.27 11.73) rotate(-7)" />
      <rect x="26.04" y="12.79" width="112" height="209" rx="23" fill="#C7E976" {...OUTLINE} transform="translate(-13.68 10.87) rotate(-7)" />
      <path d="M65.98,27.05l9.82-1.21" fill="none" {...OUTLINE} />
      <path d="M50.12,107.6c4.66-11.32,10.61-12.05,17.87-2.19" {...FEATURE} />
      <path d="M92.8,102.36c4.66-11.32,10.61-12.05,17.87-2.19" {...FEATURE} />
      <path d="M65.57,134.92l36.72-4.51c.53,20.76-4.16,31.74-14.09,32.96s-17.47-8.27-22.64-28.45" fill={INK} />
    </g>
  );
}

function mascotClass(className?: string): string {
  return `mascot${className ? ` ${className}` : ''}`;
}

export function PhoneBored({ className }: Props) {
  return (
    <svg className={mascotClass(className)} viewBox={PHONE_BORED_VIEWBOX} aria-hidden="true" focusable="false">
      <BoredArt />
    </svg>
  );
}

export function PhoneHappy({ className }: Props) {
  return (
    <svg className={mascotClass(className)} viewBox={PHONE_HAPPY_VIEWBOX} aria-hidden="true" focusable="false">
      <HappyArt />
    </svg>
  );
}
