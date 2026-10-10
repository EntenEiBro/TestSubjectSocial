/**
 * ai.js — reusable steering helpers for bot-controlled participants.
 *
 * Bots drive the exact same {@link Controller} API as humans, so every helper
 * here simply writes stick/button values. Each minigame composes these into
 * its own `botThink()` routine.
 */
import { rand } from './util.js';

/** Bot skill profile: reaction delay + error rates. Randomized per bot. */
export function makeBrain(difficulty = 0.6) {
  return {
    difficulty,
    reaction: 0.35 - difficulty * 0.25 + rand(-0.05, 0.05), // seconds
    error: 0.25 - difficulty * 0.2,                          // probability of a mistake
    wander: rand(0, Math.PI * 2),
    timer: 0,
    target: null,
    memory: {},
  };
}

/** Steer `actor` toward a world point. Returns the remaining distance. */
export function steerTo(actor, x, z, { arrive = 0.25, slow = 1.2 } = {}) {
  const dx = x - actor.pos.x, dz = z - actor.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) { actor.ctrl.setMove(0, 0); return d; }
  const s = Math.min(1, d / slow);
  actor.ctrl.setMove((dx / d) * s, (dz / d) * s);
  return d;
}

/** Steer away from a point (flee). */
export function fleeFrom(actor, x, z) {
  const dx = actor.pos.x - x, dz = actor.pos.z - z;
  const d = Math.hypot(dx, dz) || 1;
  actor.ctrl.setMove(dx / d, dz / d);
}

/** Random wander inside bounds; call every frame. */
export function wander(actor, brain, dt, bounds) {
  brain.wander += rand(-2, 2) * dt;
  let x = Math.sin(brain.wander), z = Math.cos(brain.wander);
  const p = actor.pos;
  if (bounds) {
    if (p.x < bounds.minX + 1.5) x = Math.abs(x);
    if (p.x > bounds.maxX - 1.5) x = -Math.abs(x);
    if (p.z < bounds.minZ + 1.5) z = Math.abs(z);
    if (p.z > bounds.maxZ - 1.5) z = -Math.abs(z);
    brain.wander = Math.atan2(x, z);
  }
  actor.ctrl.setMove(x * 0.7, z * 0.7);
}

/** Nearest other live actor. */
export function nearest(actor, actors, filter = () => true) {
  let best = null, bd = Infinity;
  for (const o of actors) {
    if (o === actor || !o.alive || !filter(o)) continue;
    const d = Math.hypot(o.pos.x - actor.pos.x, o.pos.z - actor.pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { actor: best, dist: bd } : null;
}

/** Face a target and shove it if close enough (one-shot). */
export function tryShove(actor, target, range = 1.3, chance = 1) {
  const d = Math.hypot(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z);
  if (d < range && Math.random() < chance) {
    actor.facing = Math.atan2(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z);
    actor.ctrl.setButtons(actor.ctrl.rawA, true);
    return true;
  }
  return false;
}

/** Release all buttons (call at the start of a bot's think step). */
export function releaseButtons(ctrl) { ctrl.setButtons(false, false); }
