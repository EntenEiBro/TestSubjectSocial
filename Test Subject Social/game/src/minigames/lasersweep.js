/**
 * LASER SWEEP — a circular test chamber with an emitter column in the middle
 * that sweeps laser beams around like the hands of a very hostile clock.
 *
 * Rules
 *  - Red (low) beams sweep at ankle height: press A to jump over them
 *    (0.5 s airtime, 0.9 s between jumps).
 *  - Magenta (high) beams sweep at head height: they only burn subjects who
 *    are airborne, so never jump into one.
 *  - One low beam at first; a high beam joins at 11 s, a second low beam at
 *    23 s, and at 36 s the high beam is replaced by a counter-rotating one
 *    (max 3 beams). The rotor speeds up the whole time and, from ~17 s on,
 *    reverses direction every 7–11 s (announced 1.2 s ahead).
 *  - Touching a live beam = burned. New beams flicker harmlessly for 1.4 s
 *    before they go live. The emitter column and the chamber wall are solid.
 *  - B shoves; a shoved subject cannot jump for 0.75 s.
 *  - Last subject standing wins. After 70 s the test ends and every survivor
 *    shares first place.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, mesh, pipe, stencil } from '../core/environment.js';
import { Tex, mat, canvasTexture } from '../core/textures.js';
import { steerTo, nearest } from '../core/ai.js';
import { angleDiff } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const R = 6.5;                 // chamber radius (inner wall)
const COL_R = 0.85;            // emitter column radius
const LOW_Y = 0.32;            // ankle beam height
const HIGH_Y = 2.4;            // head beam height
const AIR = 0.5;               // jump airtime (s)
const GRAV = 27;
const V0 = (GRAV * AIR) / 2;   // take-off speed → apex ≈ 0.84
const JUMP_CD = 0.9;           // from take-off to the next possible jump
const NO_JUMP = 0.75;          // jump lock after being shoved
const LOW_CLEAR = 0.28;        // feet higher than this clear a low beam
const HIGH_HIT = 0.4;          // feet higher than this put the head into a high beam
const WARM = 1.4;              // harmless flicker before a beam goes live
const CAP = 70;                // hard time cap (s of play)
const TAU = Math.PI * 2;
const LOW_COL = 0xff2a14;
const HIGH_COL = 0xff2ee0;

/** Beam slots: three on the main rotor, one counter-rotating. Read-only. */
const BEAM_DEFS = Object.freeze([
  Object.freeze({ kind: 'low', offset: 0, counter: false }),
  Object.freeze({ kind: 'high', offset: Math.PI / 2, counter: false }),
  Object.freeze({ kind: 'low', offset: Math.PI, counter: false }),
  Object.freeze({ kind: 'high', offset: 0, counter: true }),
]);

export class LaserSweep extends Minigame {
  static meta = {
    id: 'lasersweep',
    title: 'LASER SWEEP',
    tagline: 'Ankle-height compliance testing. Head-height consequences.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Jump' }, { input: 'b', label: 'Shove' }],
    objective: 'Be the last subject standing.',
    rules: [
      'Red beams sweep at ankle height. Press {A} to jump over them.',
      'Magenta beams sweep at head height. They only burn subjects in the air.',
      'Beams multiply, speed up and sometimes reverse.',
      'Shoved subjects cannot jump for a moment.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 50, ambientIntensity: 0.75 });
    this.makeCamera([0, 15, 11.2], [0, 0.4, 0.4], 48);

    this._buildChamber(scene);
    this._buildEmitter(scene);
    this._buildBeams(scene);

    hangingLamp(scene, -4.2, 8.5, 1.5, { intensity: 75, angle: 0.85 });
    hangingLamp(scene, 4.2, 8.5, 1.5, { intensity: 75, angle: 0.85 });

    // Scorch decals left where subjects burned (shared geometry/material).
    this.scorchGeo = new THREE.CircleGeometry(0.75, 14);
    this.scorchMat = new THREE.MeshLambertMaterial({ map: burnTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

    // --- arena + avatars (circular wall handled in update, column is a solid circle)
    this.arena = new Arena({ bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R }, shoveForce: 11 });
    this.arena.addCircle(0, 0, COL_R + 0.05);
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      // Spread around the chamber, never on the first beam's start angle (π/2).
      const ang = Math.PI / 2 + Math.PI / n + (i * TAU) / n;
      const x = Math.cos(ang) * 3.7, z = Math.sin(ang) * 3.7;
      const facing = Math.atan2(-x, -z);
      this.spawnSubject(seat, { x, z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
      seat.actor.facing = facing;
      Object.assign(seat.actor.data, { air: -1, jumpCd: 0, noJump: 0, lastShover: null, shovedAt: -99 });
    });
    this.arena.onShove = (a, b) => {
      b.data.lastShover = a.seat;
      b.data.shovedAt = this.time;
      b.data.noJump = NO_JUMP;
    };

    // Rotor state
    this.rotorAngle = Math.PI / 2;
    this.counterAngle = 0;
    this.rotorDir = 1;
    this.omega = 0;
    this.stage = 0;
    this.revAt = Infinity;
    this.revWarned = false;
    this.lastReverseT = -99;
    this.poweredDown = false;
  }

  // ------------------------------------------------------------------- stage

  _buildChamber(scene) {
    floor(scene, 44, 34, { tex: 'concrete', tile: 3, y: -0.02 });
    const disk = mesh(new THREE.CircleGeometry(R + 0.2, 40), mat(0xffffff, Tex.tiles([6, 6])), 0, 0.002, 0, { cast: false });
    disk.rotation.x = -Math.PI / 2;
    scene.add(disk);
    // Soot streaks burned into the floor by countless previous calibrations.
    const soot = mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshLambertMaterial({ map: sootTexture(), transparent: true, depthWrite: false }), 0, 0.008, 0, { cast: false });
    soot.rotation.x = -Math.PI / 2;
    scene.add(soot);
    const band = mesh(new THREE.RingGeometry(R - 0.4, R, 48), mat(0xffffff, Tex.hazard([12, 1])), 0, 0.015, 0, { cast: false });
    band.rotation.x = -Math.PI / 2;
    scene.add(band);
    stencil(scene, 'DO NOT LOITER', 0, 0.02, 4.75, { w: 3.6, h: 1.0, opacity: 0.22 }).rotation.x = -Math.PI / 2;

    // Chamber wall: tall behind, waist-high in front so the camera sees in.
    const plate2 = mat(0xffffff, Tex.plate([12, 2]), { side: THREE.DoubleSide });
    const plate1 = mat(0xffffff, Tex.plate([12, 1]), { side: THREE.DoubleSide });
    scene.add(mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.15, 3.4, 32, 1, true, Math.PI / 2, Math.PI), plate2, 0, 1.7, 0));
    scene.add(mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.15, 0.9, 32, 1, true, -Math.PI / 2, Math.PI), plate1, 0, 0.45, 0));
    const rust = mat(0xffffff, Tex.rust([8, 1]));
    const lowRim = mesh(new THREE.TorusGeometry(R + 0.15, 0.08, 4, 40), rust, 0, 0.9, 0);
    lowRim.rotation.x = Math.PI / 2;
    scene.add(lowRim);
    const topRim = mesh(new THREE.TorusGeometry(R + 0.15, 0.1, 4, 24, Math.PI), rust, 0, 3.4, 0);
    topRim.rotation.x = -Math.PI / 2; // back half
    scene.add(topRim);
    // Catch rail for the head-height beams, on posts along the front.
    const rail = mesh(new THREE.TorusGeometry(R + 0.12, 0.05, 4, 40), mat(0x6b6f6a, Tex.metal()), 0, HIGH_Y, 0);
    rail.rotation.x = Math.PI / 2;
    scene.add(rail);
    const postH = HIGH_Y - 0.9;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI; // front half (z ≥ 0)
      scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, postH, 5), rust, Math.cos(a) * (R + 0.12), 0.9 + postH / 2, Math.sin(a) * (R + 0.12)));
    }

    // Back room
    scene.add(mesh(new THREE.PlaneGeometry(44, 12), mat(0xffffff, Tex.wall([11, 3])), 0, 4, -9.6));
    stencil(scene, 'BEAM CALIBRATION', 0, 5.4, -9.5, { w: 8, h: 1.8, opacity: 0.5 });
    pipe(scene, [-16, 4.4, -9.2], [16, 4.4, -9.2], 0.25);
    pipe(scene, [-16, 3.7, -9.3], [16, 3.7, -9.3], 0.12, 0x5a3022);
    pipe(scene, [0, 3.2, 0], [0, 12, 0], 0.22); // emitter power conduit
  }

  _buildEmitter(scene) {
    scene.add(mesh(new THREE.CylinderGeometry(COL_R + 0.3, COL_R + 0.4, 0.18, 20), mat(0xffffff, Tex.hazard([4, 1])), 0, 0.09, 0));
    scene.add(mesh(new THREE.CylinderGeometry(COL_R, COL_R, 3.2, 20), mat(0x8a8f8c, Tex.metal()), 0, 1.6, 0));
    const collarMat = mat(0x2a2b2a, Tex.metal());
    for (const y of [LOW_Y, HIGH_Y]) scene.add(mesh(new THREE.CylinderGeometry(COL_R + 0.08, COL_R + 0.08, 0.28, 20), collarMat, 0, y, 0));
    this.bandMat = new THREE.MeshBasicMaterial({ color: 0x5a0a06 });
    for (const y of [1.1, 1.6]) scene.add(mesh(new THREE.CylinderGeometry(COL_R + 0.02, COL_R + 0.02, 0.08, 20), this.bandMat, 0, y, 0, { cast: false }));
    this.beaconMat = new THREE.MeshBasicMaterial({ color: LOW_COL });
    scene.add(mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, TAU, 0, Math.PI / 2), this.beaconMat, 0, 3.2, 0, { cast: false }));
    // Red glow on the floor around the emitter (no shadows).
    this.emitLight = new THREE.PointLight(0xff3020, 6, 9, 1.6);
    this.emitLight.position.set(0, 1.4, 0);
    scene.add(this.emitLight);
  }

  _buildBeams(scene) {
    const L = R - COL_R + 0.12;
    const along = (geo) => { geo.rotateZ(Math.PI / 2); geo.translate(COL_R + L / 2, 0, 0); return geo; };
    const coreGeo = along(new THREE.CylinderGeometry(0.035, 0.035, L, 6, 1, true));
    const glowGeo = along(new THREE.CylinderGeometry(0.13, 0.13, L, 8, 1, true));
    const stripeGeo = new THREE.PlaneGeometry(L, 0.3);
    stripeGeo.rotateX(-Math.PI / 2);
    stripeGeo.translate(COL_R + L / 2, 0, 0);
    const flareGeo = new THREE.SphereGeometry(0.2, 8, 6);
    const lensGeo = new THREE.BoxGeometry(0.3, 0.24, 0.3);
    const lensMat = mat(0x3a3c3a, Tex.metal());
    const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const mats = {
      low: { core: new THREE.MeshBasicMaterial({ color: 0xffd8cc }), glow: additive(LOW_COL, 0.5), stripe: additive(LOW_COL, 0.28), flare: additive(0xff7a50, 0.8) },
      high: { core: new THREE.MeshBasicMaterial({ color: 0xffd8f8 }), glow: additive(HIGH_COL, 0.5), stripe: additive(HIGH_COL, 0.22), flare: additive(0xff90f0, 0.8) },
    };
    const fxOpts = { cast: false, receive: false };
    this.beams = BEAM_DEFS.map((def) => {
      const m = mats[def.kind];
      const y = def.kind === 'low' ? LOW_Y : HIGH_Y;
      const g = new THREE.Group();
      g.position.y = y;
      const core = mesh(coreGeo, m.core, 0, 0, 0, fxOpts);
      const glowMesh = mesh(glowGeo, m.glow, 0, 0, 0, fxOpts);
      const stripe = mesh(stripeGeo, m.stripe, 0, 0.022 - y, 0, fxOpts); // floor guide line under the beam
      const flare = mesh(flareGeo, m.flare, R - 0.02, 0, 0, fxOpts);
      const lens = mesh(lensGeo, lensMat, COL_R + 0.05, 0, 0);
      g.add(core, glowMesh, stripe, flare, lens);
      g.visible = false;
      scene.add(g);
      return {
        kind: def.kind, offset: def.offset, counter: def.counter, y,
        g, core, glow: glowMesh, stripe, flare,
        state: 'off', t: 0, angle: 0, prevAngle: 0, w: 0,
      };
    });
  }

  // --------------------------------------------------------------- lifecycle

  start() {
    // Reset everything the cosmetic preview touched so all devices start identical.
    this.rotorAngle = Math.PI / 2;
    this.counterAngle = 0;
    this.omega = 0;
    this.rotorDir = random() < 0.5 ? 1 : -1;
    for (const b of this.beams) {
      b.state = 'off';
      b.t = 0;
      b.angle = b.prevAngle = b.counter ? this.counterAngle : this.rotorAngle + b.offset;
      b.w = 0;
      this._renderBeam(b);
    }
    this._setBeam(this.beams[0], 'warm');
    this.stage = 0;
    this.revAt = 17 + rand(0, 3);
    this.revWarned = false;
    this.lastReverseT = -99;
    this.hud.banner('BEAM ONLINE', 1200, 'danger');
    this.hud.prompt('{A} jump over red · {B} shove');
    setTimeout(() => this.hud.prompt(null), 4000);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // Cosmetic demo: the first beam idles round the chamber.
    this.rotorAngle += dt * 0.7;
    const b = this.beams[0];
    b.state = 'on';
    b.angle = b.prevAngle = this.rotorAngle;
    this._renderBeam(b);
    this._animateEmitter();
  }

  // ------------------------------------------------------------------- beams

  _setBeam(b, state) {
    b.state = state;
    b.t = state === 'warm' ? WARM : 0;
    if (state === 'warm') Audio.sfx('beep', { vol: 0.4 });
  }

  _updateBeams(dt, playing) {
    if (playing) {
      const target = Math.min(2.7, 1.25 + 0.021 * this.time);
      // The rotor holds still while the first beam warms up, then runs at full
      // speed (no ease-in: a constant speed keeps arrival predictions honest).
      this.omega = this.time < WARM ? 0 : target;
    } else {
      this.omega *= Math.exp(-2.5 * dt);
    }
    const w = this.rotorDir * this.omega;
    const cw = -this.rotorDir * this.omega * 0.7;
    this.rotorAngle += w * dt;
    this.counterAngle += cw * dt;
    for (const b of this.beams) {
      b.prevAngle = b.angle;
      b.angle = b.counter ? this.counterAngle : this.rotorAngle + b.offset;
      b.w = b.counter ? cw : w;
      if (b.state === 'warm') {
        b.t -= dt;
        if (b.t <= 0) { b.state = 'on'; b.t = 0; Audio.sfx('burn', { vol: 0.35 }); }
      }
      this._renderBeam(b);
    }
  }

  _renderBeam(b) {
    const g = b.g;
    g.visible = b.state !== 'off';
    if (!g.visible) return;
    g.rotation.y = -b.angle; // local +X → (cos θ, 0, sin θ)
    const on = b.state === 'on';
    const flick = ((this.clock * 17 + b.y + b.offset) % 1) < 0.25 + 0.6 * (1 - b.t / WARM);
    b.core.visible = on;
    b.flare.visible = on;
    b.glow.visible = on || flick;
    b.stripe.visible = on || flick;
    const pulse = 1 + Math.sin(this.clock * 31 + b.offset * 3) * 0.12;
    b.glow.scale.set(1, pulse, pulse);
  }

  _animateEmitter() {
    const warn = this.state === 'play' && this.revWarned;
    const live = this.beams.some((b) => b.state === 'on');
    const blink = warn ? (this.clock * 8) % 1 < 0.5 : (this.clock * 1.5) % 1 < 0.5;
    this.beaconMat.color.setHex(blink ? (warn ? 0xffb020 : LOW_COL) : 0x3a0806);
    this.bandMat.color.setHex(live ? (warn && blink ? 0xffb020 : 0xc81a0c) : 0x3a0806);
    this.emitLight.intensity = (live ? 7 : 2.5) + Math.sin(this.clock * 23) * 0.8;
  }

  /**
   * Seconds until a beam of `kind` reaches world angle `phi` (Infinity if none).
   * `flipped` assumes the opposite rotation (a bot that has not noticed a reversal yet).
   * `selfW` is the observer's own angular velocity (rad/s): the beam closes in
   * at the relative rate. Warm beams count only if they will be live by the time
   * they arrive; 'off' slots are ignored.
   */
  _arrival(phi, kind, flipped = false, selfW = 0) {
    let best = Infinity;
    for (const b of this.beams) {
      if (b.kind !== kind || b.state === 'off') continue;
      const w = (flipped ? -b.w : b.w) - selfW;
      if (Math.abs(w) < 0.05) continue;
      const d = angleDiff(b.angle, phi);
      const t = w > 0 ? (d >= 0 ? d : d + TAU) / w : (d <= 0 ? -d : TAU - d) / -w;
      if (b.state === 'warm' && t < b.t) continue;
      if (t < best) best = t;
    }
    return best;
  }

  // -------------------------------------------------------------- subjects

  _updateJumps(dt, input) {
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor, d = a.data;
      d.jumpCd = Math.max(0, d.jumpCd - dt);
      d.noJump = Math.max(0, d.noJump - dt);
      if (d.air >= 0) {
        d.air += dt;
        if (d.air >= AIR) { d.air = -1; a.y = 0; Audio.sfx('step', { vol: 0.8 }); }
        else a.y = V0 * d.air - 0.5 * GRAV * d.air * d.air;
      } else if (input && a.ctrl.aPressed && d.jumpCd <= 0 && d.noJump <= 0 && a.stun <= 0) {
        d.air = 0;
        d.jumpCd = JUMP_CD;
        a.y = 0;
        Audio.sfx('whoosh', { vol: 0.25 });
      }
    }
  }

  /** Tuck legs and flail arms while airborne (after the arena's walk animation). */
  _poseAirborne() {
    for (const seat of this.seats) {
      if (!seat.alive || seat.actor.data.air < 0) continue;
      const s = Math.sin(Math.PI * Math.min(1, seat.actor.data.air / AIR));
      const p = seat.subject.parts;
      p.legL.rotation.x = -0.9 * s;
      p.legR.rotation.x = -0.4 * s;
      p.armL.rotation.z = -0.8 * s;
      p.armR.rotation.z = 0.8 * s;
    }
  }

  _burn(seat, beam) {
    const a = seat.actor;
    const phi = Math.atan2(a.pos.z, a.pos.x);
    const s = beam.w >= 0 ? 1 : -1;
    const dir = new THREE.Vector3(-Math.sin(phi) * s, 0, Math.cos(phi) * s);
    const by = a.data.lastShover && this.time - a.data.shovedAt < 1.6 ? a.data.lastShover : null;
    const hitPos = new THREE.Vector3(a.pos.x, beam.y, a.pos.z);
    const x = a.pos.x, z = a.pos.z;
    this.kill(seat, 'burn', { dir, force: 1 });
    this.fx.sparks(hitPos, { color: beam.kind === 'low' ? 0xff6a3a : 0xff70f0, count: 14, speed: 5 });
    const mark = new THREE.Mesh(this.scorchGeo, this.scorchMat);
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.z = x * 3.1 + z * 1.7;
    mark.position.set(x, 0.018, z);
    this.scene.add(mark);
    if (by && by !== seat) this.hud.feed(`${by.player.name} tripped ${seat.player.name} into a beam`, by.player.color);
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    const playing = this.state === 'play';
    this._updateJumps(dt, playing);
    this.arena.step(dt, playing);
    // Circular chamber wall.
    for (const a of this.arena.actors) {
      if (!a.alive) continue;
      const r = Math.hypot(a.pos.x, a.pos.z), max = R - a.radius;
      if (r > max) {
        a.pos.x *= max / r; a.pos.z *= max / r;
        a.subject.root.position.x = a.pos.x; a.subject.root.position.z = a.pos.z;
      }
    }
    this._poseAirborne();

    if (!playing && !this.poweredDown) {
      // Test concluded: the emitter powers down.
      this.poweredDown = true;
      for (const b of this.beams) b.state = 'off';
      Audio.sfx('buzz', { vol: 0.4 });
    }
    this._updateBeams(dt, playing);
    this._animateEmitter();
    if (!playing) return;

    this._schedule();

    // Lethal contact: did a live beam sweep across a subject this tick?
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      const r = Math.hypot(a.pos.x, a.pos.z);
      if (r < 0.2) continue;
      const phi = Math.atan2(a.pos.z, a.pos.x);
      const hw = Math.min(0.6, (a.radius * 0.7 + 0.06) / r);
      for (const b of this.beams) {
        if (b.state !== 'on') continue;
        if (b.kind === 'low' ? a.y >= LOW_CLEAR : a.y <= HIGH_HIT) continue;
        const sweep = b.angle - b.prevAngle;
        const rel = angleDiff(b.prevAngle, phi);
        const hit = sweep >= 0 ? (rel >= -hw && rel <= sweep + hw) : (rel <= hw && rel >= sweep - hw);
        if (hit) { this._burn(seat, b); break; }
      }
    }

    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'CAUTERIZED'); this.hud.setStatus(seat, ''); continue; }
      this.hud.setStat(seat, 'ALIVE');
      this.hud.setStatus(seat, seat.actor.data.noJump > 0 ? 'GROUNDED' : '');
    }
    this.hud.setTimer(Math.max(0, CAP - this.time));
    if (this.time >= CAP) { this.hud.banner('TIME UP', 1600); this.end(); return; }
    this.checkLastStanding();
  }

  /** Escalation timeline + direction reversals. */
  _schedule() {
    const t = this.time;
    if (this.stage === 0 && t >= 11) {
      this.stage = 1;
      this._setBeam(this.beams[1], 'warm');
      this.hud.banner('HIGH BEAM ONLINE', 1400, 'danger');
      this.hud.prompt('Magenta burns the airborne — stay down');
      setTimeout(() => this.hud.prompt(null), 4500);
    } else if (this.stage === 1 && t >= 23) {
      this.stage = 2;
      this._setBeam(this.beams[2], 'warm');
      this.hud.banner('THIRD BEAM ONLINE', 1400, 'danger');
    } else if (this.stage === 2 && t >= 36) {
      this.stage = 3;
      // The rotor's high beam retires; a counter-rotating one takes over from the same spot.
      this._setBeam(this.beams[1], 'off');
      const c = this.beams[3];
      this.counterAngle = this.rotorAngle + Math.PI / 2;
      c.angle = c.prevAngle = this.counterAngle;
      this._setBeam(c, 'warm');
      this.hud.banner('COUNTER-ROTATION', 1400, 'danger');
      Audio.sfx('grind', { vol: 0.5 });
    }

    if (!this.revWarned && t >= this.revAt - 1.2) {
      this.revWarned = true;
      this.hud.banner('REVERSING', 1100, 'danger');
      Audio.sfx('buzz', { vol: 0.6 });
    }
    if (t >= this.revAt) {
      this.rotorDir *= -1;
      this.lastReverseT = t;
      this.revAt = t + rand(7, 11);
      this.revWarned = false;
      Audio.sfx('clank', { vol: 0.6 });
      this.engine.shake(0.15);
    }
  }

  // -------------------------------------------------------------------- bots

  /** Roll how a bot will handle the next approaching low beam. */
  _newPlan(brain) {
    const blunder = random() < brain.error * 0.35;
    const lead = blunder
      ? (random() < 0.5 ? rand(0.55, 0.8) : rand(-0.1, 0.03))      // way too early / too late
      // ~2 ticks pass between the decision and take-off (input commit latency).
      : 0.24 + (brain.reaction - 0.2) * 0.25 + rand(-1, 1) * brain.error * 0.35;
    brain.memory.plan = {
      lead,
      jumped: false,
      respectHigh: brain.difficulty >= 0.85 || random() < 0.3 + brain.difficulty * 0.65,
      smart: random() < 0.2 + brain.difficulty * 0.8,   // sidesteps low/high crossings
      hunt: random() < brain.difficulty * 0.6,          // stalks rivals to shove them
    };
  }

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory, d = a.data;
    if (mem.homeR === undefined) {
      mem.homeR = 3.5 + rand(-0.5, 0.6);
      mem.drift = rand(-0.5, 0.5);
      mem.driftT = rand(2, 4);
      mem.lastTLow = Infinity;
      mem.aPrev = false;
      mem.bPrev = false;
      this._newPlan(brain);
    }
    mem.driftT -= dt;
    if (mem.driftT <= 0) { mem.drift = rand(-0.6, 0.6); mem.driftT = rand(2, 5); }

    const r = Math.hypot(a.pos.x, a.pos.z) || 0.01;
    const phi = Math.atan2(a.pos.z, a.pos.x);
    // Right after a reversal a bot keeps predicting the old direction for `reaction` seconds.
    const stale = this.time - this.lastReverseT < brain.reaction;
    // Own angular velocity: running toward a beam makes it arrive sooner.
    const selfW = (-Math.sin(phi) * a.vel.x + Math.cos(phi) * a.vel.z) / r;
    const tLow = this._arrival(phi, 'low', stale, selfW);
    const tHigh = this._arrival(phi, 'high', stale, selfW);
    if (tLow > mem.lastTLow + 0.25) this._newPlan(brain); // previous beam passed: next pass
    mem.lastTLow = tLow;
    const plan = mem.plan;

    // --- jump timing
    const canJump = d.air < 0 && d.jumpCd <= 0 && d.noJump <= 0 && a.stun <= 0;
    const wantA = canJump && !plan.jumped && tLow <= plan.lead && (!plan.respectHigh || tHigh > 0.5);

    // --- movement: hold mid-radius, drift slowly, keep personal space
    let dphi = mem.drift * 0.3;
    if (plan.smart && tLow < 2.5 && Math.abs(tLow - tHigh) < 0.65) {
      // A low and a high beam will cross here: step to whichever side separates them more.
      const step = 1.4 / r;
      let bestScore = Math.abs(tLow - tHigh);
      for (const o of [step, -step]) {
        const sc = Math.abs(this._arrival(phi + o, 'low', stale) - this._arrival(phi + o, 'high', stale));
        if (sc > bestScore + 0.1) { bestScore = sc; dphi = o; }
      }
    }
    let tx = Math.cos(phi + dphi) * mem.homeR, tz = Math.sin(phi + dphi) * mem.homeR;
    for (const o of this.arena.actors) {
      if (o === a || !o.alive) continue;
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, dd = Math.hypot(dx, dz);
      if (dd < 1.6 && dd > 0.01) { tx += (dx / dd) * (1.6 - dd) * 1.2; tz += (dz / dd) * (1.6 - dd) * 1.2; }
    }

    // --- shove a rival just before a low beam reaches them (they cannot jump then)
    let wantB = false, hunt = null;
    const n = nearest(a, this.arena.actors);
    if (n) {
      const t = n.actor;
      const tt = this._arrival(Math.atan2(t.pos.z, t.pos.x), 'low', stale);
      if (n.dist < 1.45 && a.shoveCd <= 0 && tt > 0.12 && tt < 0.6 && tLow > 0.75 && random() < brain.difficulty * 0.35) {
        wantB = true;
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, dd = Math.hypot(dx, dz) || 1;
        a.ctrl.setMove((dx / dd) * 0.4, (dz / dd) * 0.4);
        a.facing = Math.atan2(dx, dz);
      } else if (plan.hunt && n.dist < 3.2 && tt > 0.6 && tt < 1.8 && tLow > 1.0) {
        hunt = t;
      }
    }
    if (!wantB) {
      // Plant the feet while a low beam closes in, so the timing stays readable.
      if (tLow < 0.55 && d.air < 0) a.ctrl.setMove(0, 0);
      else if (hunt) steerTo(a, hunt.pos.x, hunt.pos.z, { arrive: 0.9 });
      else steerTo(a, tx, tz, { arrive: 0.3, slow: 3 });
    }

    // Buttons are edge-triggered: never hold them two frames in a row.
    const pa = wantA && !mem.aPrev, pb = wantB && !mem.bPrev;
    if (pa) plan.jumped = true;
    a.ctrl.setButtons(pa, pb);
    mem.aPrev = pa;
    mem.bPrev = pb;
  }
}

// ------------------------------------------------------------ texture helpers

/** Radial soot streaks and char blotches (transparent overlay for the chamber floor). */
function sootTexture() {
  return canvasTexture('lasersweep-soot', 256, (c, s) => {
    c.clearRect(0, 0, s, s);
    const cx = s / 2;
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = cx * (0.12 + Math.random() * 0.3), r1 = cx * (0.55 + Math.random() * 0.42);
      c.strokeStyle = `rgba(12,8,6,${0.05 + Math.random() * 0.13})`;
      c.lineWidth = 1 + Math.random() * 3;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
      c.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, rr = cx * (0.2 + Math.random() * 0.7);
      const x = cx + Math.cos(a) * rr, y = cx + Math.sin(a) * rr, br = 6 + Math.random() * 18;
      const g = c.createRadialGradient(x, y, 0, x, y, br);
      g.addColorStop(0, `rgba(8,5,3,${0.25 + Math.random() * 0.35})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - br, y - br, br * 2, br * 2);
    }
    // A dark ring where the ankle beams graze the floor most.
    c.strokeStyle = 'rgba(10,6,4,0.18)';
    c.lineWidth = 10;
    c.beginPath(); c.arc(cx, cx, cx * 0.55, 0, Math.PI * 2); c.stroke();
  });
}

/** Charred scorch mark left where a subject burned. */
function burnTexture() {
  return canvasTexture('lasersweep-burn', 64, (c, s) => {
    c.clearRect(0, 0, s, s);
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(5,3,2,0.92)');
    g.addColorStop(0.55, 'rgba(22,10,4,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; c.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  });
}
