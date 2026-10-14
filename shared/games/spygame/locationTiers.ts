/**
 * Extra Spy Game locations for an Unhinged room, in two tiers: 'cheeky' (rude but harmless) and
 * 'unhinged' (crude). Ids double as image file names (client/src/games/spygame/assets/locations);
 * re-run scripts/spygame-location-images.mjs after editing. The pool for a mode is built in
 * ./locations.ts (locationsForMode).
 */
import type { SpyLocation } from './locations.js';

export const CHEEKY_LOCATIONS: readonly SpyLocation[] = [
  { id: 'tattoo-parlour', name: 'Tattoo Parlour', emoji: '🪡', hue: 330 },
  { id: 'nightclub', name: 'Nightclub', emoji: '🪩', hue: 280 },
  { id: 'stag-party', name: 'Stag Party', emoji: '🍻', hue: 40 },
  { id: 'hen-party', name: 'Hen Party', emoji: '💃', hue: 320 },
  { id: 'nudist-beach', name: 'Nudist Beach', emoji: '🩲', hue: 190 },
  { id: 'hot-tub-party', name: 'Hot Tub Party', emoji: '🛁', hue: 200 },
  { id: 'waxing-salon', name: 'Waxing Salon', emoji: '🪒', hue: 350 },
  { id: 'speed-dating', name: 'Speed Dating', emoji: '💘', hue: 340 },
  { id: 'karaoke-bar', name: 'Karaoke Bar', emoji: '🎤', hue: 260 },
  { id: 'tinder-date', name: 'First Tinder Date', emoji: '🔥', hue: 10 },
  { id: 'wedding-after-party', name: 'Wedding After-Party', emoji: '🥂', hue: 50 },
  { id: 'strip-poker-night', name: 'Strip Poker Night', emoji: '🃏', hue: 0 },
];

export const UNHINGED_LOCATIONS: readonly SpyLocation[] = [
  { id: 'strip-club', name: 'Strip Club', emoji: '💃', hue: 300 },
  { id: 'sex-shop', name: 'Sex Shop', emoji: '🍆', hue: 290 },
  { id: 'swingers-party', name: 'Swingers Party', emoji: '🔑', hue: 20 },
  { id: 'drunk-tank', name: 'Drunk Tank', emoji: '🚔', hue: 220 },
  { id: 'adult-film-set', name: 'Adult Film Set', emoji: '🎬', hue: 350 },
  { id: 'sex-dungeon', name: 'Sex Dungeon', emoji: '⛓️', hue: 0 },
  { id: 'hangover-hotel-room', name: 'Hangover Hotel Room', emoji: '🤢', hue: 90 },
  { id: 'rehab-clinic', name: 'Rehab Clinic', emoji: '🩺', hue: 170 },
  { id: 'red-light-district', name: 'Red Light District', emoji: '🔴', hue: 355 },
  { id: 'massage-parlour', name: 'Massage Parlour', emoji: '💆', hue: 30 },
  { id: 'nudist-colony', name: 'Nudist Colony', emoji: '🌞', hue: 45 },
  { id: 'the-morning-after', name: 'The Morning After', emoji: '🥴', hue: 60 },
];
