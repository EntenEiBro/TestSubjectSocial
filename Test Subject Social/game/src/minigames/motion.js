/**
 * MOTION SENSOR — red light / green light down a long, grimy hall, judged
 * by a ceiling-mounted sentry turret with a big signal lamp.
 *
 * Rules
 *  - Subjects start at the near end of a 20 m hall; the exit door is at the
 *    far end (z = -20). Walking pace is deliberately slow.
 *  - The sentry cycles: GREEN (random 2–5 s, it looks away — move freely)
 *    → YELLOW warning (0.6 s, it swings round) → RED (random 1.5–4 s).
 *  - Under RED, anyone whose ground speed (walking + knockback) stays above a
 *    small threshold for a moment is shot ('shot'). A short grace period at
 *    the start of RED lets bodies settle.
 *  - B shoves. A shoved subject slides — shove someone during RED (or late in
 *    YELLOW) and the sentry does the rest.
 *  - Stepping through the exit door = safe; finishers walk off into the dark.
 *  - After 55 s the hall is cleared: everyone still inside is shot, the
 *    furthest from the exit first.
 *  - Placement: finishers in arrival order, then the dead (last to die ranks
 *    highest).
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, mesh, stencil, hazardStrip, pipe } from '../core/environment.js';
import { Tex, mat, glow, textTexture } from '../core/textures.js';
import { clamp, lerp, damp, angleDiff } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const HW = 4;                       // hall half-width
const START_Z = 0.8;                // spawn line
const EXIT_Z = -20;                 // inner face of the far wall (door plane)
const FINISH_Z = EXIT_Z - 0.35;     // crossing this inside the door = safe
const DOOR_HALF = 1.6, DOOR_H = 3;
const WALL_H = 5.5;
const SPEED = 2.2;                  // slow walk: ~9 s of walking for the whole hall
const GREEN_MIN = 2, GREEN_MAX = 5, YELLOW_TIME = 0.6, RED_MIN = 1.5, RED_MAX = 4;
const RED_GRACE = 0.15;             // bodies settle at the start of RED
const MOVE_EPS = 0.45;              // speed (units/s) the sentry notices
const MOTION_LIMIT = 0.08;          // seconds above MOVE_EPS before it fires
const CAP = 55;
const PURGE_GAP = 0.45;
const TURRET_Y = 4.4, TURRET_Z = EXIT_Z + 1.6;
const COLORS = { green: 0x39ff5a, yellow: 0xffc21a, red: 0xff2a14, dim: 0x221a10 };

export class MotionSensor extends Minigame {
  static meta = {
    id: 'motion',
    title: 'MOTION SENSOR',
    tagline: 'Walk on green. Hold very, very still on red.',
    category: 'Reflex',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Reach the exit door at the far end of the hall.',
    rules: [
      'Move while the sentry lamp is GREEN. YELLOW means stop now.',
      'Anything moving under a RED lamp gets shot.',
      'Shove rivals with {B} — a shoved subject is a moving subject.',
      'Finish order decides placement. After 55 s the hall is cleared.',
    ],
  };

  build() {
    const scene = this.makeScene({ fog: 0x0a0a0b, fogNear: 22, fogFar: 54, ambient: 0x3c3e44 });
    this.makeCamera([0, 10, 11], [0, 0.5, -6], 50);
    this.camZ = 0;
    this.camGoal = 0;

    this._buildHall(scene);
    this._buildDoor(scene);
    this._buildTurret(scene);

    hangingLamp(scene, -2.6, 5.2, -1.5, { intensity: 70, angle: 0.95 });
    hangingLamp(scene, 2.6, 5.2, -9, { intensity: 70, angle: 0.95 });
    hangingLamp(scene, -2.6, 5.2, -15.5, { intensity: 55, angle: 0.95, shadow: false });

    // --- arena + avatars
    this.arena = new Arena({ bounds: { minX: -HW, maxX: HW, minZ: EXIT_Z - 8, maxZ: 2.6 }, shoveForce: 9 });
    this.arena.addWall(-HW - 1, -DOOR_HALF, EXIT_Z - 0.6, EXIT_Z);
    this.arena.addWall(DOOR_HALF, HW + 1, EXIT_Z - 0.6, EXIT_Z);
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * 1.8, z = START_Z;
      this.spawnSubject(seat, { x, z, facing: Math.PI });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z, speed: SPEED }));
      seat.actor.seat = seat;
      seat.actor.facing = Math.PI;
      Object.assign(seat, { finished: false, motion: 0, walkX: 0, walkZ: 0 });
    });
    this.arena.onShove = (att, vic) => { vic.data.lastShover = att.seat; vic.data.shovedAt = this.time; };

    // Muzzle tracers: one reusable streak per seat.
    const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
    this.tracers = this.seats.map(() => {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      return { mesh: m, t: 0 };
    });

    this.phase = 'idle';      // 'idle' | 'green' | 'yellow' | 'red'
    this.phaseT = 0;
    this.phaseDur = Infinity;
    this.cycle = 0;           // increments on every phase change (bots watch it)
    this.beeped = false;
    this.scanT = 0;
    this.finishers = [];
    this.purging = false;
    this.purge = [];
    this.purgeT = 0;
    this._lamp('green');
  }

  // ------------------------------------------------------------------ stage

  _buildHall(scene) {
    const len = 24, zc = (4 + EXIT_Z) / 2;
    floor(scene, 40, 50, { tex: 'concrete', tile: 3, z: -10 });
    floor(scene, HW * 2, len, { tex: 'tiles', tile: 1.5, y: 0.005, z: zc });
    // Start line, distance marks, exit strip.
    const startLine = mesh(new THREE.PlaneGeometry(HW * 2, 0.2), new THREE.MeshLambertMaterial({ color: 0xd8d2c0 }), 0, 0.02, START_Z - 0.7, { cast: false });
    startLine.rotation.x = -Math.PI / 2;
    scene.add(startLine);
    stencil(scene, 'START', 0, 0.02, START_Z + 1.2, { w: 3.2, h: 1.1, opacity: 0.3 }).rotation.x = -Math.PI / 2;
    for (const d of [15, 10, 5]) {
      stencil(scene, `${d} M`, -HW + 1.3, 0.02, EXIT_Z + d, { w: 2, h: 0.8, opacity: 0.28 }).rotation.x = -Math.PI / 2;
      const tick = mesh(new THREE.PlaneGeometry(HW * 2, 0.08), new THREE.MeshLambertMaterial({ color: 0x9a9480, transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.015, EXIT_Z + d, { cast: false });
      tick.rotation.x = -Math.PI / 2;
      scene.add(tick);
    }
    stencil(scene, 'FREEZE', 0, 0.02, -9, { w: 5, h: 1.8, opacity: 0.18 }).rotation.x = -Math.PI / 2;
    hazardStrip(scene, 0, EXIT_Z + 0.35, DOOR_HALF * 2 + 0.6, 0.5, 0.02);

    // Side walls with signal strips along the top and the usual pipework.
    const wallMat = mat(0xffffff, Tex.wall([6, 1.4]));
    block(scene, -HW - 0.2, WALL_H / 2, zc, 0.4, WALL_H, len, wallMat);
    block(scene, HW + 0.2, WALL_H / 2, zc, 0.4, WALL_H, len, wallMat);
    this.stripMat = glow(COLORS.green);
    for (const sx of [-1, 1]) {
      scene.add(mesh(new THREE.BoxGeometry(0.08, 0.12, len), this.stripMat, sx * (HW - 0.04), 3.6, zc, { cast: false }));
      pipe(scene, [sx * (HW - 0.25), 4.6, 4], [sx * (HW - 0.25), 4.6, EXIT_Z + 0.3], 0.12);
      hazardStrip(scene, sx * (HW - 0.25), zc, 0.5, len, 0.012);
    }
    stencil(scene, 'NO SUDDEN MOVEMENTS', -HW + 0.02, 2.2, -7, { w: 7, h: 1.3, rotY: Math.PI / 2, opacity: 0.55 });
    stencil(scene, 'YOU ARE BEING OBSERVED', HW - 0.02, 2.2, -12, { w: 7, h: 1.3, rotY: -Math.PI / 2, opacity: 0.5 });
  }

  /** Far wall with the exit door, EXIT sign, a 3-lens signal panel and a dark tunnel beyond. */
  _buildDoor(scene) {
    const z = EXIT_Z - 0.3;
    const wallMat = mat(0xffffff, Tex.wall([2, 2]));
    const sideW = HW + 0.4 - DOOR_HALF;
    block(scene, -(DOOR_HALF + sideW / 2), WALL_H / 2, z, sideW, WALL_H, 0.6, wallMat);
    block(scene, DOOR_HALF + sideW / 2, WALL_H / 2, z, sideW, WALL_H, 0.6, wallMat);
    block(scene, 0, (DOOR_H + WALL_H) / 2, z, DOOR_HALF * 2, WALL_H - DOOR_H, 0.6, wallMat);
    const frame = mat(0xffffff, Tex.hazard([1, 3]));
    block(scene, -DOOR_HALF - 0.1, DOOR_H / 2, EXIT_Z + 0.05, 0.2, DOOR_H, 0.15, frame);
    block(scene, DOOR_HALF + 0.1, DOOR_H / 2, EXIT_Z + 0.05, 0.2, DOOR_H, 0.15, frame);
    block(scene, 0, DOOR_H - 0.2, z, DOOR_HALF * 2, 0.4, 0.5, mat(0x6a6e6a, Tex.plate([3, 1]))); // raised shutter
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.7), new THREE.MeshBasicMaterial({ map: textTexture('EXIT', { w: 256, h: 80, size: 64, color: '#39ff5a', bg: '#041004', grimy: false }) }));
    sign.position.set(0, DOOR_H + 0.5, EXIT_Z + 0.02);
    scene.add(sign);
    const dark = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF * 2 + 0.2, DOOR_H, 8), new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.BackSide }));
    dark.position.set(0, DOOR_H / 2 - 0.01, EXIT_Z - 4.6);
    scene.add(dark);

    // Traffic-light panel on the far wall.
    const panel = new THREE.Group();
    panel.add(mesh(new THREE.BoxGeometry(0.8, 2.0, 0.3), mat(0x2a2c2a, Tex.metal())));
    this.lenses = [['red', 0.6], ['yellow', 0], ['green', -0.6]].map(([key, y]) => {
      const m = new THREE.MeshBasicMaterial({ color: COLORS.dim });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.24, 14), m);
      lens.position.set(0, y, 0.16);
      panel.add(lens);
      return { key, mat: m };
    });
    panel.position.set(DOOR_HALF + 1.4, 2.6, EXIT_Z + 0.16);
    scene.add(panel);
  }

  /** Ceiling sentry: beam, rod, yawing housing with twin barrels, lamp dome, red scan cone. */
  _buildTurret(scene) {
    block(scene, 0, 5.35, TURRET_Z, HW * 2 + 0.8, 0.35, 0.5, mat(0x4a4038, Tex.rust([4, 1])));
    const base = new THREE.Group();
    base.position.set(0, TURRET_Y, TURRET_Z);
    scene.add(base);
    const steel = mat(0x4c504e, Tex.metal());
    const dark = mat(0x1c1d1c);
    base.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), dark, 0, 0.55, 0));
    base.add(mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.18, 10), steel, 0, 0.1, 0));
    const yaw = new THREE.Group();
    base.add(yaw);
    const pitch = new THREE.Group();
    pitch.position.y = -0.3;
    yaw.add(pitch);
    pitch.add(mesh(new THREE.BoxGeometry(0.9, 0.55, 0.95), steel));
    pitch.add(mesh(new THREE.BoxGeometry(1.08, 0.14, 0.6), dark, 0, 0, -0.1));
    for (const x of [-0.18, 0.18]) {
      const b = mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.8, 8), dark, x, -0.1, 0.8);
      b.rotation.x = Math.PI / 2;
      pitch.add(b);
    }
    this.eyeMat = glow(0x5a0a06);
    pitch.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), this.eyeMat, 0, 0.1, 0.48, { cast: false }));
    // The signal lamp: a big dome on top inside a wire cage.
    this.signalMat = glow(COLORS.green);
    pitch.add(mesh(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.signalMat, 0, 0.27, 0, { cast: false }));
    const cage = mesh(new THREE.TorusGeometry(0.31, 0.022, 4, 12), dark, 0, 0.36, 0);
    cage.rotation.x = Math.PI / 2;
    pitch.add(cage);
    // Scan cone (only lit under RED). Tip at the eye, opening along +Z.
    this.coneMat = new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 16, 16, 1, true), this.coneMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(0, 0.1, 0.5 + 8);
    cone.visible = false;
    pitch.add(cone);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.1, 1.25);
    pitch.add(muzzle);
    this.lampLight = new THREE.PointLight(COLORS.green, 30, 24, 1.2);
    this.lampLight.position.set(0, 0.3, 0.6);
    base.add(this.lampLight);
    this.turret = { base, yaw, pitch, cone, muzzle, holdT: 0, aimYaw: 0, aimPitch: 0 };
    yaw.rotation.y = Math.PI;
  }

  /** Paint the signal lamp, wall strips and panel lenses in one phase colour. */
  _lamp(key) {
    const hex = COLORS[key];
    this.signalMat.color.setHex(hex);
    this.stripMat.color.setHex(hex);
    this.lampLight.color.setHex(hex);
    for (const l of this.lenses) l.mat.color.setHex(l.key === key ? COLORS[l.key] : COLORS.dim);
  }

  // ------------------------------------------------------------------- flow

  start() {
    this._setPhase('green');
    this.hud.prompt('{MOVE} on green · freeze on red · {B} shoves');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 4500);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // Cosmetic lamp demo cycle.
    const k = Math.floor(this.clock / 1.6) % 3;
    this._lamp(k === 0 ? 'green' : k === 1 ? 'yellow' : 'red');
    this._updateTurret(dt);
    this._updateCamera(dt);
  }

  _setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    this.cycle++;
    this.beeped = false;
    this.scanT = 0;
    if (p === 'green') {
      this.phaseDur = rand(GREEN_MIN, GREEN_MAX);
      this._lamp('green');
      this.eyeMat.color.setHex(0x5a0a06);
      this.hud.banner('MOVE', 900, 'good');
      Audio.sfx('go', { vol: 0.5 });
    } else if (p === 'yellow') {
      this.phaseDur = YELLOW_TIME;
      this._lamp('yellow');
      this.hud.banner('FREEZE', 1700, 'danger');
      Audio.sfx('beep');
    } else {
      this.phaseDur = rand(RED_MIN, RED_MAX);
      this._lamp('red');
      this.eyeMat.color.setHex(0xff2010);
      for (const s of this.seats) s.motion = 0;
      Audio.sfx('buzz');
      Audio.sfx('sonar', { vol: 0.6 });
    }
  }

  _updatePhase(dt) {
    this.phaseT += dt;
    if (this.phase === 'yellow') {
      // Blink + second beep halfway through the warning.
      this.signalMat.color.setHex(Math.floor(this.phaseT * 12) % 2 === 0 ? COLORS.yellow : COLORS.dim);
      if (!this.beeped && this.phaseT >= YELLOW_TIME / 2) { this.beeped = true; Audio.sfx('beep'); }
    } else if (this.phase === 'red') {
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 0.5; Audio.sfx('tick', { vol: 0.6 }); }
    }
    if (this.phaseT >= this.phaseDur) this._setPhase(this.phase === 'green' ? 'yellow' : this.phase === 'yellow' ? 'red' : 'green');
  }

  /** Snap the turret onto a world point and hold the aim for a moment. */
  _aimAt(x, y, z) {
    const T = this.turret;
    const dx = x, dz = z - TURRET_Z, dy = (TURRET_Y - 0.3) - y;
    T.aimYaw = Math.atan2(dx, dz);
    T.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
    T.yaw.rotation.y = T.aimYaw;
    T.pitch.rotation.x = T.aimPitch;
    T.holdT = 0.7;
  }

  /** The sentry fires on a seat. */
  _shoot(seat, { banner = true } = {}) {
    const a = seat.actor, T = this.turret;
    const to = new THREE.Vector3(a.pos.x, 1.25, a.pos.z);
    this._aimAt(to.x, to.y, to.z);
    T.base.updateMatrixWorld(true);
    const from = T.muzzle.getWorldPosition(new THREE.Vector3());
    const tr = this.tracers[this.seats.indexOf(seat)];
    tr.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    tr.mesh.scale.set(1, 1, Math.max(0.1, from.distanceTo(to)));
    tr.mesh.lookAt(to);
    tr.mesh.visible = true;
    tr.mesh.material.opacity = 1;
    tr.t = 0.2;
    this.fx.sparks(from, { count: 8, speed: 4 });
    const by = a.data.lastShover;
    if (by && by !== seat && this.time - a.data.shovedAt < 1.2) this.hud.feed(`${by.player.name} framed ${seat.player.name}`, by.player.color);
    if (banner) this.hud.banner('MOVEMENT DETECTED', 1100, 'danger');
    this.kill(seat, 'shot', { dir: new THREE.Vector3(to.x - from.x, 0, to.z - from.z) });
  }

  _finish(seat) {
    seat.finished = true;
    this.finishers.push(seat);
    const a = seat.actor;
    a.alive = false; // leave the physics sim; we animate the walk-off ourselves
    seat.walkX = a.pos.x;
    seat.walkZ = a.pos.z;
    Audio.sfx('ding');
    this.hud.banner('EXIT REACHED', 1000, 'good');
    this.hud.feed(`${seat.player.name} reached the exit`, seat.player.color);
  }

  /** Time is up: everyone still in the hall is shot, furthest from the exit first. */
  _startPurge() {
    this.purging = true;
    const doomed = this.seats.filter((s) => s.alive && !s.finished).sort((p, q) => q.actor.pos.z - p.actor.pos.z);
    this.purge = doomed.map((s, i) => ({ seat: s, at: 0.9 + i * PURGE_GAP }));
    this.purgeT = 0;
    this.phase = 'red';
    this._lamp('red');
    this.eyeMat.color.setHex(0xff2010);
    this.hud.banner('HALL CLOSED', 2000, 'danger');
    Audio.sfx('sting', { vol: 0.7 });
  }

  _runPurge(dt) {
    this.purgeT += dt;
    for (const p of this.purge) {
      if (!p.seat.alive) continue;
      p.seat.subject.pose = 'armsUp';
      if (this.purgeT >= p.at) this._shoot(p.seat, { banner: false });
    }
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing && !this.purging);
    this._walkOff(dt);
    this._updateTracers(dt);
    if (playing && !this.purging) this._updatePhase(dt);
    this._updateTurret(dt);
    this._updateCamera(dt);
    if (!playing) return;

    if (this.purging) this._runPurge(dt);
    else {
      for (const seat of this.seats) {
        if (!seat.alive || seat.finished) continue;
        const a = seat.actor;
        if (a.pos.z < FINISH_Z) { this._finish(seat); continue; }
        if (this.phase === 'red' && this.phaseT >= RED_GRACE) {
          const speed = Math.hypot(a.vel.x + a.knock.x, a.vel.z + a.knock.z);
          if (speed > MOVE_EPS) seat.motion += dt;
          else seat.motion = Math.max(0, seat.motion - dt * 0.5);
          if (seat.motion >= MOTION_LIMIT) this._shoot(seat);
        }
      }
    }

    // HUD
    this.hud.setTimer(Math.max(0, CAP - this.time));
    const frozen = this.phase === 'yellow' || this.phase === 'red';
    for (const seat of this.seats) {
      if (seat.finished) {
        this.hud.setStatus(seat, 'SAFE');
        this.hud.setStat(seat, `EXIT #${this.finishers.indexOf(seat) + 1}`);
      } else if (!seat.alive) {
        this.hud.setStatus(seat, '');
        this.hud.setStat(seat, 'SHOT');
      } else {
        this.hud.setStatus(seat, frozen ? 'FREEZE' : 'MOVE');
        this.hud.setStat(seat, `${Math.max(0, Math.ceil(seat.actor.pos.z - EXIT_Z))} M TO EXIT`);
      }
    }

    if (this.seats.every((s) => !s.alive || s.finished)) this.end(1.8);
    else if (!this.purging && this.time >= CAP) this._startPurge();
    else if (this.time > CAP + 10) this.end(); // absolute safety net
  }

  /** Finished subjects stroll through the door into the dark. */
  _walkOff(dt) {
    for (const seat of this.seats) {
      if (!seat.finished || !seat.subject || !seat.subject.root.visible) continue;
      seat.walkZ -= SPEED * dt;
      seat.walkX = lerp(seat.walkX, 0, Math.min(1, dt * 2));
      seat.subject.root.position.set(seat.walkX, 0, seat.walkZ);
      seat.subject.faceAngle(Math.PI, dt);
      seat.subject.animate(dt, SPEED);
      if (seat.walkZ < EXIT_Z - 6) { seat.subject.root.visible = false; seat.tagTarget = null; }
    }
  }

  _updateTracers(dt) {
    for (const tr of this.tracers) {
      if (!tr.mesh.visible) continue;
      tr.t -= dt;
      tr.mesh.material.opacity = Math.max(0, tr.t / 0.2);
      if (tr.t <= 0) tr.mesh.visible = false;
    }
  }

  /** Looks away on green, swings round on yellow, sweeps on red, holds aim after a shot. */
  _updateTurret(dt) {
    const T = this.turret;
    T.holdT = Math.max(0, T.holdT - dt);
    let yaw, pitch;
    if (T.holdT > 0) { yaw = T.aimYaw; pitch = T.aimPitch; }
    else if (this.phase === 'green') { yaw = Math.PI; pitch = 0.15; }
    else if (this.phase === 'yellow' || this.phase === 'red') { yaw = Math.sin(this.clock * 1.4) * 0.42; pitch = 0.27; }
    else { yaw = Math.sin(this.clock * 0.5) * 1.3; pitch = 0.2; } // idle (briefing)
    const k = damp(this.phase === 'yellow' ? 9 : 6, dt);
    T.yaw.rotation.y += angleDiff(T.yaw.rotation.y, yaw) * k;
    T.pitch.rotation.x += (pitch - T.pitch.rotation.x) * k;
    const scanning = this.phase === 'red' && this.state !== 'preview' && this.state !== 'build';
    T.cone.visible = scanning;
    if (scanning) this.coneMat.opacity = 0.07 + 0.04 * Math.sin(this.clock * 9);
  }

  /** Track the pack down the hall; never pan back toward the start. */
  _updateCamera(dt) {
    const pack = this.seats.filter((s) => s.alive && !s.finished && s.actor);
    if (pack.length) {
      const avg = pack.reduce((acc, s) => acc + s.actor.pos.z, 0) / pack.length;
      const rear = Math.max(...pack.map((s) => s.actor.pos.z));
      this.camGoal = clamp(Math.min(this.camGoal, Math.max(avg, rear - 3)), EXIT_Z + 7, 0);
    }
    this.camZ = lerp(this.camZ, this.camGoal, Math.min(1, dt * 2.5));
    this.camera.position.set(0, 10, this.camZ + 11);
    this.camera.lookAt(0, 0.5, this.camZ - 6);
  }

  /** Finishers in arrival order, then the dead (last to die ranks highest). */
  placement() {
    const tiers = this.finishers.map((s) => [s]);
    const stragglers = this.seats.filter((s) => s.alive && !s.finished);
    if (stragglers.length) tiers.push(stragglers);
    tiers.push(...groupBy(this.deaths.slice().reverse(), (s) => s.deathTime.toFixed(3)));
    return tiers;
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, c = a.ctrl, brain = seat.brain, m = brain.memory;
    if (seat.finished || this.purging) { c.setMove(0, 0); c.setButtons(false, false); return; }

    // React to phase changes (once per phase).
    if (m.cycle !== this.cycle) {
      m.cycle = this.cycle;
      if (this.phase === 'green') {
        m.goDelay = brain.reaction * rand(0.8, 1.3);
        m.hunt = random() < brain.difficulty * 0.6;
      } else if (this.phase === 'yellow') {
        const late = random() < brain.error * 0.55; // sloppy bots sometimes stop too late
        m.stopDelay = brain.reaction * rand(0.85, 1.15) + (late ? rand(0.35, 0.8) : 0);
        // Right at the door, a sharp bot dashes through during the warning.
        if (a.pos.z - FINISH_Z < 0.9 && random() < brain.difficulty) m.stopDelay = Math.max(m.stopDelay, YELLOW_TIME - 0.15);
      } else if (this.phase === 'red') {
        m.frame = random() < 0.2 + brain.difficulty * 0.6;
      }
    }

    let move;
    if (this.phase === 'green') move = this.phaseT >= (m.goDelay ?? 0);
    else {
      const since = this.phase === 'yellow' ? this.phaseT : YELLOW_TIME + this.phaseT;
      move = since < (m.stopDelay ?? 0);
    }

    let wantB = false;
    if (move) {
      let mx = 0, mz = -1;
      const parity = this.seats.indexOf(seat) % 2 ? 1 : -1;
      if (a.pos.z < EXIT_Z + 4.5) {
        // Funnel into the door.
        const tx = clamp(a.pos.x, -DOOR_HALF + 0.55, DOOR_HALF - 0.55);
        mx = clamp((tx - a.pos.x) * 1.5, -1, 1);
      } else {
        for (const o of this.seats) {
          if (o === seat || !o.alive || o.finished) continue;
          const dx = a.pos.x - o.actor.pos.x, dz = a.pos.z - o.actor.pos.z, d = Math.hypot(dx, dz);
          if (d > 3 || d < 0.01) continue;
          const w = (3 - d) / 3;
          const side = Math.abs(dx) > 0.05 ? Math.sign(dx) : parity;
          if (m.hunt && dz > 0.4) mx -= Math.sign(dx) * Math.min(Math.abs(dx), 1) * w * 1.2; // line up behind a rival ahead
          else mx += side * w * (0.6 + brain.difficulty);                                     // keep clear of everyone else
        }
        if (a.pos.x > HW - 1) mx -= 0.8;
        if (a.pos.x < -HW + 1) mx += 0.8;
        // During the warning, use the reaction window to sidestep a rival right behind us.
        if (this.phase === 'yellow' && brain.difficulty > 0.5) {
          for (const o of this.seats) {
            if (o === seat || !o.alive || o.finished) continue;
            const dx = a.pos.x - o.actor.pos.x, dz = a.pos.z - o.actor.pos.z;
            if (dz < -0.2 && dz > -1.8 && Math.abs(dx) < 1.2) { mx = (Math.abs(dx) > 0.05 ? Math.sign(dx) : parity) * 1.5; mz = -0.3; break; }
          }
        }
      }
      const pace = lerp(0.85, 1, brain.difficulty);
      const len = Math.hypot(mx, mz) || 1;
      c.setMove((mx / len) * pace, (mz / len) * pace);
    } else {
      c.setMove(0, 0);
      // Standing still under yellow/red: frame a rival standing in front of us.
      if (this.phase !== 'green' && m.frame && a.shoveCd <= 0 && a.stun <= 0) {
        const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
        for (const o of this.seats) {
          if (o === seat || !o.alive || o.finished) continue;
          const dx = o.actor.pos.x - a.pos.x, dz = o.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d > 1.4 || d < 0.01 || (dx * fx + dz * fz) / d < 0.5) continue;
          if (random() < dt * (0.8 + brain.difficulty * 3)) wantB = true;
          break;
        }
      }
    }
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    c.setButtons(false, wantB && !m.bPrev);
    m.bPrev = wantB && !m.bPrev;
  }
}
