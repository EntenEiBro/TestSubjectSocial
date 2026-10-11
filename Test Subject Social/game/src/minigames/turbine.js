/**
 * TURBINE HALL — a square hall lined with grinding shredders. Banks of giant
 * fans blow a gale across the floor. Lean into it.
 *
 * Rules
 *  - All four walls are shredder drums: touching one is a 'slice' death.
 *  - One fan bank blows at a time. The wind pushes every subject toward the
 *    opposite wall (it is added to the actor's knockback velocity every tick),
 *    so you have to walk against it to hold your ground.
 *  - Every 6–9 s the wind moves to another wall. The next bank's warning
 *    lights flash and a banner names the side 1.5 s before it starts.
 *  - The wind pulses, gusts and grows from 3.2 to 5.6 over the first minute
 *    (walking speed is 5.2, so late gusts briefly out-run a walking subject).
 *  - Concrete pillars stand in the hall. Directly downwind of a pillar the
 *    wind drops to a trickle (the lee zone, shown as a dark patch on the floor).
 *  - B shoves. A shove with the wind behind it carries much further and
 *    staggers longer — the house speciality.
 *  - Last subject standing wins. After 70 s the test is concluded and every
 *    survivor shares first place.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { nearest } from '../core/ai.js';
import { clamp, damp } from '../core/util.js';
import { rand, random, pick } from '../core/rng.js';

const H = 7;                  // inner half-extent of the square hall
const EDGE = 0.5;             // shredder bite depth from the wall
const KILL = H - EDGE;        // |x| or |z| beyond this = shredded
const PILLAR_R = 0.75;
const LEE_LEN = 3.4;          // length of the windless zone behind a pillar (from its centre)
const WARN_TIME = 1.5;        // warning before a wind shift
const TIME_CAP = 70;
const FAN_DIST = H + 1.7;     // fan centre distance from the hall centre
const FAN_R = 1.5;
// Wind coming FROM side i travels along DIRS[i] (also the inward normal of that wall):
// 0 = back wall (−Z), 1 = right wall (+X), 2 = front wall (+Z), 3 = left wall (−X).
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const SIDE_BANNER = ['WIND FROM THE BACK', 'WIND FROM THE RIGHT', 'WIND FROM THE FRONT', 'WIND FROM THE LEFT'];
// Pillar layouts (one is picked per round).
const LAYOUTS = [
  [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]],
  [[0, -3.4], [-3.2, 2.4], [3.2, 2.4]],
  [[0, -3.6], [0, 3.6], [-3.6, 0], [3.6, 0]],
];
const MOTES = 150;            // dust specks
const STREAKS = 36;           // wind streak lines

/** Pure hash → [0, 1). Cosmetic particle scatter without touching the game RNG. */
const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class TurbineHall extends Minigame {
  static meta = {
    id: 'turbine',
    title: 'TURBINE HALL',
    tagline: 'The air is fresh. The walls are hungry.',
    category: 'Hazard',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Be the last subject standing.',
    rules: [
      'Giant fans blow across the hall. Walk into the wind to hold your ground.',
      'The wind changes sides every few seconds. Warning lights flash on the next fan bank.',
      'The walls are lined with shredders. Touching them is fatal.',
      'No wind reaches the lee of a pillar. Shove rivals downwind with {B}.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 20, fogFar: 56 });
    this.makeCamera([0, 18, 12.5], [0, 0, 0.6], 44);

    // --- floor, back wall, dressing
    floor(scene, 60, 44, { tex: 'concrete', tile: 3 });
    floor(scene, H * 2, H * 2, { tex: 'plate', tile: 1.75, y: 0.005 });
    stencil(scene, 'STAND FIRM', 0, 0.02, 0, { w: 6, h: 1.8, opacity: 0.18 }).rotation.x = -Math.PI / 2;
    scene.add(mesh(new THREE.PlaneGeometry(50, 12), mat(0xffffff, Tex.wall([12, 3])), 0, 5, -12, { cast: false }));
    stencil(scene, 'AIRFLOW TEST 7', 0, 6.2, -11.9, { w: 9, h: 2.4, opacity: 0.5 });
    pipe(scene, [-22, 8, -11.5], [22, 8, -11.5], 0.32);
    pipe(scene, [-22, 7.2, -11.6], [22, 7.2, -11.6], 0.14, 0x5a3022);

    // --- shredder drums along all four walls
    this.drums = [];
    const steel = mat(0x8d918c, Tex.metal());
    const housing = mat(0xffffff, Tex.rust([6, 1]));
    const toothMat = mat(0xc9ccc6, Tex.metal());
    const toothGeo = new THREE.ConeGeometry(0.06, 0.2, 4);
    const drumGeo = new THREE.CylinderGeometry(0.24, 0.24, H * 2, 10);
    const housingGeo = new THREE.BoxGeometry(H * 2 + 1.4, 1.0, 0.5);
    const hoodGeo = new THREE.BoxGeometry(H * 2 + 1.4, 0.08, 0.55);
    const rows = 3, step = 0.3, perRow = Math.floor((H * 2 - 0.2) / step);
    const dummy = new THREE.Object3D();
    for (let side = 0; side < 4; side++) {
      const [dx, dz] = DIRS[side];
      const g = new THREE.Group();
      g.position.set(-dx * (H - 0.12), 0.42, -dz * (H - 0.12));
      g.rotation.y = Math.atan2(dx, dz); // local +Z points into the hall, local X runs along the wall
      const spin = new THREE.Group();
      const drum = mesh(drumGeo, steel, 0, 0, 0, { cast: false });
      drum.rotation.z = Math.PI / 2;
      const teeth = new THREE.InstancedMesh(toothGeo, toothMat, perRow * rows);
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < perRow; i++) {
          const a = (r / rows) * Math.PI * 2 + i * 0.9;
          dummy.position.set(-H + 0.1 + (i + (r % 2) * 0.5) * step, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
          dummy.rotation.set(a, 0, 0);
          dummy.updateMatrix();
          teeth.setMatrixAt(k++, dummy.matrix);
        }
      }
      teeth.instanceMatrix.needsUpdate = true;
      spin.add(drum, teeth);
      g.add(spin);
      g.add(mesh(housingGeo, housing, 0, 0.08, -0.45, { cast: false }));
      g.add(mesh(hoodGeo, steel, 0, 0.5, -0.12, { cast: false }));
      scene.add(g);
      this.drums.push(spin);
      // Hazard paint inside the bite zone.
      if (dz !== 0) hazardStrip(scene, 0, -dz * (H - 0.3), H * 2, 0.6, 0.012);
      else hazardStrip(scene, -dx * (H - 0.3), 0, 0.6, H * 2, 0.012);
    }

    // --- fan banks: two big fans behind each wall
    const fanBody = mat(0x4a4c47, Tex.metal());
    const bladeMat = mat(0x7b7e76, Tex.metal());
    const darkMat = glow(0x060606);
    const geo = {
      ring: new THREE.TorusGeometry(FAN_R, 0.18, 6, 20),
      blade: new THREE.BoxGeometry(0.5, FAN_R * 0.9, 0.06),
      hub: new THREE.CylinderGeometry(0.28, 0.28, 0.4, 8),
      disc: new THREE.CircleGeometry(FAN_R, 16),
      bar: new THREE.BoxGeometry(FAN_R * 2, 0.07, 0.07),
      leg: new THREE.BoxGeometry(0.2, 2.0, 0.2),
      lamp: new THREE.BoxGeometry(0.5, 0.22, 0.3),
    };
    this.fans = [[], [], [], []];
    this.fanRate = [0, 0, 0, 0];
    this.lampMats = [];
    for (let side = 0; side < 4; side++) {
      const [dx, dz] = DIRS[side];
      const lat = [dz, -dx];
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x2a0a06 });
      this.lampMats.push(lampMat);
      for (const lx of [-3.6, 3.6]) {
        const fg = new THREE.Group();
        fg.position.set(-dx * FAN_DIST + lat[0] * lx, 2.0, -dz * FAN_DIST + lat[1] * lx);
        fg.rotation.y = Math.atan2(dx, dz); // faces into the hall (local +Z = blowing direction)
        const blades = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const pv = new THREE.Group();
          pv.rotation.z = (i / 5) * Math.PI * 2;
          const b = mesh(geo.blade, bladeMat, 0, FAN_R * 0.47, 0, { cast: false });
          b.rotation.y = 0.38;
          pv.add(b);
          blades.add(pv);
        }
        const hub = mesh(geo.hub, fanBody, 0, 0, 0, { cast: false });
        hub.rotation.x = Math.PI / 2;
        blades.add(hub);
        const bar1 = mesh(geo.bar, fanBody, 0, 0, 0.26, { cast: false });
        const bar2 = mesh(geo.bar, fanBody, 0, 0, 0.26, { cast: false });
        bar2.rotation.z = Math.PI / 2;
        fg.add(
          mesh(geo.ring, fanBody, 0, 0, 0, { cast: false }),
          mesh(geo.disc, darkMat, 0, 0, -0.3, { cast: false, receive: false }),
          blades, bar1, bar2,
          mesh(geo.leg, fanBody, -1.0, -1.0, -0.35, { cast: false }),
          mesh(geo.leg, fanBody, 1.0, -1.0, -0.35, { cast: false }),
          mesh(geo.lamp, lampMat, 0, FAN_R + 0.3, 0, { cast: false, receive: false }),
        );
        scene.add(fg);
        this.fans[side].push(blades);
      }
    }
    // A red strobe that sits on the bank about to start.
    this.warnLight = new THREE.PointLight(0xff2a10, 0, 14, 1.6);
    this.warnLight.position.set(0, 2.5, -H);
    scene.add(this.warnLight);

    // --- concrete pillars + their lee patches
    this.pillars = pick(LAYOUTS).map(([x, z]) => ({ x, z }));
    const concrete = mat(0xb0aba0, Tex.concrete([1, 2]));
    const bandMat = mat(0xffffff, Tex.hazard([3, 0.5]));
    const pGeo = new THREE.CylinderGeometry(PILLAR_R, PILLAR_R * 1.05, 2.2, 10);
    const bandGeo = new THREE.CylinderGeometry(PILLAR_R * 1.06 + 0.02, PILLAR_R * 1.06 + 0.02, 0.35, 10, 1, true);
    const capGeo = new THREE.CylinderGeometry(PILLAR_R + 0.12, PILLAR_R + 0.12, 0.18, 10);
    this.leeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    const leeGeo = new THREE.PlaneGeometry(PILLAR_R * 1.6, LEE_LEN - PILLAR_R);
    this.lees = [];
    for (const p of this.pillars) {
      scene.add(mesh(pGeo, concrete, p.x, 1.1, p.z));
      scene.add(mesh(bandGeo, bandMat, p.x, 0.32, p.z, { cast: false }));
      scene.add(mesh(capGeo, concrete, p.x, 2.25, p.z));
      const lg = new THREE.Group();
      lg.position.set(p.x, 0.03, p.z);
      const plane = new THREE.Mesh(leeGeo, this.leeMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.z = (PILLAR_R + LEE_LEN) / 2;
      lg.add(plane);
      scene.add(lg);
      this.lees.push(lg);
    }

    hangingLamp(scene, 0, 8.5, 0, { intensity: 120, angle: 0.95 });
    hangingLamp(scene, -5, 7.5, -3, { intensity: 45, angle: 0.8, shadow: false });
    hangingLamp(scene, 5, 7.5, 3, { intensity: 45, angle: 0.8, shadow: false });

    // --- arena + avatars
    this.arena = new Arena({ bounds: { minX: -H, maxX: H, minZ: -H, maxZ: H }, shoveForce: 13 });
    for (const p of this.pillars) this.arena.addCircle(p.x, p.z, PILLAR_R);
    const spots = [[-1.8, -1.8], [1.8, 1.8], [1.8, -1.8], [-1.8, 1.8]];
    this.seats.forEach((seat, i) => {
      const [x, z] = spots[i % spots.length];
      const facing = Math.atan2(-x, -z);
      this.spawnSubject(seat, { x, z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = facing;
      seat.actor.seat = seat;
      seat.actor.data.shelter = 0;
    });
    this.arena.onShove = (a, b) => {
      b.data.lastShover = a.seat;
      b.data.shovedAt = this.time;
      // A shove with the wind behind it carries much further and staggers longer.
      const w = this.wind;
      if (this.state !== 'play' || w.side < 0) return;
      const [dx, dz] = DIRS[w.side];
      const ux = b.pos.x - a.pos.x, uz = b.pos.z - a.pos.z, d = Math.hypot(ux, uz) || 1;
      const down = (ux * dx + uz * dz) / d;
      if (down <= 0) return;
      const f = (3 + w.W * 0.9) * down;
      b.knock.x += dx * f;
      b.knock.z += dz * f;
      b.stun = Math.max(b.stun, 0.35 + 0.25 * down);
    };

    // --- wind state (the briefing preview shows the back bank blowing)
    this.wind = { side: 0, pending: null, warnAt: 0, switchAt: 0, warnStart: 0, ramp: 1, W: 2.6 };
    this.maxed = false;
    this.vis = { x: 0, z: 1 };

    // --- dust motes (points) and wind streaks (line segments)
    this.motePos = new Float32Array(MOTES * 3);
    this.moteSeed = new Array(MOTES).fill(0);
    for (let i = 0; i < MOTES; i++) {
      this.motePos[i * 3] = (hash01(i * 3 + 1) * 2 - 1) * H;
      this.motePos[i * 3 + 1] = 0.15 + hash01(i * 3 + 2) * 2.2;
      this.motePos[i * 3 + 2] = (hash01(i * 3 + 3) * 2 - 1) * H;
    }
    const moteGeo = new THREE.BufferGeometry();
    this.moteAttr = new THREE.BufferAttribute(this.motePos, 3);
    moteGeo.setAttribute('position', this.moteAttr);
    const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xbfb49a, size: 0.09, transparent: true, opacity: 0.6, depthWrite: false }));
    motes.frustumCulled = false;
    scene.add(motes);

    this.streakHead = new Float32Array(STREAKS * 3);
    this.streakSeed = new Array(STREAKS).fill(0);
    for (let i = 0; i < STREAKS; i++) {
      this.streakHead[i * 3] = (hash01(i * 5 + 11) * 2 - 1) * H;
      this.streakHead[i * 3 + 1] = 0.3 + hash01(i * 5 + 12) * 2.0;
      this.streakHead[i * 3 + 2] = (hash01(i * 5 + 13) * 2 - 1) * H;
    }
    this.streakPos = new Float32Array(STREAKS * 6);
    const streakGeo = new THREE.BufferGeometry();
    this.streakAttr = new THREE.BufferAttribute(this.streakPos, 3);
    streakGeo.setAttribute('position', this.streakAttr);
    this.streakMat = new THREE.LineBasicMaterial({ color: 0xd8d4c8, transparent: true, opacity: 0, depthWrite: false });
    const streaks = new THREE.LineSegments(streakGeo, this.streakMat);
    streaks.frustumCulled = false;
    scene.add(streaks);
  }

  start() {
    const w = this.wind;
    w.side = -1;          // calm until the first bank spins up
    w.pending = null;
    w.warnAt = 1.0;
    w.ramp = 0;
    w.W = 0;
    this.hud.banner('HOLD YOUR GROUND', 1000);
    this.hud.prompt('Walk into the wind · {B} shove');
    setTimeout(() => this.hud.prompt(null), 4500);
  }

  preview(dt) {
    this._animate(dt);
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  // -------------------------------------------------------------------- wind

  /** Windless factor 0..1 at (x, z) for wind along (dx, dz): 1 = fully in a pillar's lee. */
  _shelter(x, z, dx, dz) {
    let best = 0;
    for (const p of this.pillars) {
      const rx = x - p.x, rz = z - p.z;
      const along = rx * dx + rz * dz;
      if (along <= 0 || along >= LEE_LEN) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      const s = clamp((PILLAR_R + 0.15 - perp) / 0.3, 0, 1) * clamp((LEE_LEN - along) / 0.8, 0, 1);
      if (s > best) best = s;
    }
    return best * 0.85; // eddies: the lee kills most of the wind, not all of it
  }

  /** Warnings, shifts and the strength curve. Gameplay only (state === 'play'). */
  _updateWind(dt) {
    const w = this.wind, t = this.time;
    if (w.pending === null && t >= w.warnAt) {
      w.pending = pick([0, 1, 2, 3].filter((s) => s !== w.side));
      w.warnStart = t;
      w.switchAt = t + WARN_TIME;
      this.hud.banner(SIDE_BANNER[w.pending], 1500, 'danger');
      Audio.sfx('horn', { vol: 0.45 });
    }
    if (w.pending !== null && t >= w.switchAt) {
      w.side = w.pending;
      w.pending = null;
      w.ramp = 0.6;
      w.warnAt = t + rand(6, 9) - WARN_TIME;
      Audio.sfx('grind', { vol: 0.5 });
      Audio.sfx('whoosh', { vol: 0.6 });
    }
    w.ramp = Math.min(1, w.ramp + dt * 1.6);
    if (w.side < 0) { w.W = 0; return; }
    // 3.2 → 5.6 over the first minute; sharp pulses plus irregular gusts that can
    // briefly out-run a walking subject late in the round.
    const base = 3.2 + 2.4 * clamp(t / 60, 0, 1);
    const pulse = 0.72 + 0.28 * Math.sin(t * 2.3 + 0.8 * Math.sin(t * 0.7));
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.83 + 1.7 * Math.sin(t * 0.31))), 8) * 0.3;
    w.W = base * Math.min(1.2, pulse + gust) * w.ramp;
  }

  // ------------------------------------------------------------------ visuals

  /** Purely cosmetic animation (fans, drums, lamps, lee patches, dust). */
  _animate(dt) {
    const w = this.wind;
    for (const d of this.drums) d.rotation.x -= dt * 8;

    // Fans: the active bank roars, the warned bank starts turning, the rest coast down.
    const strobe = Math.sin(this.clock * 18) > 0;
    for (let s = 0; s < 4; s++) {
      const target = s === w.side ? 2.5 + w.W * 2.2 : s === w.pending ? 1.2 : 0;
      this.fanRate[s] += (target - this.fanRate[s]) * damp(1.6, dt);
      for (const b of this.fans[s]) b.rotation.z += this.fanRate[s] * dt;
      const col = s === w.pending ? (strobe ? 0xff2010 : 0x300805) : s === w.side ? 0xff9a20 : 0x2a0a06;
      this.lampMats[s].color.setHex(col);
    }
    if (w.pending !== null) {
      const [dx, dz] = DIRS[w.pending];
      this.warnLight.position.set(-dx * (H + 0.6), 2.5, -dz * (H + 0.6));
      this.warnLight.intensity = strobe ? 18 : 2;
    } else this.warnLight.intensity = 0;

    // Lee patches behind the pillars for the current wind.
    if (w.side >= 0) {
      const [dx, dz] = DIRS[w.side];
      const ang = Math.atan2(dx, dz);
      for (const lg of this.lees) lg.rotation.y = ang;
      this.leeMat.opacity = clamp(w.W / 4.6, 0, 1) * 0.32;
    } else this.leeMat.opacity = 0;

    // Visual wind direction eases toward the real one.
    const tgt = w.side >= 0 ? DIRS[w.side] : w.pending !== null ? DIRS[w.pending] : DIRS[0];
    const k = damp(3, dt);
    this.vis.x += (tgt[0] - this.vis.x) * k;
    this.vis.z += (tgt[1] - this.vis.z) * k;
    let len = Math.hypot(this.vis.x, this.vis.z);
    let vx = this.vis.x, vz = this.vis.z;
    if (len < 0.05) { vx = tgt[0]; vz = tgt[1]; len = 1; }
    vx /= len; vz /= len;

    const spd = 0.5 + w.W * 1.9;
    const P = this.motePos;
    for (let i = 0; i < MOTES; i++) {
      const o = i * 3;
      this._advanceMote(P, o, i, this.moteSeed, spd * (0.6 + hash01(i * 7.13) * 0.8), dt, vx, vz);
    }
    this.moteAttr.needsUpdate = true;

    const S = this.streakHead, L = this.streakPos;
    const tail = 0.3 + w.W * 0.2;
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 3;
      this._advanceMote(S, o, i + 1000, this.streakSeed, spd * (1.2 + hash01(i * 3.71) * 0.6), dt, vx, vz, i);
      const q = i * 6;
      L[q] = S[o]; L[q + 1] = S[o + 1]; L[q + 2] = S[o + 2];
      L[q + 3] = S[o] - vx * tail; L[q + 4] = S[o + 1]; L[q + 5] = S[o + 2] - vz * tail;
    }
    this.streakAttr.needsUpdate = true;
    this.streakMat.opacity = clamp(0.05 + w.W * 0.08, 0, 0.42);
  }

  /** Drift one particle with the wind; respawn it on the upwind side once it leaves the hall. */
  _advanceMote(P, o, id, seeds, speed, dt, vx, vz, seedIdx = id) {
    let x = P[o], y = P[o + 1], z = P[o + 2];
    const calm = 1 - 0.85 * this._shelter(x, z, vx, vz);
    const wob = Math.sin(this.clock * 2 + id) * 0.35;
    x += (vx * speed * calm + vz * wob) * dt;
    z += (vz * speed * calm - vx * wob) * dt;
    y += Math.sin(this.clock * 1.3 + id * 0.7) * 0.15 * dt;
    if (Math.abs(x) > H + 0.6 || Math.abs(z) > H + 0.6 || y < 0.05 || y > 3) {
      const s = ++seeds[seedIdx];
      const lat = (hash01(id * 13.7 + s * 3.1) * 2 - 1) * H;
      x = -vx * (H + 0.4) + vz * lat;
      z = -vz * (H + 0.4) - vx * lat;
      y = 0.15 + hash01(id * 5.3 + s * 1.7) * 2.2;
    }
    P[o] = x; P[o + 1] = y; P[o + 2] = z;
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    const w = this.wind;
    if (playing) this._updateWind(dt);
    else { w.W = Math.max(0, w.W - dt * 3); w.pending = null; } // fans wind down once the round is decided

    // Wind force: steady push added to the knockback (decays at 6/s → settles at W).
    const dir = playing && w.side >= 0 ? DIRS[w.side] : null;
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      a.data.shelter = dir ? this._shelter(a.pos.x, a.pos.z, dir[0], dir[1]) : 0;
      if (!dir || w.W <= 0) continue;
      const f = w.W * (1 - a.data.shelter) * 6 * dt;
      a.knock.x += dir[0] * f;
      a.knock.z += dir[1] * f;
    }
    this.arena.step(dt, playing);
    this._animate(dt);
    if (!playing) return;

    // Shredders
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (Math.abs(a.pos.x) > KILL || Math.abs(a.pos.z) > KILL) {
        this._credit(seat);
        this.fx.sparks(new THREE.Vector3(a.pos.x, 0.6, a.pos.z), { count: 14 });
        this.kill(seat, 'slice', { dir: new THREE.Vector3(-a.pos.x, 0, -a.pos.z), force: 0.9 });
      }
    }

    for (const seat of this.seats) {
      this.hud.setStat(seat, seat.alive ? 'ALIVE' : 'SHREDDED');
      this.hud.setStatus(seat, seat.alive && seat.actor.data.shelter > 0.5 ? 'SHELTERED' : '');
    }
    this.hud.setTimer(Math.max(0, TIME_CAP - this.time));
    if (!this.maxed && this.time >= 50 && w.pending === null) {
      this.maxed = true;
      this.hud.banner('MAXIMUM AIRFLOW', 1400, 'danger');
      Audio.sfx('buzz', { vol: 0.5 });
    }
    if (this.checkLastStanding()) return;
    if (this.time >= TIME_CAP) {
      this.hud.banner('VENTILATION TEST CONCLUDED', 1800);
      Audio.sfx('horn');
      this.end();
    }
  }

  /** Feed line for a subject shoved into the shredders within the last 2 s. */
  _credit(seat) {
    const d = seat.actor.data, by = d.lastShover;
    if (by && by !== seat && this.time - d.shovedAt < 2) this.hud.feed(`${by.player.name} fed the shredders`, by.player.color);
  }

  // --------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory, w = this.wind;
    if (mem.wx === undefined) {
      Object.assign(mem, {
        wx: 0, wz: 0, think: 0, mode: 'hold', tx: a.pos.x * 0.5, tz: a.pos.z * 0.5, prey: null, pillar: null, plan: null,
        bPrev: false, daze: 0, jx: rand(-1, 1), seenSide: -1, blind: null, antRoll: -1, antFor: -1,
      });
    }
    const cur = w.side >= 0 ? DIRS[w.side] : null;
    // Did the bot register the warning? (rolled once per warning; sloppy bots sometimes ignore it)
    if (w.pending !== null && mem.antRoll !== w.warnStart && this.time - w.warnStart > brain.reaction + (1 - brain.difficulty) * 0.9) {
      mem.antRoll = w.warnStart;
      mem.antFor = random() < brain.error * 1.5 ? -2 : w.pending;
    }
    // A wind shift goes unnoticed for a moment: until then the bot fights the old wind.
    if (w.side !== mem.seenSide) {
      if (mem.blind === null) {
        mem.blind = brain.reaction * 1.5 + (1 - brain.difficulty) * 0.9 + rand(0, 0.35);
        if (mem.antFor === w.side) mem.blind *= 0.5; // saw it coming
      }
      mem.blind -= dt;
      if (mem.blind <= 0) { mem.seenSide = w.side; mem.blind = null; }
    }
    const seen = mem.seenSide >= 0 ? DIRS[mem.seenSide] : null;
    // Perceived wind (old direction while blind) is smoothed by the reaction time.
    const wx = seen ? seen[0] * w.W : 0, wz = seen ? seen[1] * w.W : 0;
    const lag = Math.min(1, dt / (0.06 + brain.reaction));
    mem.wx += (wx - mem.wx) * lag;
    mem.wz += (wz - mem.wz) * lag;
    // Plan for the upcoming wind once the warning has registered.
    let plan = seen;
    if (mem.antFor >= 0 && (mem.antFor === w.pending || mem.antFor === w.side)) plan = DIRS[mem.antFor];
    mem.daze = Math.max(0, mem.daze - dt);
    mem.think -= dt;
    if (mem.think <= 0 || mem.plan !== plan) {
      mem.think = 0.3 + rand(0, 0.3);
      mem.plan = plan;
      this._botPlan(seat, plan);
    }

    // Where to stand this tick.
    let tx = mem.tx, tz = mem.tz;
    const prey = mem.mode === 'hunt' && mem.prey && mem.prey.alive ? mem.prey : null;
    if (mem.mode === 'hunt' && !prey) { mem.mode = 'hold'; mem.think = 0; }
    if (prey && plan) { tx = prey.pos.x - plan[0] * 0.85; tz = prey.pos.z - plan[1] * 0.85; }
    if (mem.mode === 'shelter' && mem.pillar && plan) {
      // Walk around the pillar instead of into it when approaching from upwind.
      const p = mem.pillar;
      const rx = a.pos.x - p.x, rz = a.pos.z - p.z;
      const along = rx * plan[0] + rz * plan[1];
      const perp = rx * plan[1] - rz * plan[0];
      if (along < 0.3 && Math.abs(perp) < PILLAR_R + 0.6) {
        const sgn = perp >= 0 ? 1 : -1;
        tx = p.x + plan[1] * sgn * (PILLAR_R + 0.9);
        tz = p.z - plan[0] * sgn * (PILLAR_R + 0.9);
      }
    }

    // Desired velocity toward the spot, minus the (perceived) wind it has to beat.
    const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz);
    const want = d > 0.05 ? Math.min(1, d / 1.2) * a.speed : 0;
    const shelter = cur ? this._shelter(a.pos.x, a.pos.z, cur[0], cur[1]) : 0;
    const comp = (mem.daze > 0 ? 0.1 : 0.45 + 0.5 * brain.difficulty) * (1 - shelter);
    let mx = ((d > 0.05 ? (dx / d) * want : 0) - mem.wx * comp) / a.speed;
    let mz = ((d > 0.05 ? (dz / d) * want : 0) - mem.wz * comp) / a.speed;
    // Panic: shredder close behind → claw straight back inward (not while dazed).
    const m = 1.3, pk = mem.daze > 0 ? 0 : 1.4 * (0.4 + 0.6 * brain.difficulty);
    if (a.pos.x > KILL - m) mx -= ((a.pos.x - (KILL - m)) / m) * pk;
    if (a.pos.x < -KILL + m) mx += ((-KILL + m - a.pos.x) / m) * pk;
    if (a.pos.z > KILL - m) mz -= ((a.pos.z - (KILL - m)) / m) * pk;
    if (a.pos.z < -KILL + m) mz += ((-KILL + m - a.pos.z) / m) * pk;

    // Shove a rival who stands downwind of us.
    let wantB = false;
    const n = nearest(a, this.arena.actors);
    if (cur && n && n.dist < 1.35 && n.dist > 0.01 && a.shoveCd <= 0) {
      const t = n.actor;
      const ux = (t.pos.x - a.pos.x) / n.dist, uz = (t.pos.z - a.pos.z) / n.dist;
      const downwind = ux * cur[0] + uz * cur[1];
      const chance = (prey === t ? 2.5 : 1.2) * brain.difficulty * 2.5 * dt;
      if (downwind > 0.3 && random() < chance) { wantB = true; mx = ux; mz = uz; } // move toward = face toward
    }
    a.ctrl.setMove(mx, mz);
    a.ctrl.setButtons(false, wantB && !mem.bPrev);
    mem.bPrev = wantB && !mem.bPrev;
  }

  /** Pick a mode + target: hunt a rival downwind, take a pillar's lee, or hold upwind of centre. */
  _botPlan(seat, plan) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    const err = brain.error * 2.5;
    if (random() < brain.error * 0.45) mem.daze = rand(0.4, 1.0); // lapse of concentration
    if (!plan) {
      mem.mode = 'hold'; mem.pillar = null;
      mem.tx = a.pos.x * 0.5 + rand(-err, err);
      mem.tz = a.pos.z * 0.5 + rand(-err, err);
      return;
    }
    const [px, pz] = plan;
    const myDown = a.pos.x * px + a.pos.z * pz; // how far downwind we already stand

    // 1) Hunt: a close rival downwind of us, while we have room behind us.
    const n = nearest(a, this.arena.actors);
    if (n && n.dist < 5 && KILL - myDown > 2.5) {
      const t = n.actor;
      const rel = (t.pos.x - a.pos.x) * px + (t.pos.z - a.pos.z) * pz;
      const keep = mem.mode === 'hunt' && mem.prey === t;
      if (rel > 0.3 && (keep || random() < 0.25 + brain.difficulty * 0.5)) { mem.mode = 'hunt'; mem.prey = t; mem.pillar = null; return; }
    }
    mem.prey = null;

    // 2) Shelter: the lee of the nearest free pillar.
    let best = null, bd = Infinity;
    const off = PILLAR_R + 0.42 + 0.35;
    for (const p of this.pillars) {
      const sx = p.x + px * off, sz = p.z + pz * off;
      if (KILL - (sx * px + sz * pz) < 1.3) continue; // that lee ends in the shredder
      const d = Math.hypot(sx - a.pos.x, sz - a.pos.z);
      let taken = false;
      for (const o of this.arena.actors) {
        if (o !== a && o.alive && Math.hypot(o.pos.x - sx, o.pos.z - sz) < Math.min(0.9, d)) { taken = true; break; }
      }
      if (!taken && d < bd) { bd = d; best = { x: sx, z: sz, p }; }
    }
    const sticky = mem.mode === 'shelter' && best && mem.pillar === best.p && random() < 0.6 + brain.difficulty * 0.35;
    if (best && bd < 6.5 && (sticky || random() < 0.15 + brain.difficulty * 0.5)) {
      mem.mode = 'shelter'; mem.pillar = best.p;
      mem.tx = best.x + rand(-err, err) * 0.3;
      mem.tz = best.z + rand(-err, err) * 0.3;
      return;
    }

    // 3) Hold: upwind of the centre, so the next shift leaves room to drift.
    mem.mode = 'hold'; mem.pillar = null;
    const back = 0.6 + brain.difficulty * 1.6;
    mem.tx = -px * back + pz * mem.jx * 1.5 + rand(-err, err);
    mem.tz = -pz * back - px * mem.jx * 1.5 + rand(-err, err);
  }
}
