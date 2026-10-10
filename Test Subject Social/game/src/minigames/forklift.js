/**
 * FORKLIFT FRENZY — warehouse logistics with a performance review at the end.
 *
 * Rules:
 *  - Every subject drives a small forklift. The stick sets the heading you
 *    want; the forklift turns toward it at a limited rate and accelerates
 *    with some inertia (it slows down while turning hard).
 *  - A raises / lowers the forks: with an empty fork in front of a crate it
 *    picks the crate up, while loaded it sets the crate down in front.
 *  - Each subject owns a painted deposit zone in a corner. Crates resting in
 *    your zone are your score — steal from rival zones freely. Crates can
 *    also be bulldozed.
 *  - B = horn + bump: shoves forklifts in front of you and knocks their
 *    crate off the forks. Forklifts collide and push each other.
 *  - After 45 s the subject(s) with the fewest crates are flattened by a
 *    crate dropped from the ceiling. Ties for last all die.
 */
import * as THREE from 'three';
import { Minigame, rankByScore } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, playerRing } from '../core/environment.js';
import { Tex, mat, glow, textTexture } from '../core/textures.js';
import { rand, clamp, angleDiff, dist2D, damp } from '../core/util.js';

const HALF_W = 11, MIN_Z = -7, MAX_Z = 6.5;
const ROUND_TIME = 45;
const ZONE = 4;                   // deposit zone side length
const FL_R = 0.8;                 // forklift body radius (centre slightly behind pos)
const CRATE = 0.9, CRATE_R = 0.5;
const MAX_SPEED = 6.2, ACCEL = 7, DECEL = 9, TURN_RATE = 3.4;
const FORK_REACH = 1.25;          // fork pick point ahead of the forklift centre
const START_CRATES = 10, MAX_CRATES = 24, SPAWN_EVERY = 3;
const GRAVITY = 26;

/** Build the forklift mesh (forward = +Z). Returns parts that animate. */
function buildForklift(color) {
  const g = new THREE.Group();
  const paint = mat(new THREE.Color(color), Tex.metal());
  const dark = mat(0x2a2b28, Tex.metal());
  const black = mat(0x141414);
  const add = (geo, m, x, y, z) => { const o = mesh(geo, m, x, y, z); g.add(o); return o; };
  add(new THREE.BoxGeometry(1.1, 0.5, 1.5), paint, 0, 0.5, -0.1);
  add(new THREE.BoxGeometry(1.12, 0.65, 0.42), dark, 0, 0.62, -0.88);
  add(new THREE.BoxGeometry(1.0, 0.05, 0.25), mat(0xffffff, Tex.hazard()), 0, 0.78, 0.55);
  for (const [x, z] of [[-0.56, 0.42], [0.56, 0.42], [-0.56, -0.62], [0.56, -0.62]]) {
    const w = add(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 10), black, x, 0.25, z);
    w.rotation.z = Math.PI / 2;
  }
  add(new THREE.BoxGeometry(0.5, 0.12, 0.45), black, 0, 0.81, -0.35);
  add(new THREE.BoxGeometry(0.5, 0.5, 0.1), black, 0, 1.05, -0.6);
  // Open overhead guard (bars only, so the top-down camera still sees the driver)
  for (const [x, z] of [[-0.5, 0.25], [0.5, 0.25], [-0.5, -0.8], [0.5, -0.8]]) add(new THREE.BoxGeometry(0.06, 1.95, 0.06), dark, x, 1.3, z);
  add(new THREE.BoxGeometry(1.06, 0.06, 0.06), dark, 0, 2.27, 0.25);
  add(new THREE.BoxGeometry(1.06, 0.06, 0.06), dark, 0, 2.27, -0.8);
  add(new THREE.BoxGeometry(0.06, 0.06, 1.1), paint, -0.5, 2.27, -0.27);
  add(new THREE.BoxGeometry(0.06, 0.06, 1.1), paint, 0.5, 2.27, -0.27);
  // Mast
  add(new THREE.BoxGeometry(0.09, 2.0, 0.09), dark, -0.36, 1.05, 0.72);
  add(new THREE.BoxGeometry(0.09, 2.0, 0.09), dark, 0.36, 1.05, 0.72);
  add(new THREE.BoxGeometry(0.8, 0.08, 0.08), dark, 0, 2.05, 0.72);
  // Carriage + forks (moves vertically)
  const carriage = new THREE.Group();
  carriage.position.set(0, 0.15, 0.8);
  carriage.add(mesh(new THREE.BoxGeometry(0.78, 0.4, 0.05), dark, 0, 0.2, 0));
  carriage.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.95), mat(0x8a8d88, Tex.metal()), -0.24, 0.0, 0.47));
  carriage.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.95), mat(0x8a8d88, Tex.metal()), 0.24, 0.0, 0.47));
  g.add(carriage);
  return { g, carriage };
}

export class ForkliftFrenzy extends Minigame {
  static meta = {
    id: 'forklift',
    title: 'FORKLIFT FRENZY',
    tagline: 'Lowest output gets a crate. From above.',
    category: 'Competitive',
    controls: [{ input: 'move', label: 'Steer / Drive' }, { input: 'a', label: 'Forks up / down' }, { input: 'b', label: 'Horn + bump' }],
    objective: 'Have the most crates in your zone when the shift ends — and never the fewest.',
    rules: [
      'Point the stick where you want to go; the forklift turns and accelerates.',
      'A lifts a crate in front of the forks, A again sets it down.',
      'Crates in your coloured zone score. Stealing is encouraged. B honks and bumps.',
      'After 45 s the lowest scorer is crushed. Ties for last are crushed together.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 24, fogFar: 60 });
    this.makeCamera([0, 20, 13.5], [0, 0, -0.3], 50);

    floor(scene, 50, 40, { tex: 'concrete', tile: 3 });
    floor(scene, HALF_W * 2, MAX_Z - MIN_Z, { tex: 'plate', tile: 2, y: 0.004, z: (MIN_Z + MAX_Z) / 2 });
    this._buildWarehouse(scene);

    hangingLamp(scene, -4, 8, -5.5, { intensity: 100, angle: 1.0, target: { x: -5, y: 0, z: -1 } });
    hangingLamp(scene, 4, 8, -5.5, { intensity: 100, angle: 1.0, target: { x: 5, y: 0, z: -1 } });
    hangingLamp(scene, -5.5, 8, 3.5, { intensity: 70, angle: 0.95, shadow: false });
    hangingLamp(scene, 5.5, 8, 3.5, { intensity: 70, angle: 0.95, shadow: false });

    // Deposit zones in the corners
    const zx = HALF_W - ZONE / 2 - 0.3, zTop = MIN_Z + ZONE / 2 + 0.3, zBot = MAX_Z - ZONE / 2 - 0.3;
    const corners = [[-zx, zTop], [zx, zTop], [-zx, zBot], [zx, zBot]];
    this.zones = this.seats.map((seat, i) => this._buildZone(scene, seat, ...corners[i]));

    this.forklifts = [];
    this.seats.forEach((seat, i) => {
      const zone = this.zones[i];
      const x = zone.x * 0.62, z = zone.z * 0.55;
      const { g, carriage } = buildForklift(seat.player.color);
      const s = this.spawnSubject(seat, { x: 0, z: 0, ring: false, facing: 0 });
      g.add(s.root);
      s.root.position.set(0, 0.02, -0.33);
      s.root.rotation.y = 0;
      s.pose = 'sit';
      const ring = playerRing(seat.player.color);
      ring.scale.setScalar(2.1);
      g.add(ring);
      scene.add(g);
      const fl = { seat, g, carriage, x, z, h: Math.atan2(-x, -z), v: 0, px: 0, pz: 0, forkUp: false, forkY: 0.15, carry: null, hornCd: 0, stun: 0, dead: false };
      seat.fl = fl;
      seat.zone = zone;
      seat.certified = false;
      this.forklifts.push(fl);
      this._placeForklift(fl);
    });

    this.crates = [];
    for (let i = 0; i < START_CRATES; i++) this._spawnCrate(false);
    this.spawnT = 0;
    this.drops = [];   // execution crates
  }

  // ------------------------------------------------------------------ stage

  _buildWarehouse(scene) {
    const wallMat = mat(0xffffff, Tex.wall([6, 1.5]));
    block(scene, 0, 2.5, MIN_Z - 1.6, HALF_W * 2 + 3, 5, 0.3, wallMat);
    block(scene, -HALF_W - 0.3, 0.5, (MIN_Z + MAX_Z) / 2, 0.4, 1.0, MAX_Z - MIN_Z, mat(0xffffff, Tex.hazard([1, 8])));
    block(scene, HALF_W + 0.3, 0.5, (MIN_Z + MAX_Z) / 2, 0.4, 1.0, MAX_Z - MIN_Z, mat(0xffffff, Tex.hazard([1, 8])));
    block(scene, 0, 0.3, MIN_Z - 0.2, HALF_W * 2 + 0.6, 0.6, 0.4, mat(0xffffff, Tex.hazard([10, 1])));
    stencil(scene, 'STACK', 0, 3.6, MIN_Z - 1.44, { w: 6, h: 1.8, opacity: 0.55 });
    // Shelving racks against the back wall, loosely stocked
    const rackMat = mat(0x2f4f7f, Tex.metal());
    const crateMat = mat(0xffffff, Tex.crate());
    for (const rx of [-7.5, 7.5]) {
      for (const dx of [-2.2, 2.2]) block(scene, rx + dx, 2, MIN_Z - 1.0, 0.12, 4, 0.9, rackMat);
      for (const y of [0.15, 1.5, 2.85]) {
        block(scene, rx, y, MIN_Z - 1.0, 4.5, 0.1, 0.9, mat(0x8a5a2a, Tex.wood()));
        for (let k = -1; k <= 1; k++) if (Math.random() < 0.7) scene.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateMat, rx + k * 1.3, y + 0.45, MIN_Z - 1.0));
      }
    }
  }

  _buildZone(scene, seat, x, z) {
    const color = new THREE.Color(seat.player.color);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(ZONE, ZONE), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.012, z);
    scene.add(pad);
    const edge = glow(color);
    for (const [ex, ez, w, d] of [[0, -ZONE / 2, ZONE, 0.12], [0, ZONE / 2, ZONE, 0.12], [-ZONE / 2, 0, 0.12, ZONE], [ZONE / 2, 0, 0.12, ZONE]]) {
      const b = mesh(new THREE.BoxGeometry(w, 0.02, d), edge, x + ex, 0.02, z + ez, { cast: false });
      scene.add(b);
    }
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: textTexture(`P${seat.player.slot + 1}`, { w: 128, h: 64, size: 54, color: seat.player.color }), transparent: true, opacity: 0.6, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, 0.02, z);
    scene.add(label);
    return { x, z, half: ZONE / 2, seat };
  }

  _inZone(p, zone, margin = 0) {
    return Math.abs(p.x - zone.x) < zone.half - margin && Math.abs(p.z - zone.z) < zone.half - margin;
  }

  /** Add a crate in the middle of the floor, optionally dropping from the ceiling. */
  _spawnCrate(fromAbove = true) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = rand(-4.5, 4.5); z = rand(-3.5, 3);
      if (this.crates.every((c) => Math.hypot(c.x - x, c.z - z) > 1.2) && this.forklifts.every((f) => Math.hypot(f.x - x, f.z - z) > 1.8)) break;
    }
    const m = mesh(new THREE.BoxGeometry(CRATE, CRATE, CRATE), mat(0xffffff, Tex.crate()), x, 0, z);
    m.rotation.y = rand(-0.3, 0.3);
    this.scene.add(m);
    const c = { m, x, z, y: fromAbove ? 7 : 0, vy: 0, carrier: null, falling: fromAbove };
    this.crates.push(c);
    this._placeCrate(c);
    return c;
  }

  _placeCrate(c) { c.m.position.set(c.x, c.y + CRATE / 2, c.z); }

  _placeForklift(fl) {
    fl.g.position.set(fl.x, 0, fl.z);
    fl.g.rotation.y = fl.h;
    fl.carriage.position.y = fl.forkY;
  }

  // ---------------------------------------------------------------- physics

  /** Drive one forklift from its controller (heading-seeking steering with inertia). */
  _drive(fl, dt, input) {
    const c = fl.seat.ctrl;
    fl.stun = Math.max(0, fl.stun - dt);
    fl.hornCd = Math.max(0, fl.hornCd - dt);
    const mag = Math.min(1, Math.hypot(c.moveX, c.moveY));
    let targetV = 0;
    if (input && !fl.dead && fl.stun <= 0 && mag > 0.2) {
      const want = Math.atan2(c.moveX, c.moveY);
      const diff = angleDiff(fl.h, want);
      const turn = TURN_RATE * dt;
      fl.h += clamp(diff, -turn, turn);
      targetV = MAX_SPEED * (fl.carry ? 0.82 : 1) * mag * Math.max(0.1, Math.cos(diff));
    }
    const rate = targetV > fl.v ? ACCEL : DECEL;
    fl.v += clamp(targetV - fl.v, -rate * dt, rate * dt);
    fl.x += (Math.sin(fl.h) * fl.v + fl.px) * dt;
    fl.z += (Math.cos(fl.h) * fl.v + fl.pz) * dt;
    const k = Math.exp(-4 * dt);
    fl.px *= k; fl.pz *= k;
    const r = 0.95;
    if (fl.x < -HALF_W + r || fl.x > HALF_W - r) { fl.x = clamp(fl.x, -HALF_W + r, HALF_W - r); fl.px *= -0.3; fl.v *= 0.7; }
    if (fl.z < MIN_Z + r || fl.z > MAX_Z - r) { fl.z = clamp(fl.z, MIN_Z + r, MAX_Z - r); fl.pz *= -0.3; fl.v *= 0.7; }
    fl.forkY += ((fl.forkUp ? 0.95 : 0.15) - fl.forkY) * damp(8, dt);
  }

  /** Forklift-vs-forklift circle collisions with an impulse exchange. */
  _collideForklifts() {
    const list = this.forklifts.filter((f) => !f.dead);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 1.7;
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, push = (min - d) / 2;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        const va = Math.sin(a.h) * a.v * nx + Math.cos(a.h) * a.v * nz;
        const vb = Math.sin(b.h) * b.v * nx + Math.cos(b.h) * b.v * nz;
        const j2 = Math.max(0, va - vb);
        if (j2 > 0.5) {
          a.px -= nx * j2 * 0.5; a.pz -= nz * j2 * 0.5;
          b.px += nx * j2 * 0.9; b.pz += nz * j2 * 0.9;
          a.v *= 0.5; b.v *= 0.7;
          if (j2 > 2.5) { Audio.sfx('clank', { vol: 0.5 }); this.fx.sparks(new THREE.Vector3(a.x + nx * 0.85, 0.6, a.z + nz * 0.85), { count: 6 }); }
        }
      }
    }
  }

  /** Free crates: falling, being bulldozed by forklift bodies, separating from each other. */
  _updateCrates(dt) {
    for (const c of this.crates) {
      if (c.carrier) {
        const f = c.carrier;
        c.x = f.x + Math.sin(f.h) * FORK_REACH;
        c.z = f.z + Math.cos(f.h) * FORK_REACH;
        c.y = f.forkY + 0.04;
        c.m.rotation.y = f.h;
        this._placeCrate(c);
        continue;
      }
      if (c.falling || c.y > 0) {
        c.vy -= GRAVITY * dt;
        c.y += c.vy * dt;
        if (c.y <= 0) {
          c.y = 0;
          if (c.vy < -6) { Audio.sfx('thud', { vol: 0.6 }); this.fx.smoke(new THREE.Vector3(c.x, 0.2, c.z), { size: 0.35, life: 0.8, color: 0x8a8270 }); }
          c.vy = 0; c.falling = false;
        }
      }
      if (c.y < 0.5) {
        for (const f of this.forklifts) {
          if (f.dead) continue;
          const bx = f.x - Math.sin(f.h) * 0.15, bz = f.z - Math.cos(f.h) * 0.15;
          const dx = c.x - bx, dz = c.z - bz, d = Math.hypot(dx, dz), min = FL_R + CRATE_R;
          if (d < min && d > 1e-4) { c.x = bx + (dx / d) * min; c.z = bz + (dz / d) * min; f.v *= 0.97; }
        }
      }
      c.x = clamp(c.x, -HALF_W + CRATE_R, HALF_W - CRATE_R);
      c.z = clamp(c.z, MIN_Z + CRATE_R, MAX_Z - CRATE_R);
    }
    const free = this.crates.filter((c) => !c.carrier && !c.falling);
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i], b = free[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = CRATE * 0.98;
        if (d < min && d > 1e-4) { const p = (min - d) / 2, nx = dx / d, nz = dz / d; a.x -= nx * p; a.z -= nz * p; b.x += nx * p; b.z += nz * p; }
      }
    }
    for (const c of free) this._placeCrate(c);
  }

  /** A button: lift a crate in reach, set down the carried crate, or toggle empty forks. */
  _forks(fl) {
    if (fl.carry) {
      const c = fl.carry;
      fl.carry = null;
      c.carrier = null;
      c.x = fl.x + Math.sin(fl.h) * (FORK_REACH + 0.1);
      c.z = fl.z + Math.cos(fl.h) * (FORK_REACH + 0.1);
      c.vy = 0;
      fl.forkUp = false;
      Audio.sfx('thud', { vol: 0.5 });
      return;
    }
    if (fl.forkUp) { fl.forkUp = false; Audio.sfx('clank', { vol: 0.3 }); return; }
    const tip = { x: fl.x + Math.sin(fl.h) * FORK_REACH, z: fl.z + Math.cos(fl.h) * FORK_REACH };
    let best = null, bd = 0.8;
    for (const c of this.crates) {
      if (c.carrier || c.falling || c.y > 0.3) continue;
      const d = dist2D(tip, c);
      if (d < bd) { bd = d; best = c; }
    }
    fl.forkUp = true;
    Audio.sfx('clank', { vol: 0.4 });
    if (best) { best.carrier = fl; fl.carry = best; Audio.sfx('engine'); }
  }

  /** Knock the carried crate off a forklift's forks. */
  _spill(fl) {
    const c = fl.carry;
    if (!c) return;
    fl.carry = null;
    c.carrier = null;
    c.y = Math.max(c.y, 0.6);
    c.vy = 3;
    c.falling = true;
    c.x += rand(-0.4, 0.4); c.z += rand(-0.4, 0.4);
    fl.forkUp = false;
  }

  /** B button: horn + a short bump cone in front. */
  _horn(fl) {
    fl.hornCd = 1.1;
    Audio.sfx('horn', { vol: 0.5 });
    const fx = Math.sin(fl.h), fz = Math.cos(fl.h);
    for (const o of this.forklifts) {
      if (o === fl || o.dead) continue;
      const dx = o.x - fl.x, dz = o.z - fl.z, d = Math.hypot(dx, dz);
      if (d > 2.8 || d < 1e-3 || (dx * fx + dz * fz) / d < 0.3) continue;
      o.px += (dx / d) * 5.5; o.pz += (dz / d) * 5.5;
      o.stun = 0.35;
      o.v *= 0.3;
      this._spill(o);
      Audio.sfx('shove');
    }
  }

  // -------------------------------------------------------------- lifecycle

  start() {
    Audio.sfx('engine');
    this.hud.prompt('Stick = drive · A = forks · B = horn');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  update(dt) {
    const playing = this.state === 'play';
    for (const fl of this.forklifts) {
      if (playing && !fl.dead) {
        const c = fl.seat.ctrl;
        if (c.aPressed && fl.stun <= 0) this._forks(fl);
        if (c.bPressed && fl.hornCd <= 0) this._horn(fl);
      }
      this._drive(fl, dt, playing);
    }
    this._collideForklifts();
    this._updateCrates(dt);
    for (const fl of this.forklifts) {
      if (fl.dead) continue;
      this._placeForklift(fl);
      const s = fl.seat.subject;
      s.pose = 'sit';
      s.animate(dt, 0);
      s.root.rotation.z = Math.sin(this.time * 30) * 0.01 * Math.abs(fl.v); // engine rattle
    }
    this._updateDrops(dt);
    if (!playing) return;

    this.spawnT += dt;
    if (this.spawnT >= SPAWN_EVERY) { this.spawnT -= SPAWN_EVERY; if (this.crates.length < MAX_CRATES) this._spawnCrate(true); }

    for (const seat of this.seats) {
      seat.score = this.crates.filter((c) => !c.carrier && !c.falling && this._inZone(c, seat.zone)).length;
      if (seat.score >= 4 && !seat.certified) { seat.certified = true; this.award(seat, 'certified'); }
      this.hud.setStat(seat, `CRATES ${seat.score}`);
      this.hud.setStatus(seat, seat.fl.carry ? 'LOADED' : '');
    }
    this.hud.setTimer(ROUND_TIME - this.time);
    if (this.time >= ROUND_TIME) this._review();
  }

  /** Shift over: the lowest scorer(s) get a crate from the ceiling. */
  _review() {
    const min = Math.min(...this.seats.map((s) => s.score));
    const losers = this.seats.filter((s) => s.score === min);
    this.hud.banner(losers.length === this.seats.length ? 'EQUAL FAILURE. EQUAL PUNISHMENT.' : 'PERFORMANCE REVIEW', 2200, 'danger');
    Audio.sfx('buzz');
    losers.forEach((seat, i) => {
      const fl = seat.fl;
      const m = mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), mat(0xffffff, Tex.crate()), fl.x, 16 + i * 2, fl.z);
      this.scene.add(m);
      this.drops.push({ m, seat, y: 16 + i * 2, vy: 0, delay: 0.6 + i * 0.25, landed: false });
    });
    this.end(3.4 + losers.length * 0.25);
  }

  _updateDrops(dt) {
    for (const d of this.drops) {
      if (d.landed) continue;
      if (d.delay > 0) { d.delay -= dt; continue; }
      const fl = d.seat.fl;
      d.vy -= GRAVITY * 1.4 * dt;
      d.y += d.vy * dt;
      const top = 1.2;
      d.m.position.set(fl.x, d.y + 0.9, fl.z);
      if (d.y <= top) {
        d.landed = true;
        d.y = 0.45;
        d.m.position.y = d.y + 0.9;
        const s = d.seat.subject;
        this.scene.attach(s.root); // so FX use world coordinates
        this.kill(d.seat, 'crush');
        fl.dead = true;
        fl.g.scale.y = 0.3;
        if (fl.carry) this._spill(fl);
        this.fx.smoke(new THREE.Vector3(fl.x, 0.4, fl.z), { size: 0.8, life: 1.2, color: 0x6a6258 });
        this.engine.shake(0.8);
      }
    }
  }

  /** Rank by crates in zone; the crushed share their score but rank below the living. */
  placement() { return rankByScore(this.seats); }

  // -------------------------------------------------------------------- bots

  /**
   * Bot: pick the cheapest free crate (centre first, sometimes a rival's),
   * line the forks up, lift, haul it into its own zone and set it down.
   */
  botThink(seat, dt) {
    const fl = seat.fl, c = seat.ctrl, brain = seat.brain, m = brain.memory;
    const wasA = m.lastA;
    m.lastA = false;
    c.setButtons(false, false);
    const pressA = () => { if (!wasA) { c.setButtons(true, false); m.lastA = true; } };
    if (fl.dead) { c.setMove(0, 0); return; }

    // Unstick: if barely moving for a while, swing around.
    m.stuckT = (m.stuckT || 0) + dt;
    if (m.stuckT > 1.0) {
      const moved = m.lastPos ? Math.hypot(fl.x - m.lastPos.x, fl.z - m.lastPos.z) : 1;
      if (moved < 0.35 && m.wantMove) { m.turnT = 0.8; m.turnDir = fl.h + Math.PI + rand(-0.8, 0.8); }
      m.lastPos = { x: fl.x, z: fl.z };
      m.stuckT = 0;
    }
    if (m.turnT > 0) { m.turnT -= dt; c.setMove(Math.sin(m.turnDir), Math.cos(m.turnDir)); return; }

    // Honk at loaded rivals right in front.
    for (const o of this.forklifts) {
      if (o === fl || o.dead || !o.carry || fl.hornCd > 0) continue;
      const dx = o.x - fl.x, dz = o.z - fl.z, d = Math.hypot(dx, dz);
      if (d < 2.6 && (dx * Math.sin(fl.h) + dz * Math.cos(fl.h)) / d > 0.5 && Math.random() < brain.difficulty * dt * 3) { c.setButtons(false, true); break; }
    }

    const zone = seat.zone;
    if (fl.carry) {
      if (!m.drop) m.drop = { x: zone.x + rand(-1.1, 1.1), z: zone.z + rand(-1.1, 1.1) };
      const tip = { x: fl.x + Math.sin(fl.h) * (FORK_REACH + 0.1), z: fl.z + Math.cos(fl.h) * (FORK_REACH + 0.1) };
      if (this._inZone(tip, zone, 0.55) && (dist2D(tip, m.drop) < 1.0 || this._inZone(tip, zone, 1.0))) { c.setMove(0, 0); pressA(); m.drop = null; m.wantMove = false; return; }
      this._steer(fl, m, m.drop.x, m.drop.z);
      return;
    }
    if (fl.forkUp) { pressA(); return; }

    m.pickT = (m.pickT || 0) - dt;
    const valid = (cr) => cr && this.crates.includes(cr) && !cr.carrier && !cr.falling && !this._inZone(cr, zone);
    if (!valid(m.target) || m.pickT <= 0) {
      // Late in the shift, a bot that isn't clearly ahead turns to theft.
      const leader = Math.max(...this.seats.filter((s) => s !== seat).map((s) => s.score));
      const desperate = this.time > 25 && seat.score <= leader + 1;
      const thief = desperate || Math.random() < 0.2 + 0.3 * brain.difficulty;
      let best = null, bc = Infinity;
      for (const cr of this.crates) {
        if (!valid(cr)) continue;
        let cost = Math.hypot(cr.x - fl.x, cr.z - fl.z) + Math.hypot(cr.x - zone.x, cr.z - zone.z) * 0.5;
        if (this.zones.some((z) => z !== zone && this._inZone(cr, z))) cost += desperate ? -3 : thief ? 1 : 9;
        // Avoid crates a rival is already lining up on.
        if (this.seats.some((s) => s !== seat && s.brain.memory.target === cr)) cost += 4;
        if (cost < bc) { bc = cost; best = cr; }
      }
      m.target = best;
      m.pickT = rand(1.5, 2.5);
    }
    const t = m.target;
    if (!t) { c.setMove(0, 0); m.wantMove = false; return; }
    const tip = { x: fl.x + Math.sin(fl.h) * FORK_REACH, z: fl.z + Math.cos(fl.h) * FORK_REACH };
    if (dist2D(tip, t) < 0.6) { c.setMove(0, 0); pressA(); m.target = null; m.wantMove = false; return; }
    // Approach from a staging point behind the crate (relative to us) so the forks line up.
    const d = Math.hypot(t.x - fl.x, t.z - fl.z);
    const ux = (t.x - fl.x) / (d || 1), uz = (t.z - fl.z) / (d || 1);
    if (d > 3.2) this._steer(fl, m, t.x - ux * 2, t.z - uz * 2);
    else this._steer(fl, m, t.x - ux * (FORK_REACH - 0.15), t.z - uz * (FORK_REACH - 0.15), 0.55);
  }

  _steer(fl, m, x, z, throttle = 1) {
    const dx = x - fl.x, dz = z - fl.z, d = Math.hypot(dx, dz) || 1;
    const s = Math.min(1, d / 1.5) * throttle;
    fl.seat.ctrl.setMove((dx / d) * Math.max(0.35, s), (dz / d) * Math.max(0.35, s));
    m.wantMove = true;
  }
}
