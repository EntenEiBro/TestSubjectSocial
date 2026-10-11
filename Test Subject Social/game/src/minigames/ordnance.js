/**
 * LIVE ORDNANCE — hot potato, facility edition. Somebody is always holding
 * a bundle of dynamite with a timer taped to it. Do not be that somebody.
 *
 * Rules
 *  - Rectangular test pen with three obstacles (two crate stacks and a
 *    generator) to dodge around and hide behind.
 *  - A bomb drops from the ceiling into a random subject's hands. Its fuse is
 *    a hidden 9–16 s (5–8 s once the round has run 50 s). The LED blinks and
 *    the beeping speeds up as the fuse nears zero.
 *  - The holder passes it on by touching another subject, or presses A to
 *    toss it at the nearest subject in front of them (short range, aim
 *    assisted; with nobody in range the toss is fumbled). Whoever just got
 *    rid of the bomb is immune for 0.7 s, so it can't bounce straight back.
 *  - The holder moves 10% faster. Everyone can shove with B — the usual way
 *    to keep the holder off you.
 *  - Fuse out: the holder is gibbed (big blast, knockback, camera shake).
 *    A fresh bomb drops onto a random survivor 2 s later.
 *  - Last subject standing wins. At 75 s the current bomb goes off
 *    immediately and the survivors share the win.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, crate, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { steerTo, nearest, wander } from '../core/ai.js';
import { clamp } from '../core/util.js';
import { rand, pick, random } from '../core/rng.js';

const HALF_W = 8.5, HALF_D = 5.5;   // inner pen half-extents
const CAP = 75;                      // hard time cap (s)
const LATE = 50;                     // after this, fuses get short
const RESPAWN = 2;                   // pause between a blast and the next bomb
const DROP_TIME = 0.6;               // bomb falling from the ceiling
const TOSS_RANGE = 3.4;
const TOSS_CONE = 0.7;               // cos of the toss aim-assist half angle
const TOSS_TIME = 0.3;               // flight time of a toss
const PASS_IMMUNE = 0.7;             // pass-back immunity for whoever let go
const TOUCH_PAD = 0.12;              // extra reach for a touch pass
const HOLDER_SPEED = 1.1;
const BLAST_PUSH = 3.6;              // knockback radius of a detonation
const BOMB_SCALE = 1.3;
const GEN_H = 0.9;                   // generator height (preview bomb rests on it)
const WANDER = { minX: -HALF_W + 1.5, maxX: HALF_W - 1.5, minZ: -HALF_D + 1.5, maxZ: HALF_D - 1.5 };

export class LiveOrdnance extends Minigame {
  static meta = {
    id: 'ordnance',
    title: 'LIVE ORDNANCE',
    tagline: 'Possession is nine-tenths of the blast radius.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Toss bomb' }, { input: 'b', label: 'Shove' }],
    objective: 'Do not be holding the bomb when it goes off.',
    rules: [
      'A random subject is issued a live bomb. Pass it on before it detonates.',
      'Touch someone to hand it over, or press {A} to toss it at the subject in front of you.',
      'The fuse is hidden. The beeping speeds up as it nears zero.',
      'The holder moves faster. Everyone else can shove with {B}.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 50 });
    this.fx.reserveFlash(); // explosions reuse one light (no shader recompiles)
    this.makeCamera([0, 15.5, 11.8], [0, 0, 0.6], 48);

    // --- floor, pen walls, set dressing
    floor(scene, 44, 32, { tex: 'concrete', tile: 3 });
    floor(scene, HALF_W * 2, HALF_D * 2, { tex: 'plate', tile: 2, y: 0.005 });
    stencil(scene, 'BLAST ZONE', 0, 0.02, 3.4, { w: 6, h: 1.6, opacity: 0.22 }).rotation.x = -Math.PI / 2;
    stencil(scene, 'PASS IT ON', 0, 0.02, -3.4, { w: 6, h: 1.6, opacity: 0.18 }).rotation.x = -Math.PI / 2;

    const wallMat = mat(0xffffff, Tex.rust([4, 1]));
    block(scene, 0, 0.5, -HALF_D - 0.3, HALF_W * 2 + 1.2, 1.0, 0.6, wallMat);
    block(scene, 0, 0.5, HALF_D + 0.3, HALF_W * 2 + 1.2, 1.0, 0.6, wallMat);
    block(scene, -HALF_W - 0.3, 0.5, 0, 0.6, 1.0, HALF_D * 2, wallMat);
    block(scene, HALF_W + 0.3, 0.5, 0, 0.6, 1.0, HALF_D * 2, wallMat);
    hazardStrip(scene, 0, -HALF_D + 0.25, HALF_W * 2, 0.5, 0.012);
    hazardStrip(scene, 0, HALF_D - 0.25, HALF_W * 2, 0.5, 0.012);
    hazardStrip(scene, -HALF_W + 0.25, 0, 0.5, HALF_D * 2 - 1, 0.012);
    hazardStrip(scene, HALF_W - 0.25, 0, 0.5, HALF_D * 2 - 1, 0.012);

    const back = mesh(new THREE.PlaneGeometry(44, 9), mat(0xffffff, Tex.wall([11, 2.25])), 0, 3.5, -HALF_D - 1.4, { cast: false });
    scene.add(back);
    stencil(scene, 'ORDNANCE TESTING', 0, 3.4, -HALF_D - 1.35, { w: 9, h: 2.2, opacity: 0.55 });
    pipe(scene, [-18, 5.6, -HALF_D - 1.1], [18, 5.6, -HALF_D - 1.1], 0.22);
    pipe(scene, [-18, 4.9, -HALF_D - 1.2], [18, 4.9, -HALF_D - 1.2], 0.1, 0x5a3022);
    crate(scene, -10.8, 0, -3.5, 1.2, 0.3);
    crate(scene, -10.6, 1.2, -3.4, 0.8, -0.2);
    crate(scene, 10.9, 0, 2.5, 1.3, -0.4);

    hangingLamp(scene, -4.5, 7.5, 0, { intensity: 85, angle: 0.9 });
    hangingLamp(scene, 4.5, 7.5, 0, { intensity: 85, angle: 0.9 });
    hangingLamp(scene, 0, 8, -3.5, { color: 0xff6a4a, intensity: 25, angle: 0.8, shadow: false });

    // --- arena + obstacles
    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, shoveForce: 13 });
    this.obstacles = [];
    const addObstacle = (x, z, w, d) => this.obstacles.push(this.arena.addWall(x - w / 2, x + w / 2, z - d / 2, z + d / 2));

    crate(scene, -4, 0, -1.6, 1.4, 0);
    crate(scene, -3.95, 1.4, -1.55, 0.85, 0.35);
    addObstacle(-4, -1.6, 1.4, 1.4);
    crate(scene, 4, 0, 1.6, 1.4, 0);
    crate(scene, 4.05, 1.4, 1.62, 0.85, -0.3);
    addObstacle(4, 1.6, 1.4, 1.4);
    // Generator in the middle (the preview bomb sits on it).
    block(scene, 0, GEN_H / 2, 0, 2.2, GEN_H, 0.9, mat(0x8a8f84, Tex.metal()));
    const genTop = mesh(new THREE.PlaneGeometry(2.0, 0.7), mat(0xffffff, Tex.hazard([2, 1])), 0, GEN_H + 0.01, 0, { cast: false });
    genTop.rotation.x = -Math.PI / 2;
    scene.add(genTop);
    block(scene, -0.7, GEN_H + 0.15, 0, 0.3, 0.3, 0.5, mat(0x3a3c38, Tex.plate()));
    addObstacle(0, 0, 2.2, 0.9);

    // --- avatars (opposite corners first so 2 players start far apart)
    const spots = [[-6.5, -3.5], [6.5, 3.5], [6.5, -3.5], [-6.5, 3.5]];
    this.seats.forEach((seat, i) => {
      const [x, z] = spots[i];
      this.spawnSubject(seat, { x, z, facing: x < 0 ? Math.PI / 2 : -Math.PI / 2 });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
      seat.actor.facing = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      seat.actor.data.immuneUntil = 0;
    });

    this._tmp = new THREE.Vector3();
    this._buildBomb(scene);
  }

  /** Three sticks of dynamite, tape, a timer box with a blinking LED. */
  _buildBomb(scene) {
    const g = new THREE.Group();
    const stickMat = mat(0xa3271b, Tex.fabric());
    const tapeMat = mat(0x1d1d1b);
    const stickGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8);
    for (const [y, z] of [[0, -0.08], [0, 0.08], [0.135, 0]]) {
      const s = mesh(stickGeo, stickMat, 0, y, z);
      s.rotation.z = Math.PI / 2;
      g.add(s);
    }
    const tapeGeo = new THREE.BoxGeometry(0.06, 0.3, 0.33);
    g.add(mesh(tapeGeo, tapeMat, -0.15, 0.065, 0), mesh(tapeGeo, tapeMat, 0.15, 0.065, 0));
    const timer = mesh(new THREE.BoxGeometry(0.2, 0.07, 0.13), mat(0x2c2f2c, Tex.metal()), 0, 0.24, 0);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x3a0806 });
    const led = mesh(new THREE.SphereGeometry(0.035, 6, 4), ledMat, 0.05, 0.29, 0, { cast: false });
    const wire = mesh(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), mat(0xd8b02a), -0.05, 0.27, 0, { cast: false });
    g.add(timer, led, wire);
    g.scale.setScalar(BOMB_SCALE);
    g.visible = false;
    scene.add(g);
    // The glow light lives in the scene (always "visible") so hiding the bomb
    // never changes the light count (no shader recompiles mid-round).
    const light = new THREE.PointLight(0xff2010, 0, 4.5, 1.6);
    scene.add(light);

    this.bomb = {
      g, ledMat, light,
      state: 'none',           // 'none' | 'drop' | 'held' | 'flying'
      holder: null, from: null, target: null,
      pos: new THREE.Vector3(), start: new THREE.Vector3(),
      fuse: 1, fuseMax: 1, holdT: 0, tossCd: 0, flyT: 0, dropT: 0, respawnT: 1,
      blink: 0, blinkOn: false, spin: 0, hop: 0,
    };
  }

  start() {
    const b = this.bomb;
    this._hideBomb();
    b.respawnT = 1.0;
    b.blink = 0;
    this.hud.banner('PASS IT ON', 1000);
    this.hud.prompt('{A} toss the bomb · {B} shove');
    setTimeout(() => this.hud.prompt(null), 4500);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // A dormant bomb idles on the generator.
    const b = this.bomb;
    b.g.visible = true;
    b.spin += dt * 0.5;
    b.g.position.set(0, GEN_H + 0.1, 0);
    b.g.rotation.set(0, b.spin, 0);
    b.blink += dt * 1.2;
    const on = (b.blink % 1) < 0.4;
    b.ledMat.color.setHex(on ? 0xff2a14 : 0x3a0806);
    b.light.position.set(0, GEN_H + 0.7, 0);
    b.light.intensity = on ? 3 : 0;
  }

  // -------------------------------------------------------------------- bomb

  /** Where a holder carries the bomb: in both hands, in front of the chest. */
  _handPos(actor, out) {
    const yaw = actor.subject.root.rotation.y;
    return out.set(actor.pos.x + Math.sin(yaw) * 0.6, 1.3, actor.pos.z + Math.cos(yaw) * 0.6);
  }

  /** Drop a fresh bomb onto a random survivor. */
  _dropBomb() {
    const b = this.bomb;
    const alive = this.aliveSeats;
    if (alive.length < 2) { b.respawnT = 0.5; return; }
    b.state = 'drop';
    b.dropT = 0;
    b.target = pick(alive);
    b.holder = null;
    b.from = null;
    b.fuseMax = b.fuse = this.time > LATE ? rand(5, 8) : rand(9, 16);
    b.blink = 0;
    Audio.sfx('whoosh');
    if (this.time > 2) this.hud.banner('NEW ORDNANCE', 1000, 'danger');
  }

  /** `seat` now holds the bomb. */
  _grab(seat) {
    const b = this.bomb;
    b.state = 'held';
    b.holder = seat;
    b.target = null;
    b.holdT = 0;
    b.tossCd = 0.25;
    seat.actor.speedMul = HOLDER_SPEED;
    seat.subject.pose = 'carry';
    Audio.sfx('clank', { vol: 0.5 });
  }

  /** `seat` lets go of the bomb (pass or toss). */
  _release(seat) {
    seat.actor.speedMul = 1;
    seat.subject.pose = 'idle';
    seat.actor.data.immuneUntil = this.time + PASS_IMMUNE;
  }

  _pass(from, to) {
    this._release(from);
    this._grab(to);
    Audio.sfx('shove', { vol: 0.5 });
    this.hud.feed(`${from.player.name} passed the bomb to ${to.player.name}`, to.player.color);
  }

  /** Best toss target: closest eligible subject inside the forward cone with a clear line. */
  _tossTarget(seat) {
    const a = seat.actor;
    const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
    let best = null, bs = Infinity;
    for (const s of this.seats) {
      if (s === seat || !s.alive || s.actor.data.immuneUntil > this.time) continue;
      const dx = s.actor.pos.x - a.pos.x, dz = s.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > TOSS_RANGE || d < 0.01) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < TOSS_CONE) continue;
      if (!this.arena.clearLine(a.pos, s.actor.pos)) continue;
      const score = d * (2 - dot);
      if (score < bs) { bs = score; best = s; }
    }
    return best;
  }

  _toss(seat) {
    const b = this.bomb;
    seat.subject.push();
    const t = this._tossTarget(seat);
    if (!t) { // nobody to catch it: fumble and keep it
      b.tossCd = 0.6;
      b.hop = 0.35;
      Audio.sfx('wrong', { vol: 0.4 });
      return;
    }
    this._release(seat);
    b.start.copy(b.pos);
    b.state = 'flying';
    b.from = seat;
    b.target = t;
    b.holder = null;
    b.flyT = 0;
    Audio.sfx('whoosh');
  }

  /** Fuse out: gib `victim`, blast everyone nearby back, schedule the next bomb. */
  _detonate(victim) {
    const b = this.bomb;
    const a = victim.actor;
    const at = new THREE.Vector3(a.pos.x, 1.0, a.pos.z);
    this._hideBomb();
    b.respawnT = RESPAWN;
    this.fx.explosion(at, 1.4);
    this.fx.smoke(at.clone(), { color: 0x222222, size: 1.1, rise: 2.4, life: 2.4, opacity: 0.6 });
    Audio.sfx('explode');
    this.kill(victim, 'gib', { dir: a.forward, force: 1.5, quiet: true });
    this.engine.shake(1.0);
    this.hud.feed(`${victim.player.name} — DETONATED`, victim.player.color);
    for (const s of this.aliveSeats) {
      const o = s.actor;
      const dx = o.pos.x - at.x, dz = o.pos.z - at.z, d = Math.hypot(dx, dz);
      if (d < BLAST_PUSH && d > 0.01) {
        const f = 12 * (1 - d / BLAST_PUSH);
        o.knock.x += (dx / d) * f;
        o.knock.z += (dz / d) * f;
        o.stun = Math.max(o.stun, 0.3); // the Arena turns this into a haptic hit
      }
    }
  }

  /** Take the bomb out of play (no holder, invisible). */
  _hideBomb() {
    const b = this.bomb;
    if (b.holder) { b.holder.actor.speedMul = 1; b.holder.subject.pose = 'idle'; }
    b.state = 'none';
    b.holder = null;
    b.from = null;
    b.target = null;
    b.g.visible = false;
    b.light.intensity = 0;
  }

  _updateBombLogic(dt) {
    const b = this.bomb;
    if (b.state === 'none') {
      b.respawnT -= dt;
      if (b.respawnT <= 0) this._dropBomb();
      return;
    }
    if (b.state === 'held' || b.state === 'flying') {
      b.fuse -= dt;
      if (b.fuse <= 0) { this._detonate(b.state === 'held' ? b.holder : b.target); return; }
    }

    if (b.state === 'drop') {
      if (!b.target.alive) {
        const alive = this.aliveSeats;
        if (alive.length < 2) { this._hideBomb(); b.respawnT = 0.5; return; }
        b.target = pick(alive);
      }
      b.dropT += dt / DROP_TIME;
      if (b.dropT >= 1) {
        const t = b.target;
        this._grab(t);
        this.hud.feed(`${t.player.name} has the bomb`, t.player.color);
      }
    } else if (b.state === 'held') {
      const holder = b.holder, h = holder.actor;
      b.holdT += dt;
      b.tossCd = Math.max(0, b.tossCd - dt);
      if (holder.ctrl.aPressed && b.tossCd <= 0 && b.holdT > 0.2 && h.stun <= 0) this._toss(holder);
      if (b.state === 'held' && b.holdT > 0.15) {
        for (const s of this.seats) {
          if (s === holder || !s.alive) continue;
          const o = s.actor;
          if (o.data.immuneUntil > this.time) continue;
          if (Math.hypot(o.pos.x - h.pos.x, o.pos.z - h.pos.z) < h.radius + o.radius + TOUCH_PAD) { this._pass(holder, s); break; }
        }
      }
    } else if (b.state === 'flying') {
      b.flyT += dt / TOSS_TIME;
      if (b.flyT >= 1) {
        const from = b.from, to = b.target;
        if (to.alive) {
          this._grab(to);
          this.hud.feed(`${from.player.name} tossed the bomb to ${to.player.name}`, to.player.color);
        } else if (from.alive) this._grab(from);
        else { this._hideBomb(); b.respawnT = RESPAWN; }
      }
    }
  }

  /** Bomb placement, LED blink and beeps (speed up as the fuse runs out). */
  _updateBombVisual(dt, playing) {
    const b = this.bomb, g = b.g, p = b.pos;
    if (b.state === 'none') { g.visible = false; b.light.intensity = 0; return; }
    g.visible = true;
    if (b.state === 'drop') {
      this._handPos(b.target.actor, p);
      const k = Math.min(1, b.dropT);
      p.y += (1 - k * k) * 9;
      b.spin += dt * 6;
      g.rotation.set(0, b.spin, 0);
    } else if (b.state === 'held') {
      this._handPos(b.holder.actor, p);
      if (b.hop > 0) { b.hop = Math.max(0, b.hop - dt); p.y += Math.sin((b.hop / 0.35) * Math.PI) * 0.5; }
      g.rotation.set(0, b.holder.subject.root.rotation.y, 0);
    } else if (b.state === 'flying') {
      this._handPos(b.target.actor, this._tmp);
      const k = Math.min(1, b.flyT);
      p.lerpVectors(b.start, this._tmp, k);
      p.y += Math.sin(k * Math.PI) * 1.1;
      b.spin += dt * 16;
      g.rotation.set(b.spin * 0.5, b.spin, 0);
    }
    g.position.copy(p);

    const remaining = Math.max(0, b.fuse);
    const burnt = 1 - remaining / b.fuseMax;
    const urgency = b.state === 'drop' ? 0 : Math.max(burnt * burnt, clamp(1 - remaining / 5, 0, 1));
    b.blink += dt * (1.2 + urgency * 10);
    const on = (b.blink % 1) < 0.4;
    if (on && !b.blinkOn && playing && b.state !== 'drop') {
      Audio.sfx(urgency > 0.6 ? 'beep' : 'tick', { vol: urgency > 0.6 ? 0.45 : 0.7 });
    }
    b.blinkOn = on;
    b.ledMat.color.setHex(on ? 0xff2a14 : 0x3a0806);
    b.light.position.set(p.x, p.y + 0.5, p.z);
    b.light.intensity = on ? 3 + urgency * 5 : 0;
    g.scale.setScalar(BOMB_SCALE * (on ? 1 + urgency * 0.12 : 1));
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    if (playing) this._updateBombLogic(dt);
    this._updateBombVisual(dt, playing);
    if (!playing) return;

    const b = this.bomb;
    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'VAPORISED'); this.hud.setStatus(seat, ''); continue; }
      const holds = b.state === 'held' && b.holder === seat;
      const incoming = (b.state === 'drop' || b.state === 'flying') && b.target === seat;
      this.hud.setStatus(seat, holds ? 'HOLDER' : '');
      this.hud.setStat(seat, holds ? 'TICKING' : incoming ? 'INCOMING' : seat.actor.data.immuneUntil > this.time ? 'IMMUNE' : 'ALIVE');
    }
    this.hud.setTimer(Math.max(0, CAP - this.time));

    if (this.time >= CAP) {
      // Time's up: whoever has the bomb right now gets it anyway.
      if (b.state === 'held') this._detonate(b.holder);
      else if (b.state === 'flying') this._detonate(b.target);
      else this._hideBomb();
      this.hud.banner('TIME UP', 1400, 'danger');
      this.end();
      return;
    }
    this.checkLastStanding();
  }

  // -------------------------------------------------------------- bot helpers

  _wallMargin(x, z) { return Math.min(x + HALF_W, HALF_W - x, z + HALF_D, HALF_D - z); }

  _insideObstacle(x, z, pad) {
    for (const o of this.obstacles) if (x > o.minX - pad && x < o.maxX + pad && z > o.minZ - pad && z < o.maxZ + pad) return true;
    return false;
  }

  /** Waypoint around an obstacle corner when the straight line is blocked. */
  _detour(from, tx, tz) {
    const goal = { x: tx, z: tz };
    let best = null, bl = Infinity;
    for (const o of this.obstacles) {
      for (const cx of [o.minX - 0.8, o.maxX + 0.8]) {
        for (const cz of [o.minZ - 0.8, o.maxZ + 0.8]) {
          const c = { x: cx, z: cz };
          if (!this.arena.clearLine(from, c) || !this.arena.clearLine(c, goal)) continue;
          const L = Math.hypot(cx - from.x, cz - from.z) + Math.hypot(tx - cx, tz - cz);
          if (L < bl) { bl = L; best = c; }
        }
      }
    }
    return best || goal;
  }

  /**
   * Pick a place to run to, away from the threat `t`: far from it, out of its
   * line of sight (behind obstacles), off the walls, and not via its reach.
   */
  _pickSpot(a, t, brain, prev) {
    const cands = [];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      cands.push({ x: a.pos.x + Math.cos(ang) * 2.8, z: a.pos.z + Math.sin(ang) * 2.8 });
    }
    for (const o of this.obstacles) {
      const cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2;
      const dx = cx - t.pos.x, dz = cz - t.pos.z, d = Math.hypot(dx, dz) || 1;
      const r = Math.max(o.maxX - o.minX, o.maxZ - o.minZ) / 2 + 0.9;
      cands.push({ x: cx + (dx / d) * r, z: cz + (dz / d) * r });
    }
    if (prev) cands.push(prev);

    let best = null, bs = -Infinity;
    for (const c of cands) {
      const x = clamp(c.x, -HALF_W + 0.7, HALF_W - 0.7), z = clamp(c.z, -HALF_D + 0.7, HALF_D - 0.7);
      if (this._insideObstacle(x, z, 0.55)) continue;
      const p = { x, z };
      let s = Math.min(Math.hypot(x - t.pos.x, z - t.pos.z), 9);
      if (!this.arena.clearLine(t.pos, p)) s += 1.5 + brain.difficulty * 2;     // hidden behind cover
      if (!this.arena.clearLine(a.pos, p)) s -= 1.5;                             // can't run straight there
      const m = this._wallMargin(x, z);
      if (m < 1.6) s -= (1.6 - m) * 2.5;                                         // don't get pinned
      const seg = segDist(t.pos.x, t.pos.z, a.pos.x, a.pos.z, x, z);
      if (seg < 1.8) s -= (1.8 - seg) * 3;                                       // don't run past the holder
      for (const o of this.arena.actors) {
        if (o === a || o === t || !o.alive) continue;
        const dd = Math.hypot(o.pos.x - x, o.pos.z - z);
        if (dd < 1.6) s -= (1.6 - dd) * 0.8;                                     // spread out
      }
      if (c === prev) s += 0.6;                                                   // commit a little
      s += rand(0, brain.error * 3);
      if (s > bs) { bs = s; best = p; }
    }
    return best || { x: a.pos.x, z: a.pos.z };
  }

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory, b = this.bomb;
    let wantA = false, wantB = false;

    if (b.state === 'held' && b.holder === seat) {
      // Holder: chase the nearest rival who can take it, toss when lined up.
      mem.spot = null;
      mem.retarget = (mem.retarget ?? 0) - dt;
      if (mem.retarget <= 0 || !mem.prey || !mem.prey.alive) {
        mem.retarget = 0.15 + brain.reaction;
        const n = nearest(a, this.arena.actors, (o) => !(o.data.immuneUntil > this.time)) || nearest(a, this.arena.actors);
        mem.prey = n ? n.actor.seat : null;
      }
      const prey = mem.prey && mem.prey.alive ? mem.prey.actor : null;
      if (prey) {
        const lead = 0.15 + brain.difficulty * 0.35;
        const tx = clamp(prey.pos.x + prey.vel.x * lead, -HALF_W + 0.5, HALF_W - 0.5);
        const tz = clamp(prey.pos.z + prey.vel.z * lead, -HALF_D + 0.5, HALF_D - 0.5);
        const d = Math.hypot(prey.pos.x - a.pos.x, prey.pos.z - a.pos.z);
        const clear = this.arena.clearLine(a.pos, prey.pos);
        const urgent = b.fuse < 1 + brain.difficulty * 2; // the beeping gives it away
        const canToss = clear && b.tossCd <= 0 && b.holdT > 0.3 + brain.reaction && a.stun <= 0
          && !(prey.data.immuneUntil > this.time) && d < TOSS_RANGE * (0.55 + 0.35 * brain.difficulty);
        if (canToss && (urgent || random() < dt * (0.8 + brain.difficulty * 4))) {
          const aim = Math.atan2(prey.pos.x - a.pos.x, prey.pos.z - a.pos.z) + rand(-1, 1) * brain.error * 2.5;
          a.ctrl.setMove(Math.sin(aim) * 0.6, Math.cos(aim) * 0.6);
          a.facing = aim;
          wantA = true;
        } else if (clear) {
          steerTo(a, tx, tz, { arrive: 0 });
        } else {
          const w = this._detour(a.pos, tx, tz);
          steerTo(a, w.x, w.z, { arrive: 0 });
        }
      } else wander(a, brain, dt, WANDER);
    } else {
      mem.prey = null;
      const threat = b.state === 'held' ? b.holder : (b.state === 'drop' || b.state === 'flying') ? b.target : null;
      if (threat === seat) {
        // The bomb is landing on us: get close to someone to hand it straight on.
        mem.spot = null;
        const n = nearest(a, this.arena.actors);
        if (n) steerTo(a, n.actor.pos.x, n.actor.pos.z, { arrive: 0 });
      } else if (!threat || !threat.alive) {
        mem.spot = null;
        wander(a, brain, dt, WANDER);
      } else {
        // Flee: keep distance and cover between us and the holder.
        const t = threat.actor;
        mem.replan = (mem.replan ?? 0) - dt;
        if (mem.replan <= 0 || !mem.spot) {
          mem.replan = 0.15 + brain.reaction * 0.8;
          mem.spot = this._pickSpot(a, t, brain, mem.spot);
        }
        steerTo(a, mem.spot.x, mem.spot.z, { arrive: 0.25, slow: 0.6 });
        // Cornered by the holder: shove them away.
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 0.01;
        if (b.state === 'held' && d < 1.6 && a.shoveCd <= 0) {
          const cornered = d < 1.1 || this._wallMargin(a.pos.x, a.pos.z) < 1.3 || this._insideObstacle(a.pos.x, a.pos.z, 0.9);
          if (cornered && random() < 0.04 + brain.difficulty * 0.16) {
            a.ctrl.setMove((dx / d) * 0.3, (dz / d) * 0.3);
            wantB = true;
          }
        }
      }
    }
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    a.ctrl.setButtons(wantA && !mem.aPrev, wantB && !mem.bPrev);
    mem.aPrev = wantA && !mem.aPrev;
    mem.bPrev = wantB && !mem.bPrev;
  }
}

/** Distance from point (px, pz) to the segment (ax, az)–(bx, bz). */
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
  const k = L2 > 1e-6 ? clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * k), pz - (az + vz * k));
}
