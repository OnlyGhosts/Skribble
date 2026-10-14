import { describe, expect, it } from 'vitest';
import { CONTENT_MODES } from '../../platform/settings.js';
import { CHEEKY_LOCATIONS, UNHINGED_LOCATIONS } from './locationTiers.js';
import { ALL_SPY_LOCATIONS, SPY_LOCATIONS, drawCandidates, isLocationId, locationById, locationsForMode, pickLocation } from './locations.js';
import { SPYGAME_CANDIDATES } from './protocol.js';

/** A deterministic [0, 1) sequence so shuffles are reproducible but not degenerate. */
function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

describe('the location pack', () => {
  it('holds at least 60 everyday places with unique, file-safe ids and unique names', () => {
    expect(SPY_LOCATIONS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(SPY_LOCATIONS.map((l) => l.id)).size).toBe(SPY_LOCATIONS.length);
    expect(new Set(SPY_LOCATIONS.map((l) => l.name)).size).toBe(SPY_LOCATIONS.length);
    for (const l of SPY_LOCATIONS) {
      expect(l.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.emoji.length).toBeGreaterThan(0);
      expect(l.hue).toBeGreaterThanOrEqual(0);
      expect(l.hue).toBeLessThan(360);
    }
    expect(locationById('beach')).toMatchObject({ name: 'Beach' });
    expect(isLocationId('nowhere')).toBe(false);
  });

  it('adds the cheeky and unhinged tiers in an Unhinged room, with unique ids and names across every tier', () => {
    expect(locationsForMode('family')).toEqual(SPY_LOCATIONS);
    expect(locationsForMode('unhinged')).toEqual([...SPY_LOCATIONS, ...CHEEKY_LOCATIONS, ...UNHINGED_LOCATIONS]);
    expect(CHEEKY_LOCATIONS.length).toBeGreaterThanOrEqual(10);
    expect(UNHINGED_LOCATIONS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ALL_SPY_LOCATIONS.map((l) => l.id)).size).toBe(ALL_SPY_LOCATIONS.length);
    expect(new Set(ALL_SPY_LOCATIONS.map((l) => l.name)).size).toBe(ALL_SPY_LOCATIONS.length);
    for (const l of ALL_SPY_LOCATIONS) {
      expect(l.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(l.hue).toBeGreaterThanOrEqual(0);
      expect(l.hue).toBeLessThan(360);
      // Every tier's location resolves by id (the client names candidates that way).
      expect(locationById(l.id)).toBe(l);
    }
    for (const mode of CONTENT_MODES) expect(locationsForMode(mode).length).toBeGreaterThanOrEqual(SPYGAME_CANDIDATES);
    expect(isLocationId('strip-club')).toBe(true);
    expect(SPY_LOCATIONS.some((l) => l.id === 'strip-club')).toBe(false);
  });

  it('draws candidates and picks locations from the pool it is given', () => {
    const pool = locationsForMode('unhinged');
    const rng = lcg(5);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) for (const id of drawCandidates('strip-club', SPYGAME_CANDIDATES, rng, pool)) seen.add(id);
    expect(seen.has('sex-shop')).toBe(true);
    // The family pool never draws a tier location, as a decoy or as the pick.
    for (let i = 0; i < 20; i++) {
      for (const id of drawCandidates('beach', SPYGAME_CANDIDATES, rng)) expect(SPY_LOCATIONS.some((l) => l.id === id)).toBe(true);
      expect(SPY_LOCATIONS).toContain(pickLocation([], rng));
    }
    expect(pickLocation(SPY_LOCATIONS.map((l) => l.id), () => 0, pool).id).toBe(CHEEKY_LOCATIONS[0].id);
  });

  it('draws 24 unique candidates that always include the real location, from any rng', () => {
    for (const rng of [() => 0, () => 0.999, lcg(1), lcg(42), lcg(7)]) {
      for (const real of ['airplane', 'zoo', 'hospital']) {
        const candidates = drawCandidates(real, SPYGAME_CANDIDATES, rng);
        expect(candidates).toHaveLength(SPYGAME_CANDIDATES);
        expect(new Set(candidates).size).toBe(SPYGAME_CANDIDATES);
        expect(candidates).toContain(real);
        for (const id of candidates) expect(isLocationId(id)).toBe(true);
      }
    }
  });

  it('places the real location anywhere in the list, not always at the same spot', () => {
    const rng = lcg(3);
    const positions = new Set<number>();
    for (let i = 0; i < 40; i++) positions.add(drawCandidates('casino', SPYGAME_CANDIDATES, rng).indexOf('casino'));
    expect(positions.size).toBeGreaterThan(5);
  });

  it('avoids used locations until the pack runs out, then reuses it', () => {
    const used = SPY_LOCATIONS.slice(0, -1).map((l) => l.id);
    expect(pickLocation(used, () => 0).id).toBe(SPY_LOCATIONS.at(-1)?.id);
    expect(pickLocation(used, () => 0.99).id).toBe(SPY_LOCATIONS.at(-1)?.id);
    expect(pickLocation(SPY_LOCATIONS.map((l) => l.id), () => 0).id).toBe(SPY_LOCATIONS[0].id);
  });
});
