/**
 * SIDEARM ASSEMBLY — a factory floor, a conveyor belt of loose pistol parts
 * and one workbench per subject.
 *
 * Rules:
 *  - The belt along the bottom of the screen carries four part types:
 *    FRAME, SLIDE, BARREL and MAGAZINE.
 *  - Walk to the belt and press A to pick a part up (one at a time), carry it
 *    to YOUR bench and press A to install it. Duplicates of a part you have
 *    already installed are rejected and dropped. Pressing A away from your
 *    bench drops the part.
 *  - B shoves; a shoved carrier drops whatever they hold.
 *  - Four installed parts = an assembled pistol: six rounds, 0.6 s between
 *    shots, every hit is lethal. Benches, crates and walls stop bullets.
 *    An empty pistol can be reloaded by installing another magazine.
 *  - The round ends when one subject remains or after 75 seconds. Survivors
 *    rank by installed parts (seat.score), the dead by reverse death order.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, crate, pipe } from '../core/environment.js';
import { Tex, mat, glow, textTexture, canvasTexture } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { clamp, dist2D } from '../core/util.js';
import { rand, shuffle, random } from '../core/rng.js';

const HALF_W = 9.5;            // pen half-width
const MIN_Z = -5.4;            // walkable back edge (benches stand against it)
const BELT_FRONT = 4.5;        // walkable front edge (belt housing starts here)
const BELT_Z = 5.1;            // belt centreline
const BELT_Y = 0.8;            // belt surface height
const BELT_SPEED = 1.5;        // units / second, toward +X
const BELT_LEN = HALF_W * 2 + 3;
const BENCH_Z = -4.85;         // bench centre
const BENCH_W = 2.1, BENCH_D = 0.9, BENCH_H = 0.95;
const ROUND_TIME = 75;
const FIRE_CD = 0.6;
const MAG_SIZE = 6;
const RANGE = 26;
const SPAWN_EVERY = 0.9;       // belt part spawn interval
const MAX_LOOSE = 12;          // parts lying on the floor at once

const PART_TYPES = ['frame', 'slide', 'barrel', 'magazine'];
const PART_INFO = {
  frame: { label: 'FRAME', color: 0x55663f },
  slide: { label: 'SLIDE', color: 0xb9bdbb },
  barrel: { label: 'BARREL', color: 0xc8873a },
  magazine: { label: 'MAGAZINE', color: 0x3b62a8 },
};

// ------------------------------------------------------------- part models

/**
 * Build one pistol part in "gun space": barrel axis along +Z, up = +Y, the
 * slide's underside at y ≈ 0.06. All four combined form the assembled pistol.
 */
function partModel(type) {
  const g = new THREE.Group();
  const m = mat(PART_INFO[type].color, Tex.metal());
  const dark = mat(0x1d1e1c);
  const add = (geo, material, x, y, z) => { const o = mesh(geo, material, x, y, z); g.add(o); return o; };
  if (type === 'frame') {
    add(new THREE.BoxGeometry(0.18, 0.12, 0.6), m, 0, 0, 0);
    add(new THREE.BoxGeometry(0.17, 0.42, 0.22), m, 0, -0.24, -0.17).rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.04, 0.1, 0.18), dark, 0, -0.11, 0.04);
  } else if (type === 'slide') {
    add(new THREE.BoxGeometry(0.2, 0.16, 0.64), m, 0, 0.14, 0);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.205, 0.12, 0.02), dark, 0, 0.14, -0.27 + i * 0.05);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.04), dark, 0, 0.24, 0.28);
    add(new THREE.BoxGeometry(0.205, 0.06, 0.14), dark, 0, 0.17, 0.05);
  } else if (type === 'barrel') {
    const b = add(new THREE.CylinderGeometry(0.055, 0.055, 0.62, 8), m, 0, 0.14, 0.08);
    b.rotation.x = Math.PI / 2;
    const r = add(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 8), m, 0, 0.14, 0.37);
    r.rotation.x = Math.PI / 2;
    const chamber = add(new THREE.BoxGeometry(0.13, 0.12, 0.16), m, 0, 0.14, -0.2);
    void chamber;
  } else if (type === 'magazine') {
    const body = add(new THREE.BoxGeometry(0.13, 0.42, 0.18), m, 0, -0.27, -0.17);
    body.rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.16, 0.05, 0.22), dark, 0, -0.49, -0.23).rotation.x = -0.25;
    const round = add(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 6), mat(0xd9b04a), 0, -0.05, -0.12);
    round.rotation.x = Math.PI / 2;
  }
  return g;
}

/**
 * A part laid flat for display on the belt, floor or bench: an outer group
 * whose local origin is at the part's bottom centre.
 */
function lyingPart(type) {
  const outer = new THREE.Group();
  const inner = partModel(type);
  if (type === 'frame' || type === 'magazine') inner.rotation.z = Math.PI / 2;
  outer.add(inner);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  outer.scale.setScalar(1.25);
  return outer;
}

/** The complete pistol (all four parts in gun space). */
function assembledGun() {
  const g = new THREE.Group();
  for (const t of PART_TYPES) g.add(partModel(t));
  return g;
}

/** Dispose all geometry under an object (part meshes own their geometry). */
function disposeTree(obj) {
  obj.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
}

export class SidearmAssembly extends Minigame {
  static meta = {
    id: 'sidearm',
    title: 'SIDEARM ASSEMBLY',
    tagline: 'Some assembly required. Some funerals included.',
    category: 'Assembly',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Grab / Install / Fire' }, { input: 'b', label: 'Shove' }],
    objective: 'Build a pistol at your own bench, then be the last subject standing.',
    rules: [
      'Grab parts off the belt and install them at YOUR bench. Duplicates are rejected.',
      'Frame + slide + barrel + magazine = a pistol. Six rounds. Every hit kills.',
      'Shove carriers to make them drop their part. Benches and crates stop bullets.',
      'Out of ammo? Install another magazine to reload.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 22, fogFar: 55 });
    this.makeCamera([0, 15, 10.5], [0, 0, 0.4], 50);

    floor(scene, 44, 34, { tex: 'concrete', tile: 3 });
    floor(scene, HALF_W * 2, BELT_FRONT - MIN_Z, { tex: 'plate', tile: 1.5, y: 0.005, z: (BELT_FRONT + MIN_Z) / 2 });

    // Back wall, side walls and set dressing
    const wallMat = mat(0xffffff, Tex.wall([6, 1.5]));
    block(scene, 0, 2.2, MIN_Z - 0.3, HALF_W * 2 + 1.2, 4.4, 0.3, wallMat);
    const sideMat = mat(0xffffff, Tex.rust([3, 1]));
    block(scene, -HALF_W - 0.3, 0.6, (BELT_FRONT + MIN_Z) / 2, 0.6, 1.2, BELT_FRONT - MIN_Z + 1.4, sideMat);
    block(scene, HALF_W + 0.3, 0.6, (BELT_FRONT + MIN_Z) / 2, 0.6, 1.2, BELT_FRONT - MIN_Z + 1.4, sideMat);
    stencil(scene, 'ASSEMBLE', 0, 3.4, MIN_Z - 0.14, { w: 8, h: 1.6, opacity: 0.55 });
    pipe(scene, [-HALF_W, 4.0, MIN_Z - 0.05], [HALF_W, 4.0, MIN_Z - 0.05], 0.14);
    pipe(scene, [-HALF_W, 3.6, MIN_Z - 0.05], [HALF_W, 3.6, MIN_Z - 0.05], 0.08, 0x3b5a3b);
    hazardStrip(scene, 0, BELT_FRONT - 0.25, HALF_W * 2, 0.4, 0.012);
    crate(scene, -HALF_W - 1.6, 0, -2, 1.2, 0.3);
    crate(scene, -HALF_W - 1.5, 1.2, -2.1, 0.9, 0.9);
    crate(scene, HALF_W + 1.6, 0, 1, 1.2, -0.2);

    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: MIN_Z, maxZ: BELT_FRONT }, shoveForce: 12 });

    this._buildBelt(scene);
    this._buildCover(scene);

    hangingLamp(scene, -5.5, 7.5, -0.5, { intensity: 85, angle: 0.95 });
    hangingLamp(scene, 5.5, 7.5, -0.5, { intensity: 85, angle: 0.95 });
    hangingLamp(scene, 0, 7.5, -1.5, { intensity: 55, angle: 0.8, shadow: false });
    hangingLamp(scene, 0, 7, 4.2, { intensity: 45, angle: 0.9, shadow: false });

    // Benches + avatars
    const n = this.seats.length;
    const spacing = n >= 4 ? 4.2 : n === 3 ? 5.2 : 6;
    this.benches = [];
    this.seats.forEach((seat, i) => {
      const bx = (i - (n - 1) / 2) * spacing;
      const bench = this._buildBench(scene, seat, bx);
      this.benches.push(bench);
      seat.bench = bench;
      seat.installed = new Set();
      seat.armed = false;
      seat.ammo = 0;
      seat.fireCd = 0;
      seat.held = null;
      const x = bx, z = BENCH_Z + 1.6;
      this.spawnSubject(seat, { x, z, facing: 0 });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = 0;
      seat.actor.seat = seat;
      // Pistol model held in the right hand once assembled.
      const holder = new THREE.Group();
      holder.position.set(0, -0.78, 0.06);
      holder.rotation.x = Math.PI / 2;
      const gun = assembledGun();
      gun.scale.setScalar(0.5);
      gun.position.set(0, 0.24 * 0.5, 0.17 * 0.5);
      holder.add(gun);
      holder.visible = false;
      seat.subject.parts.armR.add(holder);
      seat.gun = holder;
    });
    this.arena.onShove = (a, b) => {
      if (b.seat && b.seat.held) { this._drop(b.seat, { toss: 3 }); Audio.sfx('clank', { vol: 0.6 }); }
    };

    this.parts = [];
    this.tracers = [];
    this.bag = [];
    this.spawnT = 0;
    // Pre-fill the belt so the action starts immediately.
    for (let x = -HALF_W - 1; x < HALF_W; x += BELT_SPEED * SPAWN_EVERY * 1.4) this._spawnBeltPart(x);
  }

  // ------------------------------------------------------------------ stage

  _buildBelt(scene) {
    const frameMat = mat(0x46483f, Tex.metal([6, 1]));
    block(scene, 0, BELT_Y / 2 - 0.05, BELT_Z, BELT_LEN, BELT_Y - 0.1, 1.25, frameMat);
    const tex = canvasTexture('sidearm-belt', 64, (c, s) => {
      c.fillStyle = '#1c1d1b'; c.fillRect(0, 0, s, s);
      c.fillStyle = '#34352f';
      for (let x = 0; x < s; x += 16) c.fillRect(x, 0, 5, s);
      for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; c.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
    }, { repeat: [BELT_LEN, 1] });
    this.beltTex = tex;
    const surf = mesh(new THREE.PlaneGeometry(BELT_LEN, 1.0), mat(0xffffff, tex), 0, BELT_Y, BELT_Z, { cast: false });
    surf.rotation.x = -Math.PI / 2;
    scene.add(surf);
    // Side rails
    const railMat = mat(0x8a7a2a, Tex.metal());
    block(scene, 0, BELT_Y + 0.08, BELT_Z - 0.58, BELT_LEN, 0.16, 0.08, railMat);
    block(scene, 0, BELT_Y + 0.08, BELT_Z + 0.58, BELT_LEN, 0.16, 0.08, railMat);
    // Feed chute (left) and scrap hopper (right)
    const hood = mat(0x3a3c36, Tex.plate());
    block(scene, -HALF_W - 1.2, 1.6, BELT_Z, 1.4, 1.6, 1.6, hood);
    block(scene, -HALF_W - 1.2, 0.95, BELT_Z, 1.2, 0.3, 1.3, glow(0x050505));
    block(scene, HALF_W + 1.2, 0.55, BELT_Z, 1.4, 1.1, 1.6, mat(0x5b3a22, Tex.rust()));
    stencil(scene, 'PARTS', -HALF_W - 1.2, 1.8, BELT_Z + 0.81, { w: 1.3, h: 0.5, opacity: 0.8, color: '#e0c050' });
  }

  _buildCover(scene) {
    const add = (x, z, w, d, h, material) => {
      block(scene, x, h / 2, z, w, h, d, material);
      this.arena.addWall(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
    };
    const crateMat = mat(0xffffff, Tex.crate());
    add(-4.6, 0.8, 1.3, 1.3, 1.3, crateMat);
    add(4.6, 0.8, 1.3, 1.3, 1.3, crateMat);
    add(0, -1.3, 2.4, 0.5, 1.0, mat(0xa8aca4, Tex.plate([2, 1])));
    hazardStrip(scene, 0, -0.85, 2.4, 0.3, 0.012);
    crate(scene, -4.6, 1.3, 0.8, 0.8, 0.4);
  }

  /** A workbench with a pegboard, a player label and four part slots. */
  _buildBench(scene, seat, bx) {
    const g = new THREE.Group();
    g.position.set(bx, 0, BENCH_Z);
    const wood = mat(0xffffff, Tex.wood([2, 1]));
    const steel = mat(0x4a4d48, Tex.metal());
    g.add(mesh(new THREE.BoxGeometry(BENCH_W, 0.12, BENCH_D), wood, 0, BENCH_H - 0.06, 0));
    for (const [lx, lz] of [[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]]) g.add(mesh(new THREE.BoxGeometry(0.1, BENCH_H - 0.12, 0.1), steel, lx, (BENCH_H - 0.12) / 2, lz));
    g.add(mesh(new THREE.BoxGeometry(BENCH_W, 0.08, BENCH_D - 0.1), steel, 0, 0.25, 0));
    // Pegboard with the owner's colour stripe and label
    g.add(mesh(new THREE.BoxGeometry(BENCH_W, 1.1, 0.06), mat(0x8a7a5c, Tex.fabric()), 0, BENCH_H + 0.55, -BENCH_D / 2 + 0.03));
    const color = new THREE.Color(seat.player.color);
    g.add(mesh(new THREE.BoxGeometry(BENCH_W, 0.14, 0.07), glow(color), 0, BENCH_H + 1.04, -BENCH_D / 2 + 0.04));
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({
      map: textTexture(`P${seat.player.slot + 1}`, { w: 128, h: 64, size: 54, color: seat.player.color }), transparent: true,
    }));
    label.position.set(0, BENCH_H + 0.62, -BENCH_D / 2 + 0.07);
    g.add(label);
    // Vise on the corner
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.18, 0.3), mat(0x2f4f7f, Tex.metal()), -0.85, BENCH_H + 0.09, 0.25));
    // Part slots: tinted outline plates so the missing parts are readable.
    const slots = {};
    PART_TYPES.forEach((t, i) => {
      const sx = -0.72 + i * 0.48;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.7), new THREE.MeshBasicMaterial({ color: PART_INFO[t].color, transparent: true, opacity: 0.35, depthWrite: false }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(sx, BENCH_H + 0.005, 0.05);
      g.add(plate);
      slots[t] = { x: bx + sx, y: BENCH_H, z: BENCH_Z + 0.05, plate, part: null };
    });
    // Owner's floor marking in front of the bench
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(BENCH_W, 0.9), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.015, BENCH_D / 2 + 0.55);
    g.add(mark);
    scene.add(g);
    this.arena.addWall(bx - BENCH_W / 2, bx + BENCH_W / 2, BENCH_Z - BENCH_D / 2, BENCH_Z + BENCH_D / 2);
    return { x: bx, group: g, slots };
  }

  // ------------------------------------------------------------------ parts

  /** Next part type from a shuffled bag so every type appears regularly. */
  _nextType() {
    if (!this.bag.length) this.bag = shuffle(PART_TYPES);
    return this.bag.pop();
  }

  _spawnBeltPart(x = -HALF_W - 1.5) {
    const type = this._nextType();
    const g = lyingPart(type);
    g.rotation.y = Math.PI / 2 + rand(-0.3, 0.3);
    const p = { type, g, state: 'belt', x, z: BELT_Z + rand(-0.15, 0.15), y: BELT_Y, vx: 0, vy: 0, vz: 0, age: 0 };
    g.position.set(p.x, p.y, p.z);
    this.scene.add(g);
    this.parts.push(p);
    return p;
  }

  _removePart(p) {
    if (p.g.parent) p.g.parent.remove(p.g);
    disposeTree(p.g);
    this.parts = this.parts.filter((q) => q !== p);
  }

  /** Move belt parts, settle dropped parts, recycle parts that fall off the end. */
  _updateParts(dt) {
    for (const p of this.parts.slice()) {
      if (p.state === 'belt') {
        p.x += BELT_SPEED * dt;
        p.g.position.set(p.x, p.y, p.z);
        if (p.x > HALF_W + 1.4) this._removePart(p);
      } else if (p.state === 'floor') {
        p.age += dt;
        if (p.y > 0 || p.vy > 0) {
          p.vy -= 20 * dt;
          p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
          p.x = clamp(p.x, -HALF_W + 0.3, HALF_W - 0.3);
          p.z = clamp(p.z, MIN_Z + 0.3, BELT_FRONT - 0.3);
          if (p.y <= 0) { p.y = 0; p.vy = 0; this._pushOutOfWalls(p); Audio.sfx('clank', { vol: 0.25 }); }
        }
        p.g.position.set(p.x, p.y, p.z);
      }
    }
    // Keep the floor tidy: discard the oldest loose parts.
    const loose = this.parts.filter((p) => p.state === 'floor');
    if (loose.length > MAX_LOOSE) {
      loose.sort((a, b) => b.age - a.age);
      for (const p of loose.slice(0, loose.length - MAX_LOOSE)) { this.fx.smoke(p.g.position.clone(), { size: 0.2, life: 0.6 }); this._removePart(p); }
    }
  }

  /** Nudge a landed part out of any bench/crate footprint so it stays reachable. */
  _pushOutOfWalls(p) {
    for (const w of this.arena.walls) {
      if (p.x > w.minX && p.x < w.maxX && p.z > w.minZ && p.z < w.maxZ) {
        const opts = [[p.x - w.minX, -1, 0], [w.maxX - p.x, 1, 0], [p.z - w.minZ, 0, -1], [w.maxZ - p.z, 0, 1]].sort((a, b) => a[0] - b[0]);
        const [pen, nx, nz] = opts[0];
        p.x += nx * (pen + 0.15); p.z += nz * (pen + 0.15);
      }
    }
  }

  /** Is the seat standing at the front of its own bench? */
  _atOwnBench(seat) {
    const a = seat.actor;
    return Math.abs(a.pos.x - seat.bench.x) < BENCH_W / 2 + 0.25 && a.pos.z - (BENCH_Z + BENCH_D / 2) < 1.1;
  }

  /** Try to pick up the nearest reachable part. Returns true on success. */
  _tryPickup(seat) {
    const a = seat.actor;
    let best = null, bd = Infinity;
    for (const p of this.parts) {
      let reach;
      if (p.state === 'belt') { if (p.x < -HALF_W || p.x > HALF_W) continue; reach = 1.75; }
      else if (p.state === 'floor') { if (p.y > 0.3) continue; reach = 1.15; }
      else continue;
      const d = dist2D(a.pos, p);
      if (d < reach && d < bd) { bd = d; best = p; }
    }
    if (!best) return false;
    best.state = 'held';
    seat.held = best;
    seat.subject.root.add(best.g);
    best.g.position.set(0, 1.0, 0.55);
    best.g.rotation.set(0, Math.PI / 2, 0);
    Audio.sfx('select', { vol: 0.5 });
    return true;
  }

  /** Drop the held part in front of the seat. */
  _drop(seat, { toss = 1.2 } = {}) {
    const p = seat.held;
    if (!p) return;
    seat.held = null;
    const a = seat.actor;
    this.scene.attach(p.g);
    const f = a.forward;
    p.state = 'floor';
    p.age = 0;
    p.x = a.pos.x + f.x * 0.5; p.z = a.pos.z + f.z * 0.5; p.y = 1.0;
    p.vx = f.x * toss + rand(-1, 1); p.vz = f.z * toss + rand(-1, 1); p.vy = 3;
    p.g.rotation.set(0, rand(0, Math.PI * 2), 0);
    p.g.position.set(p.x, p.y, p.z);
  }

  /** Install (or reject) the held part at the seat's own bench. */
  _insert(seat) {
    const p = seat.held;
    if (seat.armed) {
      if (p.type === 'magazine') {
        seat.held = null;
        this._removePart(p);
        seat.ammo = MAG_SIZE;
        Audio.sfx('reload');
        this.hud.feed(`${seat.player.name} RELOADED`, seat.player.color);
      } else { this._drop(seat); Audio.sfx('wrong'); }
      return;
    }
    if (seat.installed.has(p.type)) { this._drop(seat); Audio.sfx('wrong'); return; }
    seat.held = null;
    seat.installed.add(p.type);
    seat.score = seat.installed.size;
    const slot = seat.bench.slots[p.type];
    this.scene.attach(p.g);
    p.state = 'bench';
    p.g.position.set(slot.x, slot.y, slot.z);
    p.g.rotation.set(0, 0, 0);
    p.g.scale.setScalar(1);
    slot.part = p;
    slot.plate.material.opacity = 0.8;
    Audio.sfx('clank');
    this.fx.sparks(new THREE.Vector3(slot.x, slot.y + 0.2, slot.z), { count: 5, speed: 3 });
    if (seat.installed.size === PART_TYPES.length) this._arm(seat);
  }

  /** All four parts installed: the pistol leaves the bench and enters the hand. */
  _arm(seat) {
    for (const t of PART_TYPES) {
      const slot = seat.bench.slots[t];
      if (slot.part) { this._removePart(slot.part); slot.part = null; }
      slot.plate.material.opacity = 0.12;
    }
    seat.armed = true;
    seat.armedAt = this.time;
    seat.ammo = MAG_SIZE;
    Audio.sfx('reload');
    Audio.sfx('ding', { vol: 0.6 });
    this.fx.sparks(new THREE.Vector3(seat.bench.x, BENCH_H + 0.3, BENCH_Z), { count: 14, speed: 4 });
    this.hud.banner(`${seat.player.name} IS ARMED`, 1300, 'danger');
    this.hud.feed(`${seat.player.name} — PISTOL ASSEMBLED`, seat.player.color);
  }

  // --------------------------------------------------------------- shooting

  /** Hitscan along the facing direction; first wall or body stops the round. */
  _fire(seat) {
    const a = seat.actor;
    seat.ammo--;
    seat.fireCd = FIRE_CD;
    const f = a.forward;
    const origin = new THREE.Vector3(a.pos.x + f.x * 0.9, 1.5, a.pos.z + f.z * 0.9);
    const B = this.arena.bounds;
    let end = null, victim = null;
    for (let d = 0.25; d < RANGE; d += 0.1) {
      const x = a.pos.x + f.x * d, z = a.pos.z + f.z * d;
      if (x < B.minX - 0.3 || x > B.maxX + 0.3 || z < B.minZ - 0.3 || z > B.maxZ + 0.5) { end = new THREE.Vector3(x, 1.5, z); break; }
      if (this.arena.walls.some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ)) { end = new THREE.Vector3(x, 1.5, z); break; }
      victim = this.aliveSeats.find((s) => s !== seat && Math.hypot(s.actor.pos.x - x, s.actor.pos.z - z) < s.actor.radius + 0.08);
      if (victim) { end = new THREE.Vector3(x, 1.5, z); break; }
    }
    if (!end) end = origin.clone().addScaledVector(f, RANGE);
    Audio.sfx('shot');
    this.engine.shake(0.15);
    this.fx.sparks(origin, { count: 6, speed: 4, color: 0xffe08a });
    this.fx.smoke(origin, { size: 0.15, life: 0.5, opacity: 0.4 });
    this._tracer(origin, end);
    if (victim) {
      if (victim.held) this._drop(victim, { toss: 2 });
      // Commendation: out-drew someone whose gun was finished first.
      if (victim.armed && victim.armedAt < seat.armedAt) this.award(seat, 'returnFire');
      this.kill(victim, 'shot', { dir: f, sound: 'splat' });
      this.hud.feed(`${seat.player.name} ▸ ${victim.player.name}`, seat.player.color);
    } else {
      this.fx.sparks(end, { count: 8, speed: 5 });
      Audio.sfx('metal', { vol: 0.3 });
    }
  }

  /** Brief glowing streak between two points. */
  _tracer(from, to) {
    const len = Math.max(0.01, from.distanceTo(to));
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, depthWrite: false }));
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    this.scene.add(m);
    this.tracers.push({ m, life: 0.16 });
  }

  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.16);
      if (t.life <= 0) { this.scene.remove(t.m); t.m.geometry.dispose(); t.m.material.dispose(); this.tracers.splice(i, 1); }
    }
  }

  // -------------------------------------------------------------- lifecycle

  start() {
    this.hud.prompt('Grab parts from the belt ▸ build <b>your</b> pistol at <b>your</b> bench ▸ use it');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 6000);
  }

  preview(dt) {
    this._animateBelt(dt);
    this._updateParts(dt);
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  _animateBelt(dt) {
    this.beltTex.offset.x -= BELT_SPEED * dt;
  }

  update(dt) {
    this._animateBelt(dt);
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    this._updateParts(dt);
    this._updateTracers(dt);
    for (const s of this.seats) {
      if (!s.alive) continue;
      s.subject.pose = s.held ? 'carry' : s.armed ? 'aim' : 'idle';
      s.gun.visible = s.armed && !s.held;
    }
    if (!playing) return;

    this.spawnT += dt;
    if (this.spawnT >= SPAWN_EVERY) { this.spawnT -= SPAWN_EVERY; this._spawnBeltPart(); }

    for (const seat of this.aliveSeats) {
      seat.fireCd = Math.max(0, seat.fireCd - dt);
      this._handleAction(seat);
    }

    for (const s of this.seats) {
      const stat = s.armed ? `AMMO ${s.ammo}/${MAG_SIZE}` : `PARTS ${s.installed.size}/4`;
      this.hud.setStat(s, stat);
      let status = '';
      if (!s.alive) status = 'DECEASED';
      else if (s.held) status = `CARRYING ${PART_INFO[s.held.type].label}`;
      else if (s.armed) status = s.ammo > 0 ? 'ARMED' : 'EMPTY — NEED MAGAZINE';
      this.hud.setStatus(s, status);
    }
    this.hud.setTimer(ROUND_TIME - this.time);
    if (this.time >= ROUND_TIME) { this.hud.banner('SHIFT OVER', 1500); Audio.sfx('buzz'); this.end(); return; }
    this.checkLastStanding();
  }

  /** Resolve the A button: install / drop / fire / pick up, in that priority. */
  _handleAction(seat) {
    const a = seat.actor, c = seat.ctrl;
    if (!c.aPressed || a.stun > 0) return;
    if (seat.held) {
      if (this._atOwnBench(seat)) this._insert(seat); else { this._drop(seat); Audio.sfx('thud', { vol: 0.4 }); }
      return;
    }
    if (seat.armed && seat.ammo > 0) { if (seat.fireCd <= 0) this._fire(seat); return; }
    if (!this._tryPickup(seat) && seat.armed) Audio.sfx('click');
  }

  // -------------------------------------------------------------------- bots

  /**
   * Bot: fetch the parts it still needs (intercepting belt parts), install
   * them, then hunt the nearest rival with line of sight and fire.
   */
  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, m = brain.memory, c = a.ctrl;
    const wasA = m.lastA;
    m.lastA = false;
    c.setButtons(false, false);
    const pressA = () => { if (!wasA) { c.setButtons(true, false); m.lastA = true; } };

    // Hunting with a loaded pistol
    if (seat.armed && seat.ammo > 0 && !seat.held) {
      const rivals = this.aliveSeats.filter((s) => s !== seat);
      let target = null, bestD = Infinity, visible = false;
      for (const r of rivals) {
        const d = dist2D(a.pos, r.actor.pos);
        const los = this.arena.clearLine(a.pos, r.actor.pos, 0.2);
        const score = d - (los ? 6 : 0);
        if (score < bestD) { bestD = score; target = r; visible = los; }
      }
      if (!target) { c.setMove(0, 0); return; }
      const t = target.actor;
      const d = dist2D(a.pos, t.pos);
      if (visible && d < 16) {
        c.setMove(0, 0);
        // Angular error: close shots are deadly, long shots are a gamble.
        if (m.aimErr === undefined || m.reroll) { m.aimErr = rand(-1, 1) * (0.05 + 0.22 * (1 - brain.difficulty)); m.reroll = false; m.aimT = 0; }
        // Lead the target slightly.
        const lead = 0.12 * brain.difficulty;
        const ang = Math.atan2(t.pos.x + t.vel.x * lead - a.pos.x, t.pos.z + t.vel.z * lead - a.pos.z);
        a.facing = ang + m.aimErr;
        m.aimT = (m.aimT || 0) + dt;
        if (m.aimT > brain.reaction + 0.35 + d * 0.03 && seat.fireCd <= 0) { pressA(); m.reroll = true; }
      } else {
        m.aimT = 0;
        this._navigate(a, m, t.pos.x, t.pos.z, dt);
      }
      return;
    }

    // Juke sideways when an armed rival is lining up on us.
    if (m.dodgeT > 0) { m.dodgeT -= dt; c.setMove(m.dodgeX, m.dodgeZ); return; }
    for (const r of this.aliveSeats) {
      if (r === seat || !r.armed || r.ammo <= 0 || r.held) continue;
      const ra = r.actor, dx = a.pos.x - ra.pos.x, dz = a.pos.z - ra.pos.z, d = Math.hypot(dx, dz);
      if (d > 14 || d < 1e-3) continue;
      const aimed = (dx * Math.sin(ra.facing) + dz * Math.cos(ra.facing)) / d > 0.97;
      if (aimed && this.arena.clearLine(ra.pos, a.pos, 0.2) && random() < brain.difficulty * dt * 5) {
        const side = random() < 0.5 ? 1 : -1;
        m.dodgeX = (-dz / d) * side; m.dodgeZ = (dx / d) * side; m.dodgeT = rand(0.3, 0.6);
        return;
      }
    }

    const needed = seat.armed ? ['magazine'] : PART_TYPES.filter((t) => !seat.installed.has(t));

    if (seat.held) {
      if (!needed.includes(seat.held.type)) { pressA(); return; }
      if (this._atOwnBench(seat)) { c.setMove(0, 0); a.facing = Math.PI; pressA(); return; }
      this._navigate(a, m, seat.bench.x, BENCH_Z + BENCH_D / 2 + 0.6, dt);
      return;
    }

    // Opportunistic shove of a nearby carrier.
    for (const r of this.aliveSeats) {
      if (r === seat || !r.held) continue;
      const d = dist2D(a.pos, r.actor.pos);
      if (d < 1.3 && random() < brain.difficulty * dt * 3) {
        a.facing = Math.atan2(r.actor.pos.x - a.pos.x, r.actor.pos.z - a.pos.z);
        c.setButtons(false, true);
        return;
      }
    }

    // Choose the cheapest part to reach (floor parts directly, belt parts by interception).
    const speed = a.speed * a.speedMul;
    let goal = null, bestT = Infinity;
    for (const p of this.parts) {
      if (!needed.includes(p.type)) continue;
      if (p.state === 'floor' && p.y < 0.3) {
        const t = dist2D(a.pos, p) / speed;
        if (t < bestT) { bestT = t; goal = { p, x: p.x, z: p.z }; }
      } else if (p.state === 'belt') {
        const standZ = BELT_FRONT - 0.5;
        let t = 0, px = p.x;
        for (let k = 0; k < 3; k++) { t = Math.hypot(px - a.pos.x, standZ - a.pos.z) / speed + 0.15; px = p.x + BELT_SPEED * t; }
        if (px > HALF_W - 0.6 || px < -HALF_W + 0.3) continue;
        if (t < bestT) { bestT = t; goal = { p, x: px, z: standZ }; }
      }
    }
    if (!goal) { this._navigate(a, m, a.pos.x * 0.8, BELT_FRONT - 1.2, dt); return; }
    const reach = goal.p.state === 'belt' ? 1.6 : 1.0;
    if (dist2D(a.pos, goal.p) < reach) { pressA(); c.setMove(0, 0); return; }
    this._navigate(a, m, goal.x, goal.z, dt);
  }

  /** Steer toward a point, sidestepping when stuck against an obstacle. */
  _navigate(a, m, x, z, dt) {
    m.stuckT = (m.stuckT || 0) + dt;
    if (m.detourT > 0) {
      m.detourT -= dt;
      a.ctrl.setMove(m.detourX, m.detourZ);
      return;
    }
    const d = steerTo(a, x, z, { arrive: 0.15, slow: 0.6 });
    if (m.stuckT > 0.6) {
      const moved = m.lastPos ? Math.hypot(a.pos.x - m.lastPos.x, a.pos.z - m.lastPos.z) : 1;
      if (moved < 0.25 && d > 0.6) {
        const dx = x - a.pos.x, dz = z - a.pos.z, l = Math.hypot(dx, dz) || 1;
        const side = random() < 0.5 ? 1 : -1;
        m.detourX = (-dz / l) * side; m.detourZ = (dx / l) * side;
        m.detourT = rand(0.35, 0.7);
      }
      m.lastPos = { x: a.pos.x, z: a.pos.z };
      m.stuckT = 0;
    }
  }
}
