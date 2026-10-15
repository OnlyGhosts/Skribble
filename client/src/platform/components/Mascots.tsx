/**
 * The two phone characters from branding/pocket-party/assets/brand (phone-bored.svg,
 * phone-happy.svg), inline: flat fills, a solid outline, a hard offset shadow, no screen lines.
 * Decorative only; they sit beside the wordmark on Home and on celebrations, never near controls.
 */
import type { ReactNode } from 'react';

interface Props {
  className?: string;
}

const INK = '#141514';
const SHADOW = '#080908';

function Phone({ fill, className, children }: { fill: string; className?: string; children: ReactNode }) {
  return (
    <svg className={`mascot${className ? ` ${className}` : ''}`} viewBox="0 0 190 270" aria-hidden="true" focusable="false">
      <g stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 119q-30-35-27-9q3 16 26 36M146 118q30-32 28-9q-3 17-26 34" fill={fill} />
        <path d="M68 218l-8 27-22 2m87-29 8 27 20 2" fill="none" />
        <rect x="46" y="20" width="112" height="209" rx="23" fill={SHADOW} stroke="none" />
        <rect x="36" y="12" width="112" height="209" rx="23" fill={fill} />
        <path d="M83 31h20" />
      </g>
      {children}
    </svg>
  );
}

/** Lilac, bored: flat eyes and a short flat mouth. */
export function PhoneBored({ className }: Props) {
  return (
    <Phone fill="#A699D5" className={className}>
      <path d="M61 106h23m24 0h23M88 142h20" stroke={INK} strokeWidth="7" strokeLinecap="round" />
    </Phone>
  );
}

/** Lime, happy: curved eyes and an open smile. */
export function PhoneHappy({ className }: Props) {
  return (
    <Phone fill="#C7E976" className={className}>
      <path d="M65 103q9-16 18 0m25 0q9-16 18 0" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <path d="M78 132h37q-3 31-18 31t-19-31" fill={INK} />
    </Phone>
  );
}

/** Three short lime strokes beside the happy phone, as on the brand board: it is the excited one. */
export function MotionLines({ className }: Props) {
  return (
    <svg className={`mascot-lines${className ? ` ${className}` : ''}`} viewBox="0 0 40 60" aria-hidden="true" focusable="false">
      <path d="M30 6l4 10M8 26h12M10 48l12-8" fill="none" stroke="#C7E976" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
