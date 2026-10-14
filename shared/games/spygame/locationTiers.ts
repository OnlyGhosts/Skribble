/**
 * Extra Spy Game locations for an Unhinged room, in two tiers: 'cheeky' (rude but harmless) and
 * 'unhinged' (explicit 18+ places: sex, drink and drugs, bodily fluids, death). Ids double as image
 * file names (client/src/games/spygame/assets/locations); re-run scripts/spygame-location-images.mjs
 * after editing. The pool for a mode is built in ./locations.ts (locationsForMode).
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
  { id: 'sex-shop-stockroom', name: 'Sex Shop Stockroom', emoji: '🍆', hue: 290 },
  { id: 'stag-do-in-magaluf', name: 'Stag Do in Magaluf', emoji: '🍻', hue: 35 },
  { id: 'sti-clinic-waiting-room', name: 'STI Clinic Waiting Room', emoji: '🩺', hue: 170 },
  { id: 'crematorium-after-party', name: 'Crematorium After-Party', emoji: '⚱️', hue: 25 },
  { id: 'strip-club-changing-room', name: 'Strip Club Changing Room', emoji: '💃', hue: 305 },
  { id: 'swingers-key-party', name: "Swingers' Key Party", emoji: '🔑', hue: 48 },
  { id: 'dogging-car-park', name: 'Dogging Car Park', emoji: '🚗', hue: 215 },
  { id: 'porn-film-set', name: 'Porn Film Set', emoji: '🎬', hue: 350 },
  { id: 'fetish-club-dungeon', name: 'Fetish Club Dungeon', emoji: '⛓️', hue: 0 },
  { id: 'police-cells-at-two-am', name: 'Police Cells at 2am', emoji: '🚔', hue: 228 },
  { id: 'rehab-group-session', name: 'Rehab Group Session', emoji: '🪑', hue: 150 },
  { id: 'a-and-e-on-a-saturday', name: 'A&E on a Saturday', emoji: '🚑', hue: 8 },
  { id: 'sperm-bank-wank-room', name: 'Sperm Bank Wank Room', emoji: '🧪', hue: 192 },
  { id: 'nudist-campsite', name: 'Nudist Campsite', emoji: '🏕️', hue: 105 },
  { id: 'kebab-shop-at-three-am', name: 'Kebab Shop at 3am', emoji: '🥙', hue: 30 },
  { id: 'festival-portaloo', name: 'Festival Portaloo', emoji: '🚽', hue: 80 },
  { id: 'hen-do-in-blackpool', name: 'Hen Do in Blackpool', emoji: '👰', hue: 322 },
  { id: 'wake-in-a-wetherspoons', name: 'Wake in a Wetherspoons', emoji: '🍺', hue: 42 },
  { id: 'morgue-night-shift', name: 'Morgue Night Shift', emoji: '🧊', hue: 200 },
  { id: 'swingers-cruise', name: "Swingers' Cruise", emoji: '🛳️', hue: 184 },
  { id: 'mums-sex-toy-party', name: "Mum's Sex Toy Party", emoji: '🎉', hue: 332 },
  { id: 'vasectomy-clinic', name: 'Vasectomy Clinic', emoji: '✂️', hue: 262 },
  { id: 'embalming-room', name: 'Embalming Room', emoji: '⚰️', hue: 272 },
  { id: 'rave-toilet-cubicle', name: 'Toilets at a Rave', emoji: '💊', hue: 282 },
];
