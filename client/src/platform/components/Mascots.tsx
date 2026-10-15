/**
 * The two phone characters from branding/pocket-party/assets/brand (phone-bored.svg,
 * phone-happy.svg), inline: flat fills, a solid outline, a hard offset shadow, no screen lines.
 * Decorative only; they make the logo's icon and cheer on celebrations, never near controls.
 */
import type { ReactNode } from 'react';

interface Props {
  className?: string;
}

const INK = '#141514';
const SHADOW = '#080908';
/** Both phones are drawn on a 190 x 270 artboard. */
const VIEWBOX = '0 0 190 270';

function PhoneArt({ fill, children }: { fill: string; children: ReactNode }) {
  return (
    <>
      <g stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 119q-30-35-27-9q3 16 26 36M146 118q30-32 28-9q-3 17-26 34" fill={fill} />
        <path d="M68 218l-8 27-22 2m87-29 8 27 20 2" fill="none" />
        <rect x="46" y="20" width="112" height="209" rx="23" fill={SHADOW} stroke="none" />
        <rect x="36" y="12" width="112" height="209" rx="23" fill={fill} />
        <path d="M83 31h20" />
      </g>
      {children}
    </>
  );
}

/** Lilac, bored: flat eyes and a short flat mouth. As SVG content, for the logo. */
export function BoredArt() {
  return (
    <PhoneArt fill="#A699D5">
      <path d="M61 106h23m24 0h23M88 142h20" stroke={INK} strokeWidth="7" strokeLinecap="round" />
    </PhoneArt>
  );
}

/** Lime, happy: curved eyes and an open smile. As SVG content, for the logo. */
export function HappyArt() {
  return (
    <PhoneArt fill="#C7E976">
      <path d="M65 103q9-16 18 0m25 0q9-16 18 0" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <path d="M78 132h37q-3 31-18 31t-19-31" fill={INK} />
    </PhoneArt>
  );
}

function mascotClass(className?: string): string {
  return `mascot${className ? ` ${className}` : ''}`;
}

export function PhoneBored({ className }: Props) {
  return (
    <svg className={mascotClass(className)} viewBox={VIEWBOX} aria-hidden="true" focusable="false">
      <BoredArt />
    </svg>
  );
}

export function PhoneHappy({ className }: Props) {
  return (
    <svg className={mascotClass(className)} viewBox={VIEWBOX} aria-hidden="true" focusable="false">
      <HappyArt />
    </svg>
  );
}
