/**
 * physics.js — lightweight top-down arena physics shared by most rounds.
 *
 * Avatars are circles on the XZ plane. The {@link Arena} resolves movement,
 * knockback, wall (AABB / circle) collisions, body-to-body separation and
 * the universal "shove" move (button B). No external physics engine needed.
 *
 * Screen-space convention used by every camera in the game: pushing the
 * stick "up" moves toward -Z (away from the camera), "right" moves toward +X.
 */
import * as THREE from 'three';
import { Audio } from './audio.js';
import { Haptics } from './haptics.js';
import { clamp, damp } from './util.js';

/** One avatar living in an arena. */
export class ArenaActor {
  constructor({ player, ctrl, subject, x = 0, z = 0, radius = 0.42, speed = 5.2 }) {
    this.player = player;
    this.ctrl = ctrl;
    this.subject = subject;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.radius = radius;
    this.speed = speed;
    this.speedMul = 1;
    this.facing = 0;       // 0 = +Z = toward the camera
    this.alive = true;
    this.frozen = false;   // ignore input (cutscenes, stunned, seated...)
    this.stun = 0;
    this.stunSeen = 0;     // stun at the end of the last step (to notice new hits for haptics)
    this.shoveCd = 0;
    this.y = 0;            // vertical offset (falling into pits)
    this.vy = 0;
    this.falling = false;
    this.data = {};        // per-minigame scratch space
    subject.root.position.copy(this.pos);
  }

  /** Unit vector the actor is facing. */
  get forward() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  /** Point `dist` units in front of the actor. */
  ahead(dist = 1) { return this.pos.clone().addScaledVector(this.forward, dist); }
}

export class Arena {
  /**
   * @param {object} opts
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} [opts.bounds]
   * @param {boolean} [opts.shove=true] enable B-button shoving
   * @param {number}  [opts.shoveForce=11]
   */
  constructor({ bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, shove = true, shoveForce = 11 } = {}) {
    this.bounds = bounds;
    this.walls = [];    // {minX,maxX,minZ,maxZ}
    this.circles = [];  // {x,z,r}
    this.actors = [];
    this.shoveEnabled = shove;
    this.shoveForce = shoveForce;
    this.onShove = null; // (attacker, victim) => void
  }

  add(actor) { this.actors.push(actor); return actor; }
  addWall(minX, maxX, minZ, maxZ) { const w = { minX, maxX, minZ, maxZ }; this.walls.push(w); return w; }
  removeWall(w) { this.walls = this.walls.filter((x) => x !== w); }
  addCircle(x, z, r) { const c = { x, z, r }; this.circles.push(c); return c; }

  get alive() { return this.actors.filter((a) => a.alive); }

  /** Advance all actors one step. `inputEnabled` false freezes control. */
  step(dt, inputEnabled = true) {
    for (const a of this.actors) {
      if (!a.alive) continue;
      a.shoveCd = Math.max(0, a.shoveCd - dt);
      a.stun = Math.max(0, a.stun - dt);
      const c = a.ctrl;
      const canAct = inputEnabled && !a.frozen && a.stun <= 0 && !a.falling;
      const tx = canAct ? c.moveX * a.speed * a.speedMul : 0;
      const tz = canAct ? c.moveY * a.speed * a.speedMul : 0;
      const k = damp(12, dt);
      a.vel.x += (tx - a.vel.x) * k;
      a.vel.z += (tz - a.vel.z) * k;
      if (canAct && Math.hypot(c.moveX, c.moveY) > 0.2) a.facing = Math.atan2(c.moveX, c.moveY);

      // Shove
      if (canAct && this.shoveEnabled && c.bPressed && a.shoveCd <= 0) this.shove(a);

      // Integrate
      a.pos.x += (a.vel.x + a.knock.x) * dt;
      a.pos.z += (a.vel.z + a.knock.z) * dt;
      a.knock.multiplyScalar(Math.exp(-6 * dt));
      if (a.falling) {
        a.vy -= 25 * dt;
        a.y += a.vy * dt;
      }
    }
    this._separate();
    for (const a of this.actors) {
      // Newly stunned since the last step (shoved, blasted, run over…): the
      // player of this subject feels it — nobody else's phone does.
      if (a.stun > a.stunSeen + 1e-6) Haptics.forPlayer(a.player, a.stun > 0.5 ? 'heavy' : 'hit');
      a.stunSeen = a.stun;
      if (!a.alive) continue;
      if (!a.falling) this._collide(a);
      a.subject.root.position.set(a.pos.x, a.y, a.pos.z);
      a.subject.faceAngle(a.facing, dt);
      a.subject.animate(dt, Math.hypot(a.vel.x, a.vel.z));
    }
  }

  /** Perform a shove from `a`, knocking back anyone in a cone in front. */
  shove(a) {
    a.shoveCd = 0.6;
    a.subject.push();
    Audio.sfx('whoosh', { vol: 0.5 });
    const f = a.forward;
    let hit = false;
    for (const b of this.actors) {
      if (b === a || !b.alive || b.falling) continue;
      const d = b.pos.clone().sub(a.pos); d.y = 0;
      const dist = d.length();
      if (dist > 1.55 || dist < 0.01) continue;
      if (d.clone().normalize().dot(f) < 0.35) continue;
      b.knock.addScaledVector(d.normalize(), this.shoveForce);
      b.stun = 0.35;
      hit = true;
      if (this.onShove) this.onShove(a, b);
    }
    if (hit) { Audio.sfx('shove'); Haptics.forPlayer(a.player, 'click'); } // your shove landed
  }

  _separate() {
    const list = this.actors.filter((a) => a.alive && !a.falling);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  _collide(a) {
    const B = this.bounds;
    a.pos.x = clamp(a.pos.x, B.minX + a.radius, B.maxX - a.radius);
    a.pos.z = clamp(a.pos.z, B.minZ + a.radius, B.maxZ - a.radius);
    for (const w of this.walls) {
      const cx = clamp(a.pos.x, w.minX, w.maxX), cz = clamp(a.pos.z, w.minZ, w.maxZ);
      const dx = a.pos.x - cx, dz = a.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < a.radius) {
        if (d > 1e-5) { a.pos.x = cx + (dx / d) * a.radius; a.pos.z = cz + (dz / d) * a.radius; }
        else { // centre inside the box: push out along the shallowest axis
          const pens = [[a.pos.x - w.minX, -1, 0], [w.maxX - a.pos.x, 1, 0], [a.pos.z - w.minZ, 0, -1], [w.maxZ - a.pos.z, 0, 1]].sort((p, q) => p[0] - q[0]);
          const [pen, nx, nz] = pens[0];
          a.pos.x += nx * (pen + a.radius); a.pos.z += nz * (pen + a.radius);
        }
      }
    }
    for (const c of this.circles) {
      const dx = a.pos.x - c.x, dz = a.pos.z - c.z, d = Math.hypot(dx, dz), min = a.radius + c.r;
      if (d < min && d > 1e-5) { a.pos.x = c.x + (dx / d) * min; a.pos.z = c.z + (dz / d) * min; }
    }
  }

  /** Line-of-sight test against walls (2D segment vs AABB, sampled). */
  clearLine(from, to, step = 0.25) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i < n; i++) {
      const x = from.x + ((to.x - from.x) * i) / n, z = from.z + ((to.z - from.z) * i) / n;
      for (const w of this.walls) if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) return false;
    }
    return true;
  }
}
