import { SITE_NAME } from '@shared/platform/site';

const SANS_BOLD_A = 0x1d5d4;
const SANS_BOLD_LOWER_A = 0x1d5ee;
const SANS_BOLD_ZERO = 0x1d7ec;

/** Latin letters and digits in Unicode Mathematical Sans-Serif Bold, so the code stands out in a browser tab. */
export function sansBold(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (ch >= 'A' && ch <= 'Z') return String.fromCodePoint(SANS_BOLD_A + code - 65);
    if (ch >= 'a' && ch <= 'z') return String.fromCodePoint(SANS_BOLD_LOWER_A + code - 97);
    if (ch >= '0' && ch <= '9') return String.fromCodePoint(SANS_BOLD_ZERO + code - 48);
    return ch;
  }).join('');
}

/** The browser tab inside a room: "boredgames.io 🚪 𝟱𝗦𝟲𝟰". */
export function roomTitle(code: string): string {
  return `${SITE_NAME} \u{1F6AA} ${sansBold(code)}`;
}
