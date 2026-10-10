/**
 * util.js — small, dependency-free helpers shared by every module.
 *
 * Nothing in here knows about Three.js or the game; keep it that way so the
 * helpers stay trivially reusable and testable.
 */

/** Clamp `v` into the inclusive range [lo, hi]. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear interpolation between a and b by t (0..1). */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

/** Random float in [a, b). */
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

/** Random integer in [a, b] (inclusive). */
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

/** Pick one random element from an array. */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Return a new, Fisher–Yates shuffled copy of `arr`. */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shortest signed difference between two angles (radians). */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Distance between two {x, z} points on the ground plane. */
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Promise that resolves after `ms` milliseconds. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Format seconds as M:SS. */
export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * Tiny countdown/interval helper used by minigames for "every N seconds"
 * events. Call `tick(dt)`; it returns true on the frame the timer fires.
 */
export class Timer {
  constructor(duration, { repeat = false } = {}) {
    this.duration = duration;
    this.repeat = repeat;
    this.t = 0;
    this.done = false;
  }
  get remaining() { return Math.max(0, this.duration - this.t); }
  get progress() { return clamp(this.t / this.duration, 0, 1); }
  reset(duration = this.duration) { this.duration = duration; this.t = 0; this.done = false; }
  tick(dt) {
    if (this.done) return false;
    this.t += dt;
    if (this.t >= this.duration) {
      if (this.repeat) this.t -= this.duration; else this.done = true;
      return true;
    }
    return false;
  }
}

/** Read typed URL query parameters (used for debug / quick-launch). */
export function queryParams() {
  const p = new URLSearchParams(location.search);
  return {
    get: (k, def = null) => (p.has(k) ? p.get(k) : def),
    has: (k) => p.has(k),
    int: (k, def) => (p.has(k) ? parseInt(p.get(k), 10) : def),
  };
}
