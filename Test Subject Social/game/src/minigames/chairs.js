/**
 * CHAIR PROTOCOL — lethal musical chairs in a padded-cell conference room.
 *
 * Rules
 *  - A ring of folding chairs stands in the middle of the room: always one
 *    fewer chair than living subjects.
 *  - MUSIC: a looping beep-tune plays for a hidden 4–9 s. The chairs are
 *    electrified (blue glow). Touching one zaps you: ~1 s stun + knockback.
 *  - SIT!: the music stops, the lights flash and the chairs turn safe
 *    (green). Reach a free chair and press A to sit. One subject per chair.
 *    A shove (B) on a seated subject knocks them off their chair.
 *  - 3 s after the music stops, everyone still standing drops through a
 *    trapdoor ('fall'). Then a chair sinks into the floor and the next round
 *    starts (the tune gets a little faster each round).
 *  - Last subject alive wins. Simultaneous drops share a place. Safety cap
 *    at 75 s: survivors rank seated first, then standing.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { Haptics } from '../core/haptics.js';
import { hangingLamp } from '../core/engine.js';
import { room, block, stencil, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { clamp, lerp, angleDiff } from '../core/util.js';
import { rand, randInt, pick, random } from '../core/rng.js';

const HALF_W = 7, HALF_D = 4.8;   // walkable room half-extents
const CHAIR_R = 0.36;             // chair collision radius
const TOUCH = 0.06;               // extra reach that still counts as touching a live chair
const SIT_REACH = 1.1;            // max distance (centre to centre) to sit on a chair
const SIT_DROP = 0.4;             // how far a seated subject's root is lowered
const ZAP_TIME = 1.0;             // stun from a live chair
const ZAP_GRACE = 0.9;            // chairs need a moment to charge when the music starts
const SIT_TIME = 3.0;             // music stop → trapdoors
const HANG = 0.45;                // victims dangle over the open hatch this long
const DROP_TIME = 1.8;            // trapdoor phase length
const RESET_TIME = 2.0;           // chair removal / rearrangement
const CAP = 75;                   // hard time cap (s of play)
const STEP_BASE = 0.2;            // seconds per music step
const TRAP_HALF = 0.55;           // trapdoor half-size
const SPAWN_R = 3.3;
const COLORS = { live: 0x4aa8ff, safe: 0x45ff6a, drop: 0xff3020 };

/** The tune: 16 steps, each a list of [sfx name, volume]. */
const PATTERN = [
  [['thud', 0.7], ['beep', 0.22]], [['tick', 0.5]], [['select', 0.2]], [['tick', 0.5]],
  [['thud', 0.7], ['fork', 0.5]], [['click', 0.7]], [['beep', 0.22]], [['tick', 0.5]],
  [['thud', 0.7], ['ding', 0.12]], [['tick', 0.5]], [['select', 0.2]], [['click', 0.7]],
  [['thud', 0.7], ['fork', 0.5]], [['beep', 0.22]], [['select', 0.2]], [['spider', 0.35]],
];

/** Chair positions for `k` chairs: a ring, each chair facing outward. */
function chairLayout(k) {
  if (k <= 1) return [{ x: 0, z: 0, f: 0 }];
  const R = k === 2 ? 1.25 : 1.55;
  const out = [];
  for (let i = 0; i < k; i++) {
    const th = (k === 2 ? 0 : -Math.PI / 2) + (i / k) * Math.PI * 2;
    const x = Math.cos(th) * R, z = Math.sin(th) * R;
    out.push({ x, z, f: Math.atan2(x, z) });
  }
  return out;
}

export class ChairProtocol extends Minigame {
  static meta = {
    id: 'chairs',
    title: 'CHAIR PROTOCOL',
    tagline: 'Please be seated. Standing is a terminal offence.',
    category: 'Reflex',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Sit down' }, { input: 'b', label: 'Shove' }],
    objective: 'Be seated every time the music stops.',
    rules: [
      'While the music plays the chairs are electrified. Touching one stuns you.',
      'When it stops, reach a free chair and press {A} to sit. One subject per chair.',
      'Whoever is still standing drops through a trapdoor. Then a chair is removed.',
      'Shove ({B}) rivals into live chairs — or off a seat.',
    ],
  };

  build() {
    this.traps = []; // read by floorAt (debris falls through open hatches)
    const scene = this.makeScene({ fogNear: 18, fogFar: 46, ambientIntensity: 0.85, floorAt: (x, z) => this._floorAt(x, z) });
    this.makeCamera([0, 13, 10.2], [0, 0, 0.3], 46);

    // --- room
    room(scene, HALF_W * 2 + 0.6, HALF_D * 2 + 0.6, 4, { floorTex: 'plate', tile: 2, open: ['south'] });
    const disc = mesh(new THREE.CircleGeometry(2.55, 32), mat(0xffffff, Tex.tiles([3, 3])), 0, 0.008, 0, { cast: false });
    disc.rotation.x = -Math.PI / 2;
    scene.add(disc);
    const band = mesh(new THREE.RingGeometry(2.55, 2.85, 40), mat(0xffffff, Tex.hazard([12, 1])), 0, 0.012, 0, { cast: false });
    band.rotation.x = -Math.PI / 2;
    scene.add(band);
    stencil(scene, 'PLEASE BE SEATED', 0, 2.75, -HALF_D - 0.13, { w: 7, h: 1.6, opacity: 0.6 });
    stencil(scene, 'MANDATORY FUN', -4.6, 1.5, -HALF_D - 0.13, { w: 3.2, h: 1, opacity: 0.4 });
    stencil(scene, 'HIGH VOLTAGE', 0, 0.02, 3.9, { w: 4.4, h: 1.2, opacity: 0.28 }).rotation.x = -Math.PI / 2;
    pipe(scene, [-HALF_W - 0.3, 3.6, -HALF_D - 0.05], [HALF_W + 0.3, 3.6, -HALF_D - 0.05], 0.1);

    // Junction box + floor cable feeding the chairs.
    const boxMat = mat(0x56605a, Tex.metal());
    block(scene, 0, 0.75, -HALF_D + 0.05, 0.8, 1.0, 0.36, boxMat);
    block(scene, 0.25, 1.05, -HALF_D + 0.26, 0.06, 0.3, 0.06, mat(0x7a1f1f));
    block(scene, 0, 0.025, (-HALF_D - 2.85) / 2, 0.12, 0.05, HALF_D - 2.85, mat(0x1c1c1a));

    // Wall loudspeakers with an ON AIR lamp.
    this.airMat = glow(0x2a0606);
    const cabMat = mat(0x2a2a27, Tex.plate());
    const coneGeo = new THREE.CylinderGeometry(0.36, 0.12, 0.22, 12, 1, true);
    const coneMat = mat(0x111111, null, { side: THREE.DoubleSide });
    this.cones = [];
    for (const sx of [-1, 1]) {
      const x = sx * 4.9;
      block(scene, x, 2.9, -HALF_D - 0.05, 1.1, 1.4, 0.4, cabMat);
      const cone = mesh(coneGeo, coneMat, x, 2.8, -HALF_D + 0.26, { cast: false });
      cone.rotation.x = Math.PI / 2; // wide end toward the room
      scene.add(cone);
      this.cones.push(cone);
      scene.add(mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), this.airMat, x, 3.45, -HALF_D + 0.17, { cast: false }));
    }

    const lampA = hangingLamp(scene, -3.2, 7, 0, { intensity: 80, angle: 0.95 });
    const lampB = hangingLamp(scene, 3.2, 7, 0, { intensity: 80, angle: 0.95 });
    this.lamps = [lampA.light, lampB.light];
    this.ringLight = new THREE.PointLight(COLORS.live, 0, 7, 1.5);
    this.ringLight.position.set(0, 1.6, 0);
    scene.add(this.ringLight);

    // --- arena
    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, shoveForce: 12 });
    this.arena.addWall(-0.4, 0.4, -HALF_D - 0.5, -HALF_D + 0.23); // junction box

    // --- chairs (shared geometry + materials; emissive shows the current)
    this.frameMat = mat(0x9a9e98, Tex.metal());
    this.padMat = mat(0x6a2a22, Tex.fabric());
    this.haloMat = new THREE.MeshBasicMaterial({ color: COLORS.live, transparent: true, opacity: 0.3, depthWrite: false });
    this.hatchMat = glow(0x030303);
    const geo = {
      leg: new THREE.CylinderGeometry(0.03, 0.03, 0.44, 5),
      seat: new THREE.BoxGeometry(0.52, 0.06, 0.5),
      post: new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5),
      back: new THREE.BoxGeometry(0.48, 0.26, 0.04),
      halo: new THREE.CircleGeometry(0.62, 20),
      hatch: new THREE.PlaneGeometry(0.9, 0.9),
    };
    const n = this.seats.length;
    const k = Math.max(1, n - 1);
    this.chairs = chairLayout(k).map((p) => {
      const ch = this._buildChair(scene, geo);
      this._placeChair(ch, p.x, p.z, p.f);
      return ch;
    });

    // --- trapdoors (one per seat, opened under whoever is left standing)
    const holeGeo = new THREE.PlaneGeometry(TRAP_HALF * 2, TRAP_HALF * 2);
    const holeMat = glow(0x020202);
    const flapGeo = new THREE.BoxGeometry(TRAP_HALF, 0.04, TRAP_HALF * 2);
    const flapMat = mat(0xffffff, Tex.hazard([1, 2]));

    // --- avatars
    this.seats.forEach((seat, i) => {
      const th = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(th) * SPAWN_R, z = Math.sin(th) * SPAWN_R;
      const facing = Math.atan2(-x, -z);
      this.spawnSubject(seat, { x, z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = facing;
      seat.actor.seat = seat;

      const g = new THREE.Group();
      const hole = mesh(holeGeo, holeMat, 0, 0.02, 0, { cast: false, receive: false });
      hole.rotation.x = -Math.PI / 2;
      g.add(hole);
      const flaps = [];
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * TRAP_HALF, 0.024, 0);
        pivot.add(mesh(flapGeo, flapMat, -side * TRAP_HALF / 2, 0, 0, { cast: false }));
        g.add(pivot);
        flaps.push({ pivot, side });
      }
      g.visible = false;
      scene.add(g);
      const trap = { g, flaps, k: 0, open: false, x: 0, z: 0 };
      this.traps.push(trap);
      Object.assign(seat, { chair: null, zap: 0, zapImm: 0, hang: -1, trap });
    });
    this.arena.onShove = (att, vic) => this._onShove(att, vic);

    this.phase = 'music';
    this.phaseT = 0;
    this.phaseId = 0;
    this.round = 1;
    this.musicDur = 6;
    this.step = STEP_BASE;
    this.beatT = 0;
    this.beatIdx = 0;
    this.beatPulse = 0;
    this.mode = 'live';      // chair / light look: 'live' | 'safe' | 'drop' | 'off'
    this.flashT = 0;
    this.arcT = 0.5;
    this.moveT = 0;
    this._pvBeat = -1;
    this._col = new THREE.Color();
  }

  /** One folding chair (sitter faces local +Z) with a floor halo and a removal hatch. */
  _buildChair(scene, geo) {
    const g = new THREE.Group();
    for (const sx of [-0.21, 0.21]) for (const sz of [-0.2, 0.2]) g.add(mesh(geo.leg, this.frameMat, sx, 0.22, sz));
    g.add(mesh(geo.seat, this.padMat, 0, 0.46, 0));
    for (const sx of [-0.21, 0.21]) g.add(mesh(geo.post, this.frameMat, sx, 0.77, -0.22));
    g.add(mesh(geo.back, this.padMat, 0, 0.94, -0.22));
    const halo = mesh(geo.halo, this.haloMat, 0, 0.016, 0, { cast: false, receive: false });
    halo.rotation.x = -Math.PI / 2;
    g.add(halo);
    scene.add(g);
    const hatch = mesh(geo.hatch, this.hatchMat, 0, 0.021, 0, { cast: false, receive: false });
    hatch.rotation.x = -Math.PI / 2;
    hatch.visible = false;
    scene.add(hatch);
    return { g, halo, hatch, x: 0, z: 0, f: 0, fx: 0, fz: 0, ff: 0, tx: 0, tz: 0, tf: 0, active: true, removing: false, sink: 0, occupant: null };
  }

  _placeChair(ch, x, z, f) {
    ch.x = x; ch.z = z; ch.f = f;
    ch.g.position.set(x, ch.g.position.y, z);
    ch.g.rotation.y = f;
  }

  /** A chair that is part of the current round (not sinking away). */
  _live(ch) { return ch.active && !ch.removing; }

  /** Ground height for debris: open trapdoors are bottomless. */
  _floorAt(x, z) {
    for (const t of this.traps) if (t.open && Math.abs(x - t.x) < TRAP_HALF && Math.abs(z - t.z) < TRAP_HALF) return -Infinity;
    return 0;
  }

  // ------------------------------------------------------------------ phases

  start() {
    this.round = 1;
    this._startMusic();
    this.hud.prompt('When the music stops: {A} sits · {B} shoves');
    setTimeout(() => { if (this.state === 'play' && this.phase === 'music') this.hud.prompt(null); }, 5000);
  }

  _startMusic() {
    this.phase = 'music';
    this.phaseT = 0;
    this.phaseId++;
    this.musicDur = this.time > 50 ? rand(2.5, 4.5) : rand(4, 9);
    this.step = STEP_BASE * Math.max(0.75, 1 - 0.07 * (this.round - 1));
    this.beatT = this.step; // first note right away
    this.beatIdx = 0;
    this.mode = 'live';
    this.hud.setTimer(null);
    this.hud.banner('MUSIC ON — DO NOT TOUCH', 1600, 'danger');
  }

  _stopMusic() {
    this.phase = 'sit';
    this.phaseT = 0;
    this.phaseId++;
    this.mode = 'safe';
    this.flashT = 0.6;
    this.beatPulse = 0;
    Audio.sfx('go');
    Audio.sfx('clank', { vol: 0.6 });
    this.hud.banner('SIT!', 1200, 'good');
    this.hud.prompt('Press {A} at a free chair');
  }

  _drop() {
    this.phase = 'drop';
    this.phaseT = 0;
    this.phaseId++;
    this.mode = 'drop';
    this.hud.prompt(null);
    this.hud.setTimer(null);
    let any = false;
    for (const seat of this.seats) {
      if (!seat.alive || seat.chair) continue;
      const a = seat.actor, t = seat.trap;
      t.x = a.pos.x; t.z = a.pos.z;
      t.open = true;
      t.g.position.set(t.x, 0, t.z);
      t.g.visible = true;
      seat.hang = 0;
      seat.zap = 0;
      a.vel.set(0, 0, 0);
      a.knock.set(0, 0, 0);
      any = true;
    }
    if (any) {
      Audio.sfx('clank');
      Audio.sfx('metal', { vol: 0.7 });
      this.engine.shake(0.2);
      this.hud.banner('TRAPDOOR OPEN', 1400, 'danger');
    }
  }

  _startReset() {
    this.phase = 'reset';
    this.phaseT = 0;
    this.phaseId++;
    this.mode = 'off';
    this.moveT = 0;
    for (const t of this.traps) t.open = false;
    for (const seat of this.seats) if (seat.chair) this._unseat(seat, true);
    // Remove chairs until there is one fewer than the survivors.
    const want = Math.max(1, this.aliveSeats.length - 1);
    const live = this.chairs.filter((ch) => this._live(ch));
    while (live.length > want) {
      const ch = live.splice(randInt(0, live.length - 1), 1)[0];
      ch.removing = true;
      ch.sink = 0;
    }
    chairLayout(live.length).forEach((p, i) => {
      const ch = live[i];
      ch.fx = ch.x; ch.fz = ch.z; ch.ff = ch.f;
      ch.tx = p.x; ch.tz = p.z; ch.tf = p.f;
    });
    Audio.sfx('grind', { vol: 0.5 });
    this.hud.banner(`CHAIRS LEFT: ${want}`, 1600);
  }

  _finish() {
    const w = this.aliveSeats[0];
    if (w) { this.hud.banner('LAST SUBJECT SEATED', 2200, 'good'); Audio.sfx('ding'); }
    else this.hud.banner('NOBODY SAT', 2200, 'danger');
    this.hud.setTimer(null);
    this.hud.prompt(null);
    this.end(2.4);
  }

  _timeUp() {
    // Survivors share the podium, seated subjects above standing ones.
    for (const s of this.aliveSeats) s.score = s.chair ? 1 : 0;
    this.hud.banner('TIME UP', 2000, 'danger');
    this.hud.setTimer(null);
    this.hud.prompt(null);
    Audio.sfx('buzz');
    this.end(2);
  }

  // -------------------------------------------------------------- mechanics

  _seat(seat, ch) {
    const a = seat.actor;
    seat.chair = ch;
    ch.occupant = seat;
    a.frozen = true;
    a.y = -SIT_DROP;
    a.pos.set(ch.x, 0, ch.z);
    a.vel.set(0, 0, 0);
    a.knock.set(0, 0, 0);
    a.facing = ch.f;
    Audio.sfx('thud', { vol: 0.6 });
    Haptics.forPlayer(seat.player, 'click');
  }

  /** Stand a subject up; `place` sets them down just in front of the chair. */
  _unseat(seat, place = false) {
    const ch = seat.chair;
    if (!ch) return;
    const a = seat.actor;
    ch.occupant = null;
    seat.chair = null;
    a.frozen = seat.zap > 0 || seat.hang >= 0;
    a.y = 0;
    if (place) {
      const ox = Math.sin(ch.f), oz = Math.cos(ch.f);
      a.pos.set(ch.x + ox * 0.95, 0, ch.z + oz * 0.95);
    }
  }

  _onShove(att, vic) {
    const s = vic.seat;
    if (!s || !s.chair || this.phase !== 'sit' || this.state !== 'play') return;
    this._unseat(s);
    vic.stun = 0.7;
    Audio.sfx('clank', { vol: 0.6 });
    this.hud.feed(`${att.player.name} unseated ${vic.player.name}`, att.player.color);
  }

  _zap(seat, ch) {
    const a = seat.actor;
    seat.zap = ZAP_TIME;
    a.frozen = true;
    let dx = a.pos.x - ch.x, dz = a.pos.z - ch.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) { dx /= d; dz /= d; } else { dx = 0; dz = 1; }
    a.vel.set(0, 0, 0);
    a.knock.x += dx * 6; a.knock.z += dz * 6;
    this.fx.sparks(new THREE.Vector3(ch.x + dx * CHAIR_R, 0.7, ch.z + dz * CHAIR_R), { color: 0x8fd8ff, count: 14, speed: 5 });
    Audio.sfx('buzz');
    Audio.sfx('snap', { vol: 0.5 });
    this.engine.shake(0.15);
    Haptics.forPlayer(seat.player, 'hit');
    this.hud.feed(`${seat.player.name} got zapped`, seat.player.color);
  }

  /** Chair collisions, seated / dangling pins, zap timers and poses. */
  _postPhysics(dt) {
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor, s = seat.subject;
      seat.zapImm = Math.max(0, seat.zapImm - dt);
      if (seat.zap > 0) { seat.zap -= dt; if (seat.zap <= 0) { seat.zap = 0; seat.zapImm = 0.5; } }
      if (seat.chair) {
        a.pos.set(seat.chair.x, 0, seat.chair.z);
        a.vel.set(0, 0, 0); a.knock.set(0, 0, 0);
      } else if (seat.hang >= 0) {
        a.pos.set(seat.trap.x, 0, seat.trap.z);
        a.vel.set(0, 0, 0); a.knock.set(0, 0, 0);
      } else {
        for (const ch of this.chairs) {
          if (!this._live(ch)) continue;
          const dx = a.pos.x - ch.x, dz = a.pos.z - ch.z, d = Math.hypot(dx, dz), min = CHAIR_R + a.radius;
          if (d >= min) continue;
          if (d > 1e-4) { a.pos.x = ch.x + (dx / d) * min; a.pos.z = ch.z + (dz / d) * min; } else a.pos.z = ch.z + min;
        }
      }
      a.frozen = !!seat.chair || seat.zap > 0 || seat.hang >= 0;
      s.root.position.set(a.pos.x, a.y, a.pos.z);
      s.pose = seat.chair ? 'sit' : (seat.zap > 0 || seat.hang >= 0) ? 'armsUp' : a.stun > 0.3 ? 'cower' : 'idle';
      if (seat.zap > 0) { s.root.rotation.z = Math.sin(this.clock * 50) * 0.18; s.root.rotation.x = Math.sin(this.clock * 37) * 0.1; }
      else if (seat.hang >= 0) { s.root.rotation.z = Math.sin(this.clock * 22) * 0.12; s.root.rotation.x = 0; }
      else { s.root.rotation.z = 0; s.root.rotation.x = 0; }
    }
  }

  // ------------------------------------------------------------------ visuals

  /** Chair removal / rearrangement and trapdoor flaps. Positions depend on dt only. */
  _animateProps(dt) {
    if (this.phase === 'reset') this.moveT += dt;
    let k = clamp((this.moveT - 0.6) / 0.9, 0, 1);
    k = k * k * (3 - 2 * k);
    for (const ch of this.chairs) {
      if (!ch.active) continue;
      if (ch.removing) {
        ch.sink += dt;
        ch.halo.visible = false;
        ch.hatch.visible = true;
        ch.hatch.position.set(ch.x, 0.021, ch.z);
        ch.g.rotation.z = ch.sink < 0.3 ? Math.sin(this.clock * 60) * 0.05 : 0;
        ch.g.position.y = ch.sink < 0.3 ? 0 : -(ch.sink - 0.3) * 2;
        if (ch.g.position.y < -1.3) { ch.active = false; ch.g.visible = false; ch.hatch.visible = false; }
        continue;
      }
      if (this.phase === 'reset') this._placeChair(ch, lerp(ch.fx, ch.tx, k), lerp(ch.fz, ch.tz, k), ch.ff + angleDiff(ch.ff, ch.tf) * k);
    }
    for (const t of this.traps) {
      t.k = t.open ? Math.min(1, t.k + dt * 7) : Math.max(0, t.k - dt * 3);
      for (const f of t.flaps) f.pivot.rotation.z = f.side * t.k * (Math.PI / 2);
      t.g.visible = t.open || t.k > 0.001;
    }
  }

  /** Current glow on the chairs, halos, ring light, lamps and speakers. */
  _animateLights(dt) {
    this.beatPulse = Math.max(0, this.beatPulse - dt * 4);
    const p = this.beatPulse;
    const c = this._col;
    let emis = 0, halo = 0, ring = 0;
    if (this.mode === 'live') {
      c.setHex(COLORS.live);
      emis = 0.12 + 0.35 * p + 0.05 * Math.sin(this.clock * 40);
      halo = 0.22 + 0.3 * p;
      ring = 4 + 8 * p;
    } else if (this.mode === 'safe') {
      c.setHex(COLORS.safe);
      emis = 0.15; halo = 0.35; ring = 5;
    } else if (this.mode === 'drop') {
      c.setHex(COLORS.drop);
      emis = 0; halo = 0.2; ring = 5 + Math.sin(this.clock * 18) * 2;
    } else c.setHex(0x000000);
    this.haloMat.color.copy(c);
    this.haloMat.opacity = halo;
    this.ringLight.color.copy(c);
    this.ringLight.intensity = ring;
    this.frameMat.emissive.copy(c).multiplyScalar(emis);
    this.padMat.emissive.copy(c).multiplyScalar(emis * 0.6);
    for (const cone of this.cones) cone.scale.set(1 + 0.18 * p, 1, 1 + 0.18 * p);
    this.airMat.color.setHex(this.mode === 'live' ? (p > 0.3 ? 0xff2a1a : 0x8a1a10) : 0x2a0606);
    let lamp = 80;
    if (this.flashT > 0) {
      this.flashT -= dt;
      lamp = Math.floor(this.flashT * 10) % 2 === 0 ? 260 : 15;
    }
    for (const l of this.lamps) l.intensity = lamp;
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // Cosmetic: the chairs hum along to an imaginary beat (no RNG, no sound).
    const beat = Math.floor(this.clock / 0.8);
    if (beat !== this._pvBeat) { this._pvBeat = beat; this.beatPulse = 1; }
    this._animateLights(dt);
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    for (const seat of this.seats) if (seat.alive) seat.actor.frozen = !!seat.chair || seat.zap > 0 || seat.hang >= 0;
    this.arena.step(dt, playing);
    this._postPhysics(dt);
    this._animateProps(dt);
    this._animateLights(dt);
    if (!playing) return;

    this.phaseT += dt;
    if (this.phase === 'music') {
      // The tune
      this.beatT += dt;
      while (this.beatT >= this.step) {
        this.beatT -= this.step;
        const notes = PATTERN[this.beatIdx % PATTERN.length];
        for (const [name, vol] of notes) Audio.sfx(name, { vol });
        if (notes[0][0] === 'thud') this.beatPulse = 1;
        this.beatIdx++;
      }
      // Live chairs
      if (this.phaseT > ZAP_GRACE) {
        for (const seat of this.seats) {
          if (!seat.alive || seat.chair || seat.zap > 0 || seat.zapImm > 0 || seat.hang >= 0) continue;
          const a = seat.actor;
          for (const ch of this.chairs) {
            if (!this._live(ch)) continue;
            if (Math.hypot(a.pos.x - ch.x, a.pos.z - ch.z) < CHAIR_R + a.radius + TOUCH) { this._zap(seat, ch); break; }
          }
        }
      }
      // Idle arcs crackling off the chairs
      this.arcT -= dt;
      if (this.arcT <= 0) {
        this.arcT = rand(0.25, 0.6);
        const live = this.chairs.filter((ch) => this._live(ch));
        if (live.length) {
          const ch = pick(live);
          this.fx.sparks(new THREE.Vector3(ch.x + rand(-0.25, 0.25), rand(0.2, 0.9), ch.z + rand(-0.25, 0.25)), { color: 0x8fd8ff, count: 4, speed: 2.5 });
        }
      }
      if (this.phaseT >= this.musicDur) this._stopMusic();
    } else if (this.phase === 'sit') {
      for (const seat of this.seats) {
        if (!seat.alive || seat.chair || seat.zap > 0 || seat.hang >= 0) continue;
        const a = seat.actor;
        if (!seat.ctrl.a || a.stun > 0) continue;
        let best = null, bd = SIT_REACH;
        for (const ch of this.chairs) {
          if (!this._live(ch) || ch.occupant) continue;
          const d = Math.hypot(a.pos.x - ch.x, a.pos.z - ch.z);
          if (d < bd) { bd = d; best = ch; }
        }
        if (best) this._seat(seat, best);
      }
      this.hud.setTimer(Math.max(0, SIT_TIME - this.phaseT));
      if (this.phaseT >= SIT_TIME) this._drop();
    } else if (this.phase === 'drop') {
      for (const seat of this.seats) {
        if (!seat.alive || seat.hang < 0) continue;
        seat.hang += dt;
        if (seat.hang >= HANG) {
          seat.hang = -1;
          this.kill(seat, 'fall', { dir: new THREE.Vector3(0, 0, 1) });
        }
      }
      if (this.phaseT >= DROP_TIME) {
        if (this.aliveSeats.length <= 1) { this._finish(); return; }
        this._startReset();
      }
    } else if (this.phase === 'reset') {
      if (this.phaseT >= RESET_TIME) { this.round++; this._startMusic(); }
    }

    // HUD
    for (const s of this.seats) {
      this.hud.setStat(s, s.alive ? 'ALIVE' : 'DROPPED');
      this.hud.setStatus(s, !s.alive ? '' : s.zap > 0 ? 'ZAPPED' : s.chair ? 'SEATED' : 'STANDING');
    }

    if (this.state !== 'play') return;
    if (this.phase !== 'drop' && this.aliveSeats.length <= 1) { this._finish(); return; } // e.g. a solo seat
    if (this.time >= CAP) this._timeUp();
  }

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, c = a.ctrl, brain = seat.brain, m = brain.memory;
    if (m.phaseId !== this.phaseId) {
      m.phaseId = this.phaseId;
      m.react = brain.reaction + rand(0, 0.25) * (1 - brain.difficulty);
      m.evict = random() < brain.difficulty;
      m.slipAt = random() < brain.error * 1.5 ? rand(1.2, 4) : -1; // a careless drift toward the chairs
      m.slipT = 0;
      if (!m.dir) m.dir = random() < 0.5 ? 1 : -1;
      m.orbitJit = rand(-0.3, 0.3);
    }
    if (seat.chair || seat.hang >= 0 || seat.zap > 0) { c.setMove(0, 0); c.setButtons(false, false); m.bPrev = false; return; }

    let wantA = false, wantB = false;
    if (this.phase === 'sit' && this.phaseT >= m.react) {
      const r = this._botSit(seat, dt);
      wantA = r.a; wantB = r.b;
    } else {
      wantB = this._botOrbit(seat, dt, this.phase === 'music');
    }
    // B is edge-triggered: alternate so repeated intents become fresh presses.
    c.setButtons(wantA, wantB && !m.bPrev);
    m.bPrev = wantB && !m.bPrev;
  }

  /** Circle the ring at a safe distance; strong bots shove rivals into live chairs. Returns wantB. */
  _botOrbit(seat, dt, music) {
    const a = seat.actor, brain = seat.brain, m = brain.memory;
    let extent = 0;
    for (const ch of this.chairs) if (this._live(ch)) extent = Math.max(extent, Math.hypot(ch.x, ch.z) + CHAIR_R + 0.1);
    let orbitR = extent + 0.95 + (1 - brain.difficulty) * 0.9 + m.orbitJit;
    let slipping = false;
    if (music && m.slipAt > 0 && this.phaseT > m.slipAt && m.slipT < 0.7) { m.slipT += dt; orbitR = Math.max(0.2, extent - 0.4); slipping = true; }

    // Sabotage: shove a rival standing between us and the chairs.
    if (music && brain.difficulty >= 0.6 && this.phaseT > ZAP_GRACE && a.shoveCd <= 0) {
      const myR = Math.hypot(a.pos.x, a.pos.z);
      for (const o of this.seats) {
        if (o === seat || !o.alive || o.chair || o.zap > 0 || o.hang >= 0) continue;
        const dx = o.actor.pos.x - a.pos.x, dz = o.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.3 && d > 0.01 && Math.hypot(o.actor.pos.x, o.actor.pos.z) < myR - 0.2 && random() < brain.difficulty * dt * 1.2) {
          a.ctrl.setMove((dx / d) * 0.35, (dz / d) * 0.35);
          return true;
        }
      }
    }

    const ang = Math.atan2(a.pos.z, a.pos.x) + m.dir * 0.55;
    const tx = clamp(Math.cos(ang) * orbitR, -HALF_W + 0.8, HALF_W - 0.8);
    const tz = clamp(Math.sin(ang) * orbitR, -HALF_D + 0.8, HALF_D - 0.8);
    let mx = tx - a.pos.x, mz = tz - a.pos.z;
    const ml = Math.hypot(mx, mz) || 1;
    const speed = music ? 0.6 : 0.4;
    mx = (mx / ml) * speed; mz = (mz / ml) * speed;
    if (!slipping) {
      for (const ch of this.chairs) {
        if (!this._live(ch)) continue;
        const dx = a.pos.x - ch.x, dz = a.pos.z - ch.z, d = Math.hypot(dx, dz) || 0.01;
        const clear = CHAIR_R + a.radius + 0.45;
        if (d < clear) { const w = ((clear - d) / 0.45) * 1.5; mx += (dx / d) * w; mz += (dz / d) * w; }
      }
    }
    for (const o of this.seats) {
      if (o === seat || !o.alive) continue;
      const dx = a.pos.x - o.actor.pos.x, dz = a.pos.z - o.actor.pos.z, d = Math.hypot(dx, dz) || 0.01;
      if (d < 1.1) { mx += (dx / d) * (1.1 - d) * 0.6; mz += (dz / d) * (1.1 - d) * 0.6; }
    }
    a.ctrl.setMove(mx, mz);
    return false;
  }

  /** Rush the best free chair and sit; contest rivals; evict a sitter if nothing is free. */
  _botSit(seat, dt) {
    const a = seat.actor, brain = seat.brain, m = brain.memory;
    const free = this.chairs.filter((ch) => this._live(ch) && !ch.occupant);
    if (free.length) {
      let best = null, bc = Infinity, bd = 0;
      for (const ch of free) {
        const d = Math.hypot(a.pos.x - ch.x, a.pos.z - ch.z);
        let cost = d;
        if (brain.difficulty >= 0.5 && free.length > 1) {
          for (const o of this.seats) {
            if (o === seat || !o.alive || o.chair || o.hang >= 0) continue;
            if (Math.hypot(o.actor.pos.x - ch.x, o.actor.pos.z - ch.z) < d - 0.6) cost += 1.2 * brain.difficulty;
          }
        }
        if (cost < bc) { bc = cost; best = ch; bd = d; }
      }
      // Contest: shove a rival racing us for the same chair.
      if (brain.difficulty >= 0.5 && a.shoveCd <= 0 && bd > SIT_REACH - 0.05) {
        for (const o of this.seats) {
          if (o === seat || !o.alive || o.chair || o.hang >= 0) continue;
          const dx = o.actor.pos.x - a.pos.x, dz = o.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d < 1.2 && d > 0.01 && Math.hypot(o.actor.pos.x - best.x, o.actor.pos.z - best.z) < bd + 0.5 && random() < brain.difficulty * dt * 5) {
            a.ctrl.setMove((dx / d) * 0.35, (dz / d) * 0.35);
            return { a: false, b: true };
          }
        }
      }
      steerTo(a, best.x, best.z, { arrive: 0, slow: 0.3 });
      return { a: bd < SIT_REACH - 0.05, b: false };
    }
    // Every chair taken: go and yank someone off theirs (or give up).
    if (!m.evict) { a.ctrl.setMove(0, 0); return { a: false, b: false }; }
    let target = null, td = Infinity;
    for (const o of this.seats) {
      if (o === seat || !o.alive || !o.chair) continue;
      const d = Math.hypot(o.actor.pos.x - a.pos.x, o.actor.pos.z - a.pos.z);
      if (d < td) { td = d; target = o; }
    }
    if (!target) { a.ctrl.setMove(0, 0); return { a: false, b: false }; }
    const t = target.actor;
    if (td > 1.1) { steerTo(a, t.pos.x, t.pos.z, { arrive: 0 }); return { a: false, b: false }; }
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = td || 0.01;
    a.ctrl.setMove((dx / d) * 0.35, (dz / d) * 0.35);
    return { a: false, b: a.shoveCd <= 0 && random() < 0.3 + brain.difficulty * 0.4 };
  }
}
