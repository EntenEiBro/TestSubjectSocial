/**
 * WINCH RACE — a tall service shaft, one lift platform per subject, a meat
 * grinder coming up from below.
 *
 * Rules
 *  - Every subject stands on their own platform (lanes side by side, seen
 *    from the front). Alternate A and B (A, B, A, B…) to crank the winch:
 *    each clean alternation lifts the platform LIFT metres.
 *  - Pressing the same button twice in a row (or both at once) slips the
 *    ratchet: the platform drops SLIP_DROP and the crank is jammed for
 *    SLIP_STUN seconds (presses are ignored meanwhile).
 *  - The winch has a top speed (CLIMB_SPEED). Cranks are queued (at most
 *    two turns); mashing faster than the winch turns is wasted.
 *  - The grinder rises from below and keeps speeding up. If its teeth reach
 *    your platform you are minced ('gib').
 *  - The first platform to reach the hatch at TOP (20 m) escapes; the round
 *    ends when everyone has escaped or died (the grinder guarantees this in
 *    under 30 s), with a 60 s safety cap.
 *  - Ranking: escapees in order, then survivors by height (cap only), then
 *    the dead in reverse death order.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { block, stencil, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { Haptics } from '../core/haptics.js';
import { clamp, damp } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const LANE_W = 2.4;            // lane width (x)
const DECK_W = LANE_W - 0.35;  // platform width
const TOP = 20;                // hatch height (platform deck)
const CEIL = TOP + 2.4;        // underside of the ceiling
const LIFT = 0.125;            // metres per clean crank
const CLIMB_SPEED = 1.25;      // max platform speed → caps the useful crank rate at 10/s
const QUEUE_MAX = LIFT * 2;    // cranks buffered beyond this are wasted
const SLIP_DROP = 0.25;
const SLIP_STUN = 0.4;
const G_START = -5;            // grinder teeth height at GO
const G_SPEED = 0.45;          // initial rise speed (m/s)
const G_ACCEL = 0.032;         // speed gain per second
const G_MAX = TOP - 0.1;       // grinder stops just under the hatch level
const KILL_MARGIN = 0.2;       // teeth this close below the deck = minced
const WARN_GAP = 2.5;          // HUD / lamp warning distance
const ACCEL_AT = 14;           // "grinder accelerating" banner
const CAP = 60;                // safety cap
const CRANK_X = 0.66;          // winch post offset on the platform

/** Toothed cutter disc profile (flat star, extruded). Pure geometry builder. */
function cutterGeometry(rOut, rIn, points, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = (i / (points * 2)) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

export class WinchRace extends Minigame {
  static meta = {
    id: 'winch',
    title: 'WINCH RACE',
    tagline: 'Upward mobility, powered by you.',
    category: 'Timing',
    controls: [{ input: 'a', label: 'Crank' }, { input: 'b', label: 'Crank' }],
    objective: 'Crank your lift to the hatch before the grinder catches up.',
    rules: [
      'Alternate {A} and {B} to crank your winch. Every clean turn lifts your platform.',
      'Pressing the same button twice slips the ratchet: you drop and stall for a moment.',
      'The winch has a top speed. Mashing faster than it turns is wasted effort.',
      'The grinder below rises faster and faster. First through the hatch wins.',
    ],
  };

  build() {
    const n = this.seats.length;
    const W = n * LANE_W;
    this.W = W;
    this.grinderY = G_START;
    this.gSpeed = G_SPEED;
    this.finishCount = 0;
    this.firstOut = false;
    this.accelWarned = false;
    this.grindT = 0;
    this.camY = 0;
    this.camD = 12;

    // Debris and blood settle on the grinder housing (and fall away elsewhere).
    const scene = this.makeScene({
      fogNear: 22, fogFar: 64, ambient: 0x34363c,
      floorAt: (x, z) => (Math.abs(x) < this.W / 2 + 0.1 && z > -1.45 && z < 0.95 ? this.grinderY - 0.45 : -Infinity),
    });
    this.makeCamera([0, 0, 12], [0, -1, 0], 50);

    // --- the shaft: back wall, side columns, lane dividers
    scene.add(mesh(new THREE.PlaneGeometry(W + 14, 46), mat(0xffffff, Tex.wall([(W + 14) / 4, 46 / 4])), 0, 6, -1.55, { cast: false }));
    const colMat = mat(0xffffff, Tex.concrete([1, 10]));
    for (const s of [-1, 1]) {
      block(scene, s * (W / 2 + 0.55), 5, -0.5, 0.9, 44, 2.1, colMat);
      pipe(scene, [s * (W / 2 + 1.35), -17, -1.2], [s * (W / 2 + 1.35), 27, -1.2], 0.14, 0x5a3022);
    }
    const beamMat = mat(0x6b6158, Tex.metal());
    for (let i = 1; i < n; i++) block(scene, -W / 2 + i * LANE_W, 5, -0.9, 0.14, 44, 1.2, beamMat);
    // Amber cage bulbs up the shaft edges (no lights, just glow).
    const bulbGeo = new THREE.SphereGeometry(0.07, 6, 4), bulbMat = glow(0xffb040);
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + i * LANE_W + (i === 0 ? -0.1 : i === n ? 0.1 : 0);
      for (let y = -4; y <= TOP + 1; y += 4) scene.add(mesh(bulbGeo, bulbMat, x, y, -0.25, { cast: false }));
    }
    // Height markers + wall stencils.
    const lineMat = mat(0xffffff, Tex.hazard([W / 1.5, 1]));
    for (const m of [5, 10, 15]) {
      stencil(scene, `${m}M`, -W / 2 - 2.3, m + 0.35, -1.5, { w: 1.6, h: 0.6, opacity: 0.6 });
      scene.add(mesh(new THREE.PlaneGeometry(W, 0.07), lineMat, 0, m, -1.53, { cast: false }));
    }
    stencil(scene, 'KEEP CRANKING', 0, 8.5, -1.52, { w: 7, h: 2.4, opacity: 0.22 });
    stencil(scene, 'NO WAY DOWN', 0, -2.4, -1.52, { w: 5, h: 1.6, opacity: 0.35 });

    // --- ceiling with one hatch per lane
    block(scene, 0, CEIL + 0.35, -0.2, W + 2.2, 0.7, 2.8, mat(0xffffff, Tex.plate([W / 2, 1])));
    scene.add(mesh(new THREE.PlaneGeometry(W + 2.2, 0.18), mat(0xffffff, Tex.hazard([(W + 2.2) / 1.5, 1])), 0, CEIL + 0.09, 1.205, { cast: false }));
    stencil(scene, 'HATCH 20M', 0, CEIL + 0.45, 1.21, { w: 3.2, h: 0.5, color: '#9dffa0', opacity: 0.8 });
    hangingLamp(scene, -W / 2 - 0.55, CEIL - 0.7, 1.5, { intensity: 45, angle: 1.0, shadow: false, target: { x: 0, y: TOP - 2, z: -1 } });

    // --- follow spot (the only shadow caster), moved with the camera
    this.spot = new THREE.SpotLight(0xffe2b0, 150, 40, 0.8, 0.6, 1.4);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.bias = -0.002;
    this.spotTarget = new THREE.Object3D();
    scene.add(this.spot, this.spotTarget);
    this.spot.target = this.spotTarget;

    this._buildGrinder(scene, W);

    // --- lanes: platform, winch, cable, hatch
    const geo = {
      deck: new THREE.BoxGeometry(DECK_W, 0.16, 1.5),
      edge: new THREE.PlaneGeometry(DECK_W, 0.14),
      beam: new THREE.BoxGeometry(DECK_W - 0.2, 0.14, 0.14),
      post: new THREE.BoxGeometry(0.06, 1.0, 0.06),
      rail: new THREE.BoxGeometry(DECK_W - 0.1, 0.06, 0.06),
      winchPost: new THREE.BoxGeometry(0.16, 0.9, 0.16),
      drum: new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10),
      arm: new THREE.BoxGeometry(0.05, 0.3, 0.04),
      knob: new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6),
      lamp: new THREE.BoxGeometry(0.16, 0.08, 0.06),
      stripe: new THREE.BoxGeometry(DECK_W, 0.02, 0.07),
      cable: new THREE.CylinderGeometry(0.022, 0.022, 1, 4),
      hole: new THREE.PlaneGeometry(1.3, 1.1),
      door: new THREE.BoxGeometry(1.3, 0.06, 1.1),
      exitLamp: new THREE.BoxGeometry(0.3, 0.08, 0.08),
    };
    const M = {
      plate: mat(0xffffff, Tex.plate([1.5, 1])),
      frame: mat(0x3c3a36, Tex.metal()),
      haz: mat(0xffffff, Tex.hazard([2, 1])),
      drum: mat(0x8a6a3a, Tex.rust()),
      steel: mat(0xb0b2ad, Tex.metal()),
      knob: mat(0x8a1c14),
      cable: mat(0x2a2a28),
      hole: glow(0x050505),
      door: mat(0xffffff, Tex.hazard([1, 1])),
    };
    this.seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * LANE_W;
      const g = new THREE.Group();
      g.position.set(x, 0, 0);
      g.add(mesh(geo.deck, M.plate, 0, -0.08, 0));
      g.add(mesh(geo.edge, M.haz, 0, -0.08, 0.752, { cast: false }));
      g.add(mesh(geo.beam, M.frame, 0, -0.25, 0.35), mesh(geo.beam, M.frame, 0, -0.25, -0.35));
      for (const s of [-1, 1]) g.add(mesh(geo.post, M.frame, s * (DECK_W / 2 - 0.08), 0.5, -0.68));
      g.add(mesh(geo.rail, M.frame, 0, 1.0, -0.68));
      g.add(mesh(geo.stripe, glow(seat.player.color), 0, 0.005, 0.69, { cast: false }));
      g.add(mesh(geo.winchPost, M.frame, CRANK_X, 0.45, 0.12));
      const drum = mesh(geo.drum, M.drum, CRANK_X, 0.98, 0.12);
      drum.rotation.x = Math.PI / 2;
      g.add(drum);
      const crank = new THREE.Group();
      crank.position.set(CRANK_X, 0.98, 0.27);
      crank.add(mesh(geo.arm, M.steel, 0, 0.13, 0));
      const knob = mesh(geo.knob, M.knob, 0, 0.27, 0.06);
      knob.rotation.x = Math.PI / 2;
      crank.add(knob);
      g.add(crank);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0x401008 });
      g.add(mesh(geo.lamp, warnMat, -DECK_W / 2 + 0.15, -0.08, 0.78, { cast: false }));
      scene.add(g);

      const cable = mesh(geo.cable, M.cable, x + CRANK_X, 10, 0.12, { cast: false });
      scene.add(cable);

      // Hatch: dark hole in the ceiling + hazard door hinged on its left edge.
      const hole = mesh(geo.hole, M.hole, x, CEIL - 0.005, 0, { cast: false });
      hole.rotation.x = Math.PI / 2;
      scene.add(hole);
      const hatch = new THREE.Group();
      hatch.position.set(x - 0.65, CEIL - 0.02, 0);
      hatch.add(mesh(geo.door, M.door, 0.65, -0.03, 0));
      scene.add(hatch);
      const exitMat = new THREE.MeshBasicMaterial({ color: 0x7a5a10 });
      scene.add(mesh(geo.exitLamp, exitMat, x, CEIL - 0.06, 0.75, { cast: false }));

      const lane = { i, x, group: g, crank, crankAngle: 0, crankTarget: 0, cable, warnMat, exitMat, hatch, hatchOpen: 0, dead: false };
      this.spawnSubject(seat, { x: x - 0.1, y: 0, z: 0.05 });
      seat.subject.root.rotation.y = 0.3; // half-turned toward the crank
      Object.assign(seat, { lane, h: 0, queue: 0, last: null, stun: 0, finished: false, finishRank: 0, finishTime: 0, exitT: 0, cranks: 0, slips: 0 });
    });

    this._animateMachines(0, false);
    this._updateCamera(0, true);
  }

  /** The grinder: a rusted housing filling the shaft, two counter-rotating cutter rollers on top. */
  _buildGrinder(scene, W) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(W + 0.2, 24, 2.4), mat(0xffffff, Tex.rust([W / 2, 10])), 0, -0.45 - 12, -0.25));
    g.add(mesh(new THREE.PlaneGeometry(W + 0.2, 0.5), mat(0xffffff, Tex.hazard([(W + 0.2) / 1.5, 1])), 0, -0.75, 0.955, { cast: false }));
    g.add(stencil(scene, 'GRINDER', 0, -2.0, 0.96, { w: 3.6, h: 1.2, opacity: 0.55, color: '#d8c8a0' }));
    const steel = mat(0x8c8e89, Tex.metal());
    const blade = mat(0xc8cac4, Tex.metal());
    const coreGeo = new THREE.CylinderGeometry(0.22, 0.22, W + 0.1, 8);
    const paddleGeo = new THREE.BoxGeometry(W, 0.07, 0.9);
    const discGeo = cutterGeometry(0.58, 0.42, 12, 0.05);
    this.rollers = [];
    // Disc offsets interleave so the two rollers' cutters mesh without touching.
    for (const [zr, offs] of [[-0.4, [-0.5, 0.3]], [0.45, [-0.3, 0.5]]]) {
      const r = new THREE.Group();
      r.position.set(0, -0.55, zr);
      const core = mesh(coreGeo, steel);
      core.rotation.z = Math.PI / 2;
      r.add(core);
      for (let k = 0; k < 3; k++) { const p = mesh(paddleGeo, steel); p.rotation.x = (k / 3) * Math.PI; r.add(p); }
      for (let i = 0; i < this.seats.length; i++) {
        const lx = (i - (this.seats.length - 1) / 2) * LANE_W;
        for (const off of offs) { const d = mesh(discGeo, blade, lx + off, 0, 0); d.rotation.y = Math.PI / 2; r.add(d); }
      }
      g.add(r);
      this.rollers.push(r);
    }
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), this.beaconMat, s * (W / 2 - 0.25), -0.75, 1.05, { cast: false }));
    this.gLight = new THREE.PointLight(0xff3010, 14, 9, 1.6);
    this.gLight.position.set(0, 0.4, 1.4);
    g.add(this.gLight);
    scene.add(g);
    this.grinder = g;
  }

  // -------------------------------------------------------------- lifecycle

  start() {
    this.hud.banner('CRANK!', 900);
    this.hud.prompt('Alternate {A} and {B} to crank · same button twice slips');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
    Audio.sfx('grind', { vol: 0.6 });
  }

  preview(dt) {
    this._animateMachines(dt, false);
    this._animateSubjects(dt);
    this._updateCamera(dt);
  }

  update(dt) {
    const playing = this.state === 'play';
    if (playing) this._simulate(dt);
    this._animateMachines(dt, playing);
    this._animateSubjects(dt);
    this._updateCamera(dt);
    if (!playing) return;
    this._updateHud();
    this._checkEnd();
  }

  // -------------------------------------------------------------- mechanics

  _simulate(dt) {
    this.gSpeed = G_SPEED + G_ACCEL * this.time;
    this.grinderY = Math.min(G_MAX, this.grinderY + this.gSpeed * dt);
    if (!this.accelWarned && this.time >= ACCEL_AT) {
      this.accelWarned = true;
      this.hud.banner('GRINDER ACCELERATING', 1600, 'danger');
      Audio.sfx('horn', { vol: 0.6 });
    }

    // Everyone who reaches the hatch on the same tick shares the rank.
    const rankNow = this.finishCount + 1;
    let newly = 0, minGap = Infinity;
    for (const seat of this.seats) {
      if (!seat.alive || seat.finished) continue;
      seat.stun = Math.max(0, seat.stun - dt);
      if (seat.stun <= 0) this._readCrank(seat);
      const move = Math.min(seat.queue, CLIMB_SPEED * dt);
      seat.h += move;
      seat.queue -= move;
      if (seat.h >= TOP) { seat.h = TOP; this._finish(seat, rankNow); newly++; continue; }
      if (this.grinderY > seat.h - KILL_MARGIN) { this._mince(seat); continue; }
      minGap = Math.min(minGap, seat.h - this.grinderY);
    }
    this.finishCount += newly;

    // Grinding noise, louder as it closes in on the lowest subject.
    this.grindT -= dt;
    if (this.grindT <= 0) {
      this.grindT = 0.55;
      Audio.sfx('grind', { vol: Number.isFinite(minGap) ? clamp(1 - minGap / 8, 0.12, 0.8) : 0.12 });
    }
  }

  /** Read this tick's button edges: alternate = lift, repeat / both = slip. */
  _readCrank(seat) {
    const c = seat.ctrl;
    const a = c.aPressed, b = c.bPressed;
    if (!a && !b) return;
    if (a && b) { this._slip(seat); return; }
    const btn = a ? 'a' : 'b';
    if (btn === seat.last) { this._slip(seat); return; }
    seat.last = btn;
    seat.queue = Math.min(QUEUE_MAX, seat.queue + LIFT);
    seat.cranks++;
    seat.lane.crankTarget += Math.PI / 2;
    Audio.sfx('tick', { vol: 0.35 });
  }

  _slip(seat) {
    const L = seat.lane;
    seat.stun = SLIP_STUN;
    seat.queue = 0;
    seat.h = Math.max(-3, seat.h - SLIP_DROP);
    seat.slips++;
    L.crankTarget -= Math.PI * 1.5; // the crank spins back
    Audio.sfx('clank', { vol: 0.6 });
    this.fx.sparks(new THREE.Vector3(L.x + CRANK_X, seat.h + 1.0, 0.35), { count: 8, speed: 3 });
    Haptics.forPlayer(seat.player, 'hit');
  }

  _finish(seat, rank) {
    seat.finished = true;
    seat.finishRank = rank;
    seat.finishTime = this.time;
    seat.queue = 0;
    seat.exitT = 0;
    Audio.sfx('ding');
    this.hud.feed(`${seat.player.name} escaped`, seat.player.color);
    if (!this.firstOut) { this.firstOut = true; this.hud.banner('FIRST OUT', 1400, 'good'); }
  }

  _mince(seat) {
    const L = seat.lane;
    L.dead = true;
    L.cable.visible = false;
    L.warnMat.color.setHex(0x401008);
    this.kill(seat, 'gib', { dir: new THREE.Vector3(0, 0, -1), force: 0.6, sound: 'grind' });
    this.fx.sparks(new THREE.Vector3(L.x, this.grinderY, 0.7), { count: 14, speed: 5, color: 0xff3a2a });
    // The empty platform gets spat out onto the housing.
    this.fx.addBody(L.group, new THREE.Vector3(L.i % 2 ? 1.2 : -1.2, 4, -0.4), new THREE.Vector3(3, 0, L.i % 2 ? 4 : -4), { bleed: false, radius: 0.3 });
  }

  _checkEnd() {
    let unresolved = 0;
    for (const s of this.seats) if (s.alive && !s.finished) unresolved++;
    if (unresolved === 0) {
      if (this.finishCount === 0) this.hud.banner('NOBODY ESCAPED', 2200, 'danger');
      else if (this.deaths.length === 0) this.hud.banner('SHAFT CLEARED', 2200, 'good');
      else this.hud.banner('SHIFT OVER', 2200);
      this.end(2.4);
    } else if (this.time >= CAP) {
      this.hud.banner('TIME UP', 2200);
      Audio.sfx('buzz');
      this.end(2.4);
    }
  }

  /** Escapees by order, then survivors by height, then the dead (last to die first). */
  placement() {
    const fin = this.seats.filter((s) => s.finished).sort((a, b) => a.finishRank - b.finishRank);
    const alive = this.seats.filter((s) => s.alive && !s.finished).sort((a, b) => b.h - a.h);
    const dead = groupBy(this.deaths.slice().reverse(), (s) => s.deathTime.toFixed(3));
    return [...groupBy(fin, (s) => s.finishRank), ...groupBy(alive, (s) => s.h.toFixed(2)), ...dead];
  }

  _updateHud() {
    for (const s of this.seats) {
      if (!s.alive) {
        this.hud.setStatus(s, 'MINCED');
        this.hud.setStat(s, `${Math.max(0, s.h).toFixed(1)}m`);
      } else if (s.finished) {
        this.hud.setStatus(s, 'ESCAPED');
        this.hud.setStat(s, `ESCAPED #${s.finishRank}`);
      } else {
        const gap = s.h - this.grinderY;
        this.hud.setStatus(s, s.stun > 0 ? 'SLIPPED!' : gap < WARN_GAP ? 'GRINDER CLOSE!' : 'CRANKING');
        this.hud.setStat(s, `${Math.max(0, s.h).toFixed(1)}m`);
      }
    }
    this.hud.setTimer(null);
  }

  // ------------------------------------------------------------- animation

  /** Grinder position + rollers, beacons, platforms, cranks, cables, hatches. */
  _animateMachines(dt, playing) {
    const spin = (playing ? 6 + this.gSpeed * 6 : 4) * dt;
    this.rollers[0].rotation.x += spin;
    this.rollers[1].rotation.x -= spin;
    this.grinder.position.y = this.grinderY;
    const on = Math.sin(this.clock * 9) > 0;
    this.beaconMat.color.setHex(on ? 0xff2a10 : 0x3a0806);
    this.gLight.intensity = on ? 14 : 5;
    const blink = Math.sin(this.clock * 16) > 0;
    const k = damp(20, dt);
    for (const seat of this.seats) {
      const L = seat.lane;
      L.crankAngle += (L.crankTarget - L.crankAngle) * k;
      L.crank.rotation.z = -L.crankAngle;
      if (!L.dead) {
        L.group.position.y = seat.h;
        const y0 = seat.h + 1.12, len = Math.max(0.05, CEIL - y0);
        L.cable.scale.y = len;
        L.cable.position.y = y0 + len / 2;
        const close = playing && seat.alive && !seat.finished && seat.h - this.grinderY < WARN_GAP;
        L.warnMat.color.setHex(close && blink ? 0xff2010 : 0x401008);
      }
      if (seat.finished) L.hatchOpen = Math.min(1, L.hatchOpen + dt * 4);
      L.hatch.rotation.z = -L.hatchOpen * 1.75;
      L.exitMat.color.setHex(seat.finished ? 0x4dff6a : 0x7a5a10);
    }
  }

  _animateSubjects(dt) {
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const s = seat.subject;
      if (seat.finished) {
        // Climb out through the hatch, then vanish upstairs.
        seat.exitT += dt;
        s.pose = 'armsUp';
        s.animate(dt, 0);
        const k = clamp((seat.exitT - 0.3) / 0.8, 0, 1);
        s.root.position.y = TOP + k * k * 3.2;
        if (k >= 1 && s.root.visible) { s.root.visible = false; seat.tagTarget = null; }
        continue;
      }
      s.root.position.y = seat.h;
      const stunned = seat.stun > 0;
      s.pose = stunned ? 'cower' : 'hold';
      s.animate(dt, 0);
      if (stunned) continue;
      // Both hands on the crank handle, following its rotation.
      const p = s.parts, ang = seat.lane.crankAngle;
      p.armR.rotation.x = -1.25 + Math.sin(ang) * 0.35;
      p.armR.rotation.z = 0.25 + Math.cos(ang) * 0.12;
      p.armL.rotation.x = -1.1 + Math.sin(ang) * 0.3;
      p.armL.rotation.z = 0.55 + Math.cos(ang) * 0.1;
      p.torso.rotation.z = Math.sin(ang) * 0.05;
    }
  }

  /** Frame every live subject (and the grinder when it is near); zoom out as they spread. */
  _updateCamera(dt, snap = false) {
    let lo = Infinity, hi = -Infinity, best = 0;
    for (const s of this.seats) {
      best = Math.max(best, s.h);
      if (!s.alive || s.finished) continue;
      lo = Math.min(lo, s.h);
      hi = Math.max(hi, s.h);
    }
    if (lo === Infinity) lo = hi = best;
    let bottom = lo - 0.6, top = hi + 2.6;
    if (this.grinderY > lo - 6) bottom = Math.min(bottom, this.grinderY - 0.8);
    if (hi > TOP - 4) top = Math.max(top, CEIL + 0.8);
    const d = clamp((top - bottom) * 1.25 + 1, 9, 26);
    const cy = (bottom + top) / 2;
    const k = snap ? 1 : damp(2.5, dt);
    this.camY += (cy - this.camY) * k;
    this.camD += (d - this.camD) * k;
    this.camera.position.set(0, this.camY + 1.0, this.camD);
    this.camera.lookAt(0, this.camY, -0.4);
    this.spot.position.set(0, this.camY + 7, 7);
    this.spotTarget.position.set(0, this.camY - 1, -1);
  }

  // -------------------------------------------------------------------- bots

  /**
   * Bots alternate at a difficulty-based cadence with reaction-sized jitter,
   * an occasional hesitation, and (mostly at low difficulty) the odd
   * same-button mis-press. Each press is held for exactly one tick.
   */
  botThink(seat, dt) {
    const c = seat.ctrl, brain = seat.brain, m = brain.memory;
    if (m.cd === undefined) { m.cd = brain.reaction + rand(0, 0.2); m.held = false; }
    if (m.held) { c.setButtons(false, false); m.held = false; }
    if (seat.finished) return;
    if (seat.stun > 0) { m.cd = Math.max(m.cd, seat.stun + brain.reaction * rand(0.5, 1.2)); return; }
    m.cd -= dt;
    if (m.cd > 0) return;
    const d = brain.difficulty;
    let rate = 6.2 + 3.0 * d;             // presses per second: ~7.1 / 8.0 / 8.9
    let slipP = brain.error * 0.15;        // ~2.9% / 2.0% / 1.1% per press
    if (seat.h - this.grinderY < WARN_GAP + 1) { rate *= 1 + 0.08 * d; slipP *= 1.6 - d; } // panic
    const jitter = clamp(brain.reaction, 0.05, 0.4) * 0.9;
    m.cd += (1 / rate) * (1 + rand(-jitter, jitter));
    if (random() < brain.reaction * 0.04) m.cd += brain.reaction * rand(0.5, 1.5); // hesitation
    let btn = seat.last === 'a' ? 'b' : 'a';
    if (seat.last && random() < slipP) btn = seat.last; // mis-press: same button again
    c.setButtons(btn === 'a', btn === 'b');
    m.held = true;
  }
}
