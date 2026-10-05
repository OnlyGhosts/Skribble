/**
 * The Spy Game's location pack and the pure draws over it. Every location has a generated tile
 * (client/src/games/spygame/assets/locations/<id>.svg) built from `emoji` and `hue`; a photo
 * dropped next to it with the same id takes precedence.
 */

export interface SpyLocation {
  /** Lowercase letters and dashes; doubles as the image file name. */
  id: string;
  name: string;
  emoji: string;
  /** 0-359: the tile's gradient hue. */
  hue: number;
}

export const SPY_LOCATIONS: readonly SpyLocation[] = [
  { id: 'airplane', name: 'Airplane', emoji: '✈️', hue: 205 },
  { id: 'airport', name: 'Airport', emoji: '🛫', hue: 215 },
  { id: 'amusement-park', name: 'Amusement Park', emoji: '🎢', hue: 330 },
  { id: 'aquarium', name: 'Aquarium', emoji: '🐠', hue: 190 },
  { id: 'art-museum', name: 'Art Museum', emoji: '🖼️', hue: 280 },
  { id: 'bakery', name: 'Bakery', emoji: '🥐', hue: 35 },
  { id: 'bank', name: 'Bank', emoji: '🏦', hue: 150 },
  { id: 'barbershop', name: 'Barbershop', emoji: '💈', hue: 355 },
  { id: 'beach', name: 'Beach', emoji: '🏖️', hue: 45 },
  { id: 'bowling-alley', name: 'Bowling Alley', emoji: '🎳', hue: 260 },
  { id: 'bus', name: 'City Bus', emoji: '🚌', hue: 25 },
  { id: 'campsite', name: 'Campsite', emoji: '🏕️', hue: 120 },
  { id: 'carnival', name: 'Carnival', emoji: '🎪', hue: 345 },
  { id: 'casino', name: 'Casino', emoji: '🎰', hue: 0 },
  { id: 'castle', name: 'Castle', emoji: '🏰', hue: 230 },
  { id: 'cathedral', name: 'Cathedral', emoji: '⛪', hue: 40 },
  { id: 'cemetery', name: 'Cemetery', emoji: '🪦', hue: 200 },
  { id: 'circus', name: 'Circus', emoji: '🤹', hue: 10 },
  { id: 'coffee-shop', name: 'Coffee Shop', emoji: '☕', hue: 30 },
  { id: 'concert', name: 'Rock Concert', emoji: '🎸', hue: 290 },
  { id: 'construction-site', name: 'Construction Site', emoji: '🏗️', hue: 40 },
  { id: 'courtroom', name: 'Courtroom', emoji: '⚖️', hue: 25 },
  { id: 'cruise-ship', name: 'Cruise Ship', emoji: '🛳️', hue: 210 },
  { id: 'dentist', name: 'Dentist', emoji: '🦷', hue: 195 },
  { id: 'desert', name: 'Desert', emoji: '🏜️', hue: 35 },
  { id: 'farm', name: 'Farm', emoji: '🚜', hue: 95 },
  { id: 'fire-station', name: 'Fire Station', emoji: '🚒', hue: 5 },
  { id: 'football-stadium', name: 'Football Stadium', emoji: '🏟️', hue: 130 },
  { id: 'forest', name: 'Forest', emoji: '🌲', hue: 140 },
  { id: 'gas-station', name: 'Gas Station', emoji: '⛽', hue: 15 },
  { id: 'gym', name: 'Gym', emoji: '🏋️', hue: 250 },
  { id: 'hair-salon', name: 'Hair Salon', emoji: '💇', hue: 320 },
  { id: 'hospital', name: 'Hospital', emoji: '🏥', hue: 185 },
  { id: 'hotel', name: 'Hotel', emoji: '🏨', hue: 270 },
  { id: 'ice-rink', name: 'Ice Rink', emoji: '⛸️', hue: 200 },
  { id: 'jungle', name: 'Jungle', emoji: '🦜', hue: 110 },
  { id: 'kindergarten', name: 'Kindergarten', emoji: '🧸', hue: 50 },
  { id: 'laundromat', name: 'Laundromat', emoji: '🧺', hue: 180 },
  { id: 'library', name: 'Library', emoji: '📚', hue: 20 },
  { id: 'lighthouse', name: 'Lighthouse', emoji: '🗼', hue: 220 },
  { id: 'movie-theater', name: 'Movie Theater', emoji: '🎬', hue: 350 },
  { id: 'mountain-cabin', name: 'Mountain Cabin', emoji: '🏔️', hue: 170 },
  { id: 'night-club', name: 'Night Club', emoji: '🪩', hue: 300 },
  { id: 'office', name: 'Office', emoji: '🖨️', hue: 225 },
  { id: 'opera-house', name: 'Opera House', emoji: '🎭', hue: 340 },
  { id: 'pirate-ship', name: 'Pirate Ship', emoji: '🏴‍☠️', hue: 15 },
  { id: 'pizzeria', name: 'Pizzeria', emoji: '🍕', hue: 12 },
  { id: 'playground', name: 'Playground', emoji: '🛝', hue: 60 },
  { id: 'police-station', name: 'Police Station', emoji: '🚓', hue: 235 },
  { id: 'polar-station', name: 'Polar Station', emoji: '🐧', hue: 195 },
  { id: 'post-office', name: 'Post Office', emoji: '📮', hue: 0 },
  { id: 'prison', name: 'Prison', emoji: '🔒', hue: 210 },
  { id: 'race-track', name: 'Race Track', emoji: '🏁', hue: 355 },
  { id: 'restaurant', name: 'Restaurant', emoji: '🍽️', hue: 20 },
  { id: 'school', name: 'School', emoji: '🏫', hue: 45 },
  { id: 'ski-resort', name: 'Ski Resort', emoji: '⛷️', hue: 205 },
  { id: 'space-station', name: 'Space Station', emoji: '🛰️', hue: 255 },
  { id: 'spa', name: 'Spa', emoji: '🧖', hue: 160 },
  { id: 'submarine', name: 'Submarine', emoji: '🤿', hue: 200 },
  { id: 'subway', name: 'Subway', emoji: '🚇', hue: 240 },
  { id: 'supermarket', name: 'Supermarket', emoji: '🛒', hue: 90 },
  { id: 'swimming-pool', name: 'Swimming Pool', emoji: '🏊', hue: 190 },
  { id: 'sushi-bar', name: 'Sushi Bar', emoji: '🍣', hue: 350 },
  { id: 'train', name: 'Passenger Train', emoji: '🚆', hue: 215 },
  { id: 'university', name: 'University', emoji: '🎓', hue: 230 },
  { id: 'vineyard', name: 'Vineyard', emoji: '🍇', hue: 285 },
  { id: 'wedding', name: 'Wedding', emoji: '💒', hue: 325 },
  { id: 'zoo', name: 'Zoo', emoji: '🦁', hue: 70 },
];

const BY_ID = new Map<string, SpyLocation>(SPY_LOCATIONS.map((l) => [l.id, l]));

export function locationById(id: string): SpyLocation | undefined {
  return BY_ID.get(id);
}

export function isLocationId(id: string): boolean {
  return BY_ID.has(id);
}

/** Uniform pick from a non-empty list with a [0, 1) rng. */
function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Fisher-Yates in place. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A location not used this game while any remain; the pack is reused once exhausted. */
export function pickLocation(usedIds: readonly string[], rng: () => number): SpyLocation {
  const fresh = SPY_LOCATIONS.filter((l) => !usedIds.includes(l.id));
  return pickOne(fresh.length > 0 ? fresh : SPY_LOCATIONS, rng);
}

/** The real location plus `count - 1` random decoys, shuffled once so everyone sees the same order. */
export function drawCandidates(realId: string, count: number, rng: () => number): string[] {
  const decoys = shuffle(
    SPY_LOCATIONS.filter((l) => l.id !== realId).map((l) => l.id),
    rng,
  ).slice(0, Math.max(0, count - 1));
  return shuffle([realId, ...decoys], rng);
}
