/**
 * HOT SEAT — king of the hill on an electrified square platform.
 *
 * Rules
 *  - A square platform is ringed by a live fence. Touching it ('burn') is
 *    fatal; the hazard stripes mark the kill zone.
 *  - A glowing pressure plate (radius 1.4) sits somewhere on the platform.
 *    A subject standing on it ALONE scores 1 point per second. Two or more
 *    on it = contested: nobody scores and the plate flickers red.
 *  - Every ~12 s (11–13 s) the plate powers down and relocates. 1.5 s before
 *    the move a red warning ring marks the next spot and a banner announces it.
 *  - B shoves (Arena shove): knock rivals off the plate or into the fence.
 *  - 60 s round. Ranking: survivors by points, then the fried by points
 *    (ties among the fried broken by who died later). If only one subject
 *    (or none) is left alive, the round ends early.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { nearest } from '../core/ai.js';
import { rand, random } from '../core/rng.js';

const HALF = 6.5;            // fence line half-extent (square platform)
const EDGE = 0.55;           // kill depth from the fence
const PLATE_R = 1.4;         // pressure plate radius
const PLATE_MARGIN = 2.3;    // plate centre keeps this far from the fence
const ROUND = 60;            // seconds of play
const WARN = 1.5;            // warning ring lead time before a relocation
const MOVE_MIN = 11, MOVE_MAX = 13;
const IDLE_COLOR = 0x9cff6a; // unclaimed plate
const HOT_COLOR = 0xff3a20;  // contested flicker

export class HotSeat extends Minigame {
  static meta = {
    id: 'hotseat',
    title: 'HOT SEAT',
    tagline: 'Sit down. Stay down. Mind the fence.',
    category: 'Competitive',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Hold the pressure plate alone for the most seconds.',
    rules: [
      'Stand on the glowing plate alone to earn 1 point per second.',
      'Two or more on it is contested — nobody scores. Shove them off.',
      'Every ~12 s the plate relocates. A red ring marks the next spot.',
      'The fence is electrified. Fried subjects rank below every survivor.',
    ],
  };

  build() {
    const F = HALF + 0.12; // visual fence line
    const scene = this.makeScene({
      fogNear: 20, fogFar: 55,
      floorAt: (x, z) => (Math.abs(x) <= F + 0.3 && Math.abs(z) <= F + 0.3 ? 0 : -0.6),
    });
    this.makeCamera([0, 17, 12.5], [0, 0, 0.5], 48);

    // --- room: sunken concrete floor, back wall, raised steel platform
    floor(scene, 60, 44, { tex: 'concrete', tile: 3, y: -0.6 });
    scene.add(mesh(new THREE.PlaneGeometry(44, 12), mat(0xffffff, Tex.wall([11, 3])), 0, 5, -10.5, { cast: false }));
    stencil(scene, 'HIGH VOLTAGE', 0, 2.8, -10.4, { w: 7, h: 2, opacity: 0.55 });
    pipe(scene, [-18, 5.2, -10.2], [18, 5.2, -10.2], 0.25);
    pipe(scene, [-18, 4.4, -10.3], [18, 4.4, -10.3], 0.1, 0x5a3022);

    block(scene, 0, -0.3, 0, F * 2 + 0.6, 0.6, F * 2 + 0.6, mat(0xffffff, Tex.plate([5, 5])));
    floor(scene, HALF * 2, HALF * 2, { tex: 'tiles', tile: 1.3, y: 0.004 });
    stencil(scene, 'REMAIN SEATED', 0, 0.015, 3.6, { w: 6, h: 1.6, opacity: 0.18 }).rotation.x = -Math.PI / 2;
    hazardStrip(scene, 0, -HALF + 0.3, HALF * 2, 0.6, 0.012);
    hazardStrip(scene, 0, HALF - 0.3, HALF * 2, 0.6, 0.012);
    hazardStrip(scene, -HALF + 0.3, 0, 0.6, HALF * 2 - 1.2, 0.012);
    hazardStrip(scene, HALF - 0.3, 0, 0.6, HALF * 2 - 1.2, 0.012);

    // --- electrified fence: posts + three humming wires per side (shared geometry)
    const postGeo = new THREE.BoxGeometry(0.14, 1.35, 0.14);
    const postMat = mat(0x4a4a44, Tex.metal());
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = -F + (2 * F * i) / N;
      const spots = [[t, -F], [t, F]];
      if (i > 0 && i < N) spots.push([-F, t], [F, t]);
      for (const [x, z] of spots) scene.add(mesh(postGeo, postMat, x, 0.675, z));
    }
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff });
    const wireGeo = new THREE.BoxGeometry(2 * F, 0.035, 0.035);
    for (const h of [0.35, 0.7, 1.05]) {
      for (const [x, z, ry] of [[0, -F, 0], [0, F, 0], [-F, 0, Math.PI / 2], [F, 0, Math.PI / 2]]) {
        const w = mesh(wireGeo, this.wireMat, x, h, z, { cast: false, receive: false });
        w.rotation.y = ry;
        scene.add(w);
      }
    }
    // Transformers feeding the fence from the back corners.
    const boxMat = mat(0x5a5f55, Tex.metal());
    for (const sx of [-1, 1]) {
      const bx = sx * (F + 1.7), bz = -F - 1.1;
      block(scene, bx, 0, bz, 1.4, 1.2, 1.1, boxMat);
      scene.add(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), glow(0x3aff5a), bx, 0.3, bz + 0.57, { cast: false }));
      pipe(scene, [bx, 0.6, bz], [sx * F, 1.05, -F], 0.05, 0x22221f);
    }

    hangingLamp(scene, -3.5, 8, 0, { intensity: 85, angle: 0.85 });
    hangingLamp(scene, 3.5, 8, 0, { intensity: 85, angle: 0.85 });

    // --- the pressure plate
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(PLATE_R + 0.18, PLATE_R + 0.24, 0.05, 28), mat(0x3a3b38, Tex.metal()), 0, 0.025, 0, { cast: false }));
    this.padMat = new THREE.MeshBasicMaterial({ color: IDLE_COLOR });
    g.add(mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R, 0.07, 28), this.padMat, 0, 0.04, 0, { cast: false }));
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x1b1a17 });
    const inner = mesh(new THREE.RingGeometry(PLATE_R * 0.5, PLATE_R * 0.62, 28), darkMat, 0, 0.078, 0, { cast: false, receive: false });
    inner.rotation.x = -Math.PI / 2;
    const dot = mesh(new THREE.CircleGeometry(PLATE_R * 0.16, 14), darkMat, 0, 0.078, 0, { cast: false, receive: false });
    dot.rotation.x = -Math.PI / 2;
    g.add(inner, dot);
    this.plateLight = new THREE.PointLight(IDLE_COLOR, 10, 6, 1.5);
    this.plateLight.position.y = 1.2;
    g.add(this.plateLight);
    scene.add(g);
    this.plateGroup = g;

    // Warning ring at the next spot.
    this.warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    this.warnRing = new THREE.Mesh(new THREE.RingGeometry(PLATE_R - 0.12, PLATE_R + 0.08, 32), this.warnMat);
    this.warnRing.rotation.x = -Math.PI / 2;
    this.warnRing.position.y = 0.03;
    this.warnRing.visible = false;
    scene.add(this.warnRing);

    // --- plate state
    this.plate = { x: 0, z: 0 };
    this.next = { x: 0, z: 0 };
    this.warned = false;
    this.nextMoveAt = Infinity;   // set at GO
    this.holder = null;
    this.contested = false;
    this.contestSfxAt = -10;
    this.plateBoot = 1;
    this.arcT = 0.4;
    this.arcIdx = 0;
    this._col = new THREE.Color();

    // --- arena + avatars, evenly around the plate
    this.arena = new Arena({ bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF }, shoveForce: 13 });
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      const ang = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(ang) * 3.2, z = Math.sin(ang) * 3.2;
      const facing = Math.atan2(-x, -z);
      this.spawnSubject(seat, { x, z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = facing;
      seat.actor.seat = seat;
      seat.actor.data.hold = 0;
      seat.actor.data.onPlate = false;
    });
    this.arena.onShove = (a, b) => { b.data.lastShover = a.seat; b.data.shovedAt = this.time; };
  }

  start() {
    this.nextMoveAt = rand(MOVE_MIN, MOVE_MAX);
    this.hud.banner('CLAIM THE PLATE', 1000);
    this.hud.prompt('Stand on the plate alone to score · {B} shoves');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
    for (const seat of this.seats) { this.hud.setStat(seat, `POINTS ${seat.score}`); this.hud.setStatus(seat, ''); }
    this.hud.setTimer(ROUND);
  }

  preview(dt) {
    this._animate(dt);
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  // ------------------------------------------------------------------ plate

  /** Random plate spot on the platform, preferably far from (fx, fz). Bounded loop → deterministic. */
  _pickSpot(fx, fz) {
    const lim = HALF - PLATE_MARGIN;
    let best = null, bestD = -1;
    for (let i = 0; i < 12; i++) {
      const x = rand(-lim, lim), z = rand(-lim, lim);
      const d = Math.hypot(x - fx, z - fz);
      if (d >= 4.5) return { x, z };
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    return best;
  }

  _warn() {
    const s = this._pickSpot(this.plate.x, this.plate.z);
    this.next.x = s.x; this.next.z = s.z;
    this.warned = true;
    this.warnRing.position.set(s.x, 0.03, s.z);
    this.warnRing.visible = true;
    Audio.sfx('beep');
    Audio.sfx('buzz', { vol: 0.4 });
    this.hud.banner('PLATE RELOCATING', 1300, 'danger');
  }

  _relocate() {
    const old = new THREE.Vector3(this.plate.x, 0.2, this.plate.z);
    this.fx.sparks(old, { color: 0xffd27a, count: 10, speed: 4 });
    this.fx.smoke(old, { color: 0x555555, size: 0.4, life: 1.2 });
    this.plate.x = this.next.x; this.plate.z = this.next.z;
    this.plateGroup.position.set(this.plate.x, 0, this.plate.z);
    this.plateBoot = 0;
    this.warned = false;
    this.warnRing.visible = false;
    this.nextMoveAt += rand(MOVE_MIN, MOVE_MAX);
    Audio.sfx('clank');
    Audio.sfx('ding', { vol: 0.5 });
    this.hud.banner('PLATE LIVE', 900);
  }

  /** Cosmetic animation (fence hum, arcs, plate glow, warning ring). Deterministic: clock-based, no rng. */
  _animate(dt) {
    const c = this.clock;
    const f = 0.6 + 0.4 * Math.abs(Math.sin(c * 31) * Math.sin(c * 7.7));
    this.wireMat.color.setRGB(0.45 * f, 0.75 * f, f);

    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = 0.5 + 0.6 * Math.abs(Math.sin(c * 2.3));
      const i = this.arcIdx++;
      const F = HALF + 0.12;
      const t = (((i * 0.618034) % 1) * 2 - 1) * HALF;
      const side = i % 4;
      const x = side === 0 || side === 1 ? t : side === 2 ? -F : F;
      const z = side === 0 ? -F : side === 1 ? F : t;
      this.fx.sparks(new THREE.Vector3(x, 0.35 + (i % 3) * 0.35, z), { color: 0xbfe6ff, count: 5, speed: 3 });
    }

    this.plateBoot = Math.min(1, this.plateBoot + dt * 3);
    const b = 1 - (1 - this.plateBoot) ** 3;
    const s = 0.2 + 0.8 * b;
    this.plateGroup.scale.set(s, 1, s);
    let k;
    if (this.contested) {
      const on = Math.floor(c * 14) % 2 === 0;
      this._col.setHex(on ? HOT_COLOR : 0x3a0c06);
      k = on ? 1 : 0.2;
    } else if (this.holder) {
      this._col.set(this.holder.player.color);
      k = 0.85 + 0.15 * Math.sin(c * 6);
    } else {
      this._col.setHex(IDLE_COLOR);
      k = 0.6 + 0.3 * Math.sin(c * 3);
    }
    if (this.warned && Math.floor(c * 10) % 2 === 1) k *= 0.4; // powering down
    this.padMat.color.copy(this._col).multiplyScalar(0.35 + 0.65 * k);
    this.plateLight.color.copy(this._col);
    this.plateLight.intensity = 10 * k * b;

    if (this.warnRing.visible) {
      const p = 0.5 + 0.5 * Math.sin(c * 18);
      this.warnMat.opacity = 0.35 + 0.55 * p;
      this.warnRing.scale.setScalar(1 + 0.08 * p);
    }
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    this._animate(dt);
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    if (!playing) return;

    // The fence.
    const lim = HALF - EDGE;
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (Math.abs(a.pos.x) > lim || Math.abs(a.pos.z) > lim) this._electrocute(seat);
    }

    // Relocation cycle (no new move announced if it would land after the bell).
    if (!this.warned && this.nextMoveAt < ROUND - 0.5 && this.time >= this.nextMoveAt - WARN) this._warn();
    if (this.warned && this.time >= this.nextMoveAt) this._relocate();

    // Scoring: exactly one live subject on the plate earns time.
    let holder = null, count = 0;
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      const on = Math.hypot(a.pos.x - this.plate.x, a.pos.z - this.plate.z) < PLATE_R;
      a.data.onPlate = on;
      if (on) { count++; holder = seat; }
    }
    const wasContested = this.contested;
    this.contested = count > 1;
    this.holder = count === 1 ? holder : null;
    if (this.contested && !wasContested && this.time - this.contestSfxAt > 1.5) { this.contestSfxAt = this.time; Audio.sfx('buzz', { vol: 0.25 }); }
    if (this.holder) {
      const d = this.holder.actor.data;
      d.hold += dt;
      const pts = Math.floor(d.hold);
      if (pts > this.holder.score) { this.holder.score = pts; Audio.sfx('tick', { vol: 0.7 }); }
    }

    // HUD
    for (const seat of this.seats) {
      this.hud.setStat(seat, `POINTS ${seat.score}`);
      let status = '';
      if (!seat.alive) status = 'FRIED';
      else if (this.holder === seat) status = 'ON THE PLATE';
      else if (this.contested && seat.actor.data.onPlate) status = 'CONTESTED';
      this.hud.setStatus(seat, status);
    }
    this.hud.setTimer(Math.max(0, ROUND - this.time));

    if (this.time >= ROUND) {
      this.hud.banner('TIME UP', 1500);
      this.hud.prompt(null);
      Audio.sfx('horn');
      this.end();
      return;
    }
    this.checkLastStanding();
  }

  _electrocute(seat) {
    const a = seat.actor;
    let px = a.pos.x, pz = a.pos.z;
    if (Math.abs(px) > HALF - EDGE) px = Math.sign(px) * HALF;
    if (Math.abs(pz) > HALF - EDGE) pz = Math.sign(pz) * HALF;
    this.fx.sparks(new THREE.Vector3(px, 0.7, pz), { color: 0x9fd8ff, count: 16, speed: 7 });
    Audio.sfx('buzz');
    const by = a.data.lastShover;
    if (by && by !== seat && this.time - a.data.shovedAt < 1.5) this.hud.feed(`${by.player.name} fried ${seat.player.name}`, by.player.color);
    this.kill(seat, 'burn', { dir: new THREE.Vector3(-a.pos.x, 0, -a.pos.z) });
  }

  /** Survivors by points, then the fried by points (later death breaks ties). */
  placement() {
    const alive = this.seats.filter((s) => s.alive).sort((a, b) => b.score - a.score);
    const dead = this.seats.filter((s) => !s.alive).sort((a, b) => (b.score - a.score) || (b.deathTime - a.deathTime));
    return [
      ...groupBy(alive, (s) => s.score),
      ...groupBy(dead, (s) => `${s.score}|${s.deathTime.toFixed(3)}`),
    ];
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    const diff = brain.difficulty;
    let wantB = false;

    // Periodic aim error + whether this bot bothers to flank this time.
    mem.errT = (mem.errT ?? 0) - dt;
    if (mem.errT <= 0) {
      mem.errT = rand(1.2, 2.4);
      const e = brain.error * 3;
      mem.ox = rand(-e, e); mem.oz = rand(-e, e);
      mem.flank = random() < diff;
    }

    // 1. Where to stand: the plate, or the next spot once it is announced.
    let px = this.plate.x, pz = this.plate.z;
    if (this.warned) {
      const left = this.nextMoveAt - this.time;
      const travel = Math.hypot(this.next.x - a.pos.x, this.next.z - a.pos.z) / a.speed;
      const go = this.holder === seat
        ? left < travel * (1.2 - diff * 0.5) + 0.15            // farm the old plate, then dash
        : WARN - left > brain.reaction + (1 - diff) * 0.5;     // everyone else heads over
      if (go) { px = this.next.x; pz = this.next.z; }
    }
    let tx = px + mem.ox, tz = pz + mem.oz;

    // 2. A rival on our plate: flank it from the inside and shove it outward.
    const n = nearest(a, this.arena.actors);
    const myD = Math.hypot(a.pos.x - px, a.pos.z - pz);
    let rival = null;
    if (n) {
      const r = n.actor;
      if (Math.hypot(r.pos.x - px, r.pos.z - pz) < PLATE_R + 0.4 && myD < PLATE_R + 2.2) rival = r;
    }
    if (rival) {
      let ox = rival.pos.x - px, oz = rival.pos.z - pz, ol = Math.hypot(ox, oz);
      if (ol < 0.25) { ox = rival.pos.x - a.pos.x; oz = rival.pos.z - a.pos.z; ol = Math.hypot(ox, oz) || 1; }
      ox /= ol; oz /= ol;
      if (mem.flank) { tx = rival.pos.x - ox * 0.85; tz = rival.pos.z - oz * 0.85; }
      if (n.dist < 1.35) {
        mem.contest = (mem.contest || 0) + dt;
        if (mem.contest > brain.reaction && a.shoveCd <= 0 && random() < dt * (1 + diff * 4)) wantB = true;
      } else mem.contest = 0;
    } else mem.contest = 0;

    let mx = 0, mz = 0;
    const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz);
    const pace = 0.72 + diff * 0.28;
    if (d > 0.2) { const s = Math.min(1, d / 0.8) * pace; mx = (dx / d) * s; mz = (dz / d) * s; }

    // 3. Soft repulsion from the wire.
    const soft = HALF - 1.7;
    const rep = (v) => (v > soft ? soft - v : v < -soft ? -soft - v : 0);
    mx += rep(a.pos.x) * (1 + diff);
    mz += rep(a.pos.z) * (1 + diff);

    // 4. Danger: sliding toward the fence (knock decays at e^-6t → ~knock/6 left to slide),
    //    or a rival lining us up against it.
    const kl = Math.hypot(a.knock.x, a.knock.z);
    const sx = a.pos.x + a.knock.x / 6, sz = a.pos.z + a.knock.z / 6;
    const danger = HALF - 1.1;
    if (kl > 2 && (Math.abs(sx) > danger || Math.abs(sz) > danger)) {
      mx = Math.abs(sx) > danger ? -Math.sign(sx) : 0;
      mz = Math.abs(sz) > danger ? -Math.sign(sz) : 0;
      wantB = false;
    } else if (n && n.dist < 1.8 && !wantB && diff > 0.25) {
      const ex = Math.abs(a.pos.x) > HALF - 2.4 ? -Math.sign(a.pos.x) : 0;
      const ez = Math.abs(a.pos.z) > HALF - 2.4 ? -Math.sign(a.pos.z) : 0;
      const r = n.actor;
      if ((ex || ez) && (r.pos.x - a.pos.x) * ex + (r.pos.z - a.pos.z) * ez > 0.2) {
        // Rival is between us and the middle: slide along the fence away from it, edging back in.
        let tnx = -ez, tnz = ex;
        if (tnx * (a.pos.x - r.pos.x) + tnz * (a.pos.z - r.pos.z) < 0) { tnx = -tnx; tnz = -tnz; }
        mx = tnx + ex * 0.5; mz = tnz + ez * 0.5;
        if (n.dist < 1.3 && a.shoveCd <= 0 && random() < dt * diff * 3) wantB = true; // shove back
      }
    }

    // Shoving: point the stick at the target so the shove cone faces it.
    if (wantB && n) {
      const r = n.actor, ax = r.pos.x - a.pos.x, az = r.pos.z - a.pos.z, al = Math.hypot(ax, az) || 1;
      mx = (ax / al) * 0.5; mz = (az / al) * 0.5;
      a.facing = Math.atan2(ax, az);
    }
    a.ctrl.setMove(mx, mz);
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    const press = wantB && !mem.bPrev;
    a.ctrl.setButtons(false, press);
    mem.bPrev = press;
  }
}
