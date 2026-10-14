/**
 * The two phone characters from branding/assets (phone-bored.svg, phone-happy.svg), inline and
 * unchanged apart from sizing: flat colour, solid outline, hard offset shadow, no screen lines.
 * Decorative only (empty alt): they support the form and never compete with it.
 */
interface Props {
  className?: string;
}

const INK = '#141514';
const SHADOW = '#090A09';

function Phone({ fill, face, className }: { fill: string; face: string; className?: string }) {
  return (
    <svg className={`mascot${className ? ` ${className}` : ''}`} viewBox="0 0 200 300" aria-hidden="true" focusable="false" role="presentation">
      <ellipse cx="104" cy="279" rx="83" ry="13" fill={SHADOW} />
      <rect x="51" y="28" width="116" height="236" rx="25" fill={SHADOW} />
      <path d="M44 154q-34-43-33-5q4 24 33 37M156 140q32-48 32-9q-4 25-32 43" fill={fill} stroke={INK} strokeWidth="7" strokeLinejoin="round" />
      <rect x="39" y="17" width="116" height="236" rx="25" fill={fill} stroke={INK} strokeWidth="7" />
      <path d="M85 37h27" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <path d={face} fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <ellipse cx="65" cy="257" rx="15" ry="25" fill={fill} stroke={INK} strokeWidth="7" />
      <ellipse cx="130" cy="257" rx="15" ry="25" fill={fill} stroke={INK} strokeWidth="7" />
    </svg>
  );
}

/** Lilac, bored: flat eyes and a short flat mouth. */
export function PhoneBored({ className }: Props) {
  return <Phone fill="#A699D5" face="M65 112h19m32 0h19M90 145h28" className={className} />;
}

/** Lime, happy: curved eyes and a smile. */
export function PhoneHappy({ className }: Props) {
  return <Phone fill="#C7E976" face="M65 107q10-20 20 0m30 0q10-20 20 0M86 140q14 26 28 0" className={className} />;
}
