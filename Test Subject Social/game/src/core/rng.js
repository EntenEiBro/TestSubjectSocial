/**
 * rng.js — the seeded random generator for game simulation.
 *
 * Online rounds run on every player's own device in lockstep: each device
 * simulates the same round from the same inputs. That only works if every
 * random decision that affects the game (layouts, hazards, bots) comes from
 * the same sequence, so all simulation code (minigames, bot AI) must use
 * these helpers instead of Math.random(). Purely cosmetic randomness
 * (texture noise, particles, camera shake, sounds) keeps using Math.random /
 * util.js, because it may run a different number of times on each device.
 *
 * The generator is reseeded at the start of every round (flow.js).
 */

let state = (Math.random() * 0x100000000) >>> 0;

/** Restart the sequence from `seed` (a 32-bit integer). */
export function seedRandom(seed) { state = seed >>> 0; }

/** A fresh random seed (for the host / offline play). */
export const makeSeed = () => (Math.random() * 0x100000000) >>> 0;

/** Next float in [0, 1) — mulberry32: tiny, fast and identical on every JS engine. */
export function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random float in [a, b). */
export const rand = (a = 0, b = 1) => a + random() * (b - a);

/** Random integer in [a, b] (inclusive). */
export const randInt = (a, b) => Math.floor(a + random() * (b - a + 1));

/** Pick one random element from an array. */
export const pick = (arr) => arr[Math.floor(random() * arr.length)];

/** Return a new, Fisher–Yates shuffled copy of `arr`. */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
