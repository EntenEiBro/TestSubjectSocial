/**
 * SPIN CYCLE — sumo on a giant industrial turntable above a bottomless shaft.
 *
 * Rules
 *  - The disc (radius 6) spins and carries everyone standing on it around
 *    with it. An outward centrifugal drift grows with the square of the spin
 *    speed, and the spin keeps speeding up for the whole round.
 *  - Every 15 s the outermost ring of the disc breaks away (15/30/45/60 s).
 *    It flashes red and shudders for 3 s first. Whoever is still on it rides
 *    it down.
 *  - Leaving the disc = falling into the shaft ('fall' death). Shoving (B)
 *    someone off credits the shover in the feed.
 *  - Last subject standing wins. At 70 s the disc stops and every survivor
 *    shares first place. Nobody can fall once the round is over.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { mesh, stencil, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { rand, random } from '../core/rng.js';

const RADII = [6.0, 5.0, 4.1, 3.3, 2.6];   // disc radius after 0..4 ring breaks
const SEGMENTS = [14, 12, 10, 8];           // plates per breakable ring (even: alternating colours)
const BREAK_AT = [15, 30, 45, 60];          // seconds of play at which ring k breaks away
const WARN = 3;                             // seconds of flashing before a break
const CAP = 70;                             // the disc stops: survivors share the win
const DEPTH = 0.35;                         // disc thickness
const SHAFT_R = 9;                          // radius of the shaft opening
const SPAWN_R = 3.2;
const OMEGA0 = 0.45;                        // rad/s at GO
const OMEGA_RAMP = 0.013;                   // rad/s gained per second
const CENTRI = 0.55;                        // outward drift = CENTRI * omega² * r (units/s)
const EDGE_SLACK = 0.05;                    // centre this far past the rim = falling
const ARM_ANGLES = [-Math.PI / 2, Math.PI / 5, (4 * Math.PI) / 5]; // roller arms (world angle, x=cos z=sin)

export class SpinCycle extends Minigame {
  static meta = {
    id: 'spincycle',
    title: 'SPIN CYCLE',
    tagline: 'Gentle cycle not available.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Be the last subject standing.',
    rules: [
      'The turntable drags you around and flings you outward — faster and faster.',
      'Every 15 seconds the outer ring breaks away. It flashes red first.',
      'Off the edge is a long way down.',
      'Press {B} to shove rivals toward the rim.',
      'After 70 seconds the disc stops. Survivors share the win.',
    ],
  };

  build() {
    this.discR = RADII[0];
    this.omega = 0.3;
    this.armR = this.discR;  // visual: roller arms follow the rim
    this._geos = [];
    this._mats = [];
    this._tmp = new THREE.Vector3();
    const scene = this.makeScene({
      fogNear: 16, fogFar: 46,
      // Over the shaft there is no floor: debris and bodies keep falling.
      floorAt: (x, z) => (Math.hypot(x, z) <= this.discR ? 0 : -Infinity),
    });
    this.makeCamera([0, 15, 11], [0, -0.6, 0.4], 50);

    this._buildRoom(scene);
    this._buildShaft(scene);
    this._buildDisc(scene);
    this._buildArms(scene);

    hangingLamp(scene, 0, 10, 0, { intensity: 150, angle: 0.8 });
    hangingLamp(scene, -8, 8.5, -4, { intensity: 50, angle: 0.8, shadow: false });
    hangingLamp(scene, 8, 8.5, -4, { intensity: 50, angle: 0.8, shadow: false });

    // --- arena + avatars (bounds are irrelevant: the rim is handled by update())
    this.arena = new Arena({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, shoveForce: 13 });
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      const ang = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(ang) * SPAWN_R, z = Math.sin(ang) * SPAWN_R;
      const facing = Math.atan2(-x, -z);
      this.spawnSubject(seat, { x, z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = facing;
      seat.actor.seat = seat;
    });
    this.arena.onShove = (a, b) => { b.data.lastShover = a.seat; b.data.shovedAt = this.time; };

    this.breakIdx = 0;       // next ring to break
    this.warned = false;     // the next ring is currently flashing
    this.flashPhase = 0;
    this.flashOn = false;
    this.capped = false;
    this.promptOn = false;
    this.sparkT = 0;
    this.sparkN = 0;
    this.humT = 0;
  }

  // ------------------------------------------------------------------- stage

  _buildRoom(scene) {
    const deck = mesh(new THREE.RingGeometry(SHAFT_R, 40, 48, 1), this._own(mat(0xffffff, Tex.concrete([10, 10]))), 0, 0, 0, { cast: false });
    deck.rotation.x = -Math.PI / 2;
    scene.add(deck);
    const lip = mesh(new THREE.RingGeometry(SHAFT_R, SHAFT_R + 0.7, 48, 1), mat(0xffffff, Tex.hazard([10, 10])), 0, 0.01, 0, { cast: false });
    lip.rotation.x = -Math.PI / 2;
    scene.add(lip);
    const back = mesh(new THREE.PlaneGeometry(50, 14), mat(0xffffff, Tex.wall([12, 3.5])), 0, 5, -14, { cast: false });
    scene.add(back);
    stencil(scene, 'CENTRIFUGE 3', -6, 4.5, -13.9, { w: 7, h: 2.2, opacity: 0.55 });
    stencil(scene, 'DO NOT RIDE', 6, 4.5, -13.9, { w: 6, h: 2, opacity: 0.55, color: '#c9a227' });
    pipe(scene, [-25, 7.5, -13.6], [25, 7.5, -13.6], 0.3);
    pipe(scene, [-25, 6.6, -13.7], [25, 6.6, -13.7], 0.14, 0x5a3022);
    // Alarm beacon above the back wall stencil, lit while a ring is failing.
    scene.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), glow(0x5a0c06), 0, 8.4, -13.8, { cast: false }));
    this.alarm = new THREE.PointLight(0xff2a10, 0, 30, 1.2);
    this.alarm.position.set(0, 6, -8);
    scene.add(this.alarm);
  }

  _buildShaft(scene) {
    const wall = mesh(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, 40, 32, 1, true), mat(0x4a4a46, Tex.plate([16, 20]), { side: THREE.BackSide }), 0, -20, 0, { cast: false });
    scene.add(wall);
    const ribGeo = new THREE.TorusGeometry(SHAFT_R - 0.08, 0.1, 4, 40);
    const ribMat = mat(0x6e3f22, Tex.rust());
    for (const y of [-1.5, -5, -9, -14]) {
      const rib = mesh(ribGeo, ribMat, 0, y, 0, { cast: false });
      rib.rotation.x = Math.PI / 2;
      scene.add(rib);
    }
    const lampGeo = new THREE.SphereGeometry(0.13, 6, 4), lampMat = glow(0xff7a1a);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      scene.add(mesh(lampGeo, lampMat, Math.cos(a) * (SHAFT_R - 0.12), -3, Math.sin(a) * (SHAFT_R - 0.12), { cast: false }));
    }
    // Central spindle disappearing into the dark.
    scene.add(mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 10), mat(0xffffff, Tex.rust([1, 8])), 0, -DEPTH - 0.22 - 20, 0, { cast: false }));
    this.shaftLight = new THREE.PointLight(0xff5a1a, 26, 22, 1.4);
    this.shaftLight.position.set(0, -9, 0);
    scene.add(this.shaftLight);
  }

  /** The turntable: a solid core plus four breakable rings of plates. */
  _buildDisc(scene) {
    this.disc = new THREE.Group();
    scene.add(this.disc);
    const hz = mat(0xffffff, Tex.hazard([3, 3]));
    this.rings = [];
    for (let k = 0; k < 4; k++) {
      const rOut = RADII[k] - 0.03, rIn = RADII[k + 1] + 0.03, n = SEGMENTS[k];
      const half = Math.PI / n - 0.008, mid = (rIn + rOut) / 2;
      const geo = sectorGeometry(rIn, rOut, half, DEPTH);
      const stripe = new THREE.RingGeometry(rOut - 0.26, rOut - 0.04, 4, 1, -half, half * 2);
      stripe.rotateX(-Math.PI / 2);
      stripe.translate(-mid, 0.012, 0);
      this._geos.push(geo, stripe);
      const mats = [
        this._own(mat(0xb8b4aa, Tex.plate([0.5, 0.5]), { emissive: 0x000000 })),
        this._own(mat(0x8c8a84, Tex.plate([0.5, 0.5]), { emissive: 0x000000 })),
      ];
      const segs = [];
      for (let i = 0; i < n; i++) {
        const m = ((i + 0.5) / n) * Math.PI * 2;
        // rotation.y = m maps local +X to (cos m, 0, -sin m): the plate sits on that bearing.
        const seg = mesh(geo, mats[i % 2], Math.cos(m) * mid, 0, -Math.sin(m) * mid);
        seg.rotation.y = m;
        seg.add(mesh(stripe, hz, 0, 0, 0, { cast: false }));
        this.disc.add(seg);
        segs.push(seg);
      }
      this.rings.push({ segs, mats });
    }
    const rc = RADII[4] - 0.03;
    this.disc.add(mesh(new THREE.CylinderGeometry(rc, rc, DEPTH, 28), mat(0xa29e94, Tex.plate([2.5, 2.5])), 0, -DEPTH / 2, 0));
    const coreStripe = mesh(new THREE.RingGeometry(rc - 0.26, rc - 0.04, 28, 1), hz, 0, 0.012, 0, { cast: false });
    coreStripe.rotation.x = -Math.PI / 2;
    this.disc.add(coreStripe);
    const dark = mat(0x2e2f2c, Tex.metal());
    this.disc.add(mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.08, 12), dark, 0, 0.04, 0));
    const boltGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.disc.add(mesh(boltGeo, mat(0x8a8a82), Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55, { cast: false }));
    }
    // Underside cross-struts (visible through the seams and once rings fall away).
    const strutGeo = new THREE.BoxGeometry(rc * 2 - 0.4, 0.22, 0.25);
    for (let i = 0; i < 3; i++) {
      const s = mesh(strutGeo, dark, 0, -DEPTH - 0.11, 0, { cast: false });
      s.rotation.y = (i / 3) * Math.PI;
      this.disc.add(s);
    }
  }

  /** Static roller arms that grind against the rim (and throw the sparks). */
  _buildArms(scene) {
    this.arms = [];
    const armMat = mat(0x6b5a3a, Tex.rust()), wheelMat = mat(0x2c2d2b, Tex.metal());
    const beamGeo = new THREE.BoxGeometry(1, 0.22, 0.35);
    const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 10);
    const footGeo = new THREE.BoxGeometry(0.6, 0.9, 0.9);
    for (const a of ARM_ANGLES) {
      const g = new THREE.Group();
      g.rotation.y = -a; // local +X → (cos a, 0, sin a)
      const beam = mesh(beamGeo, armMat, 0, -0.17, 0);
      const wheel = mesh(wheelGeo, wheelMat, 0, -0.17, 0);
      g.add(beam, wheel, mesh(footGeo, armMat, SHAFT_R - 0.25, -0.5, 0));
      scene.add(g);
      this.arms.push({ a, beam, wheel });
    }
    this._placeArms(0);
  }

  _own(m) { this._mats.push(m); return m; }

  // --------------------------------------------------------------- lifecycle

  start() {
    this.omega = OMEGA0;
    this.hud.banner('SPIN UP', 1200);
    this.hud.prompt('{MOVE} fight the spin · {B} shove');
    this.promptOn = true;
    Audio.sfx('grind', { vol: 0.5 });
  }

  preview(dt) {
    this.disc.rotation.y += dt * this.omega;
    for (const s of this.seats) s.subject.animate(dt, 0);
    this._animate(dt, false);
  }

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);

    if (playing) this.omega = OMEGA0 + OMEGA_RAMP * this.time;
    else this.omega = Math.max(0, this.omega - dt * (this.capped ? 0.8 : 0.3));

    if (playing) this._updateRings(dt);
    else if (this.warned) this._clearWarning();

    // The disc carries everyone standing on it; while playing it also flings them outward.
    const ang = this.omega * dt, c = Math.cos(ang), s = Math.sin(ang);
    this.disc.rotation.y += ang;
    const fling = playing ? 1 + CENTRI * this.omega * this.omega * dt : 1;
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor;
      if (a.falling) {
        if (a.y < -3) this._fallKill(seat);
        continue;
      }
      const x = a.pos.x, z = a.pos.z;
      a.pos.x = (x * c + z * s) * fling;
      a.pos.z = (-x * s + z * c) * fling;
      a.facing = (a.facing + ang) % (Math.PI * 2);
      const r = Math.hypot(a.pos.x, a.pos.z);
      if (playing) {
        if (r > this.discR + EDGE_SLACK) this._startFall(seat, r);
      } else if (r > this.discR - 0.3) {
        // Round over: nobody leaves the disc any more.
        const k = (this.discR - 0.3) / r;
        a.pos.x *= k; a.pos.z *= k;
      }
      a.subject.root.position.x = a.pos.x;
      a.subject.root.position.z = a.pos.z;
    }

    this._animate(dt, true);
    if (this.promptOn && (!playing || this.time > 5)) { this.promptOn = false; this.hud.prompt(null); }
    if (!playing) return;

    // HUD
    const doomR = this.warned ? RADII[this.breakIdx + 1] : Infinity;
    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'SPUN OUT'); this.hud.setStatus(seat, ''); continue; }
      const a = seat.actor;
      if (a.falling) { this.hud.setStat(seat, 'SLIPPING'); this.hud.setStatus(seat, ''); continue; }
      const r = Math.hypot(a.pos.x, a.pos.z);
      this.hud.setStat(seat, 'ON DISC');
      this.hud.setStatus(seat, r > doomR - 0.1 ? 'GET OFF THE RING' : r > this.discR - 0.9 ? 'NEAR EDGE' : '');
    }
    this.hud.setTimer(Math.max(0, CAP - this.time));

    if (this.time >= CAP) {
      this.capped = true;
      this.hud.banner('DISC STOPPED', 2000);
      Audio.sfx('horn');
      this.end(3);
      return;
    }
    // Wait for anyone mid-fall to reach the bottom before judging.
    if (!this.aliveSeats.some((st) => st.actor.falling)) this.checkLastStanding();
  }

  // ------------------------------------------------------------------- rings

  _updateRings(dt) {
    if (this.breakIdx >= BREAK_AT.length) return;
    const k = this.breakIdx;
    const left = BREAK_AT[k] - this.time;
    if (left > WARN) return;
    if (!this.warned) {
      this.warned = true;
      this.flashPhase = 0;
      this.hud.banner('OUTER RING FAILING', 1500, 'danger');
      Audio.sfx('buzz');
    }
    // Flash faster as the break approaches; the plates shudder in time.
    this.flashPhase += dt * (2 + (WARN - left) * 2.5);
    const on = (this.flashPhase % 1) < 0.5;
    if (on && !this.flashOn) Audio.sfx('beep', { vol: 0.5 });
    this.flashOn = on;
    const R = this.rings[k];
    for (const m of R.mats) m.emissive.setHex(on ? 0x8a1000 : 0x000000);
    for (const seg of R.segs) seg.position.y = on ? -0.035 : 0;
    this.alarm.intensity = on ? 40 : 0;
    if (left <= 0) this._breakRing(k);
  }

  _clearWarning() {
    const R = this.rings[this.breakIdx];
    if (R) {
      for (const m of R.mats) m.emissive.setHex(0x000000);
      for (const seg of R.segs) seg.position.y = 0;
    }
    this.alarm.intensity = 0;
    this.warned = false;
    this.flashOn = false;
  }

  /** Ring k tears loose: its plates tumble into the shaft, the rim moves in. */
  _breakRing(k) {
    const R = this.rings[k];
    this.discR = RADII[k + 1];
    this.breakIdx++;
    this.warned = false;
    this.flashOn = false;
    this.alarm.intensity = 0;
    for (const m of R.mats) m.emissive.setHex(0x5a1200); // still glowing as they fall
    const w = this.omega, p = this._tmp;
    R.segs.forEach((seg, i) => {
      seg.position.y = 0;
      seg.getWorldPosition(p);
      const r = Math.hypot(p.x, p.z) || 1, ox = p.x / r, oz = p.z / r, out = rand(0.5, 1.8);
      // Outward kick plus the disc's own tangential speed at that point.
      const vel = new THREE.Vector3(ox * out + w * p.z, rand(-0.5, 1.5), oz * out - w * p.x);
      const spin = new THREE.Vector3(rand(-2.5, 2.5), rand(-1, 1), rand(-2.5, 2.5));
      this.fx.addBody(seg, vel, spin, { life: 4, bounce: 0.1, bleed: false, radius: 0.3 });
      if (i % 2 === 0) { p.y = 0.1; this.fx.sparks(p, { count: 6, speed: 5 }); }
    });
    R.segs.length = 0;
    Audio.sfx('crunch');
    Audio.sfx('metal');
    Audio.sfx('explode', { vol: 0.35 });
    this.engine.shake(0.45);
    this.hud.banner(this.breakIdx >= BREAK_AT.length ? 'CORE ONLY' : 'RING LOST', 1300, 'danger');
  }

  // ------------------------------------------------------------------- falls

  _startFall(seat, r) {
    const a = seat.actor;
    a.falling = true;
    a.vy = 1.2;
    a.knock.x += (a.pos.x / r) * 1.5;
    a.knock.z += (a.pos.z / r) * 1.5;
    a.subject.pose = 'armsUp';
    const by = a.data.lastShover;
    a.data.creditBy = by && by !== seat && this.time - (a.data.shovedAt ?? -9) < 2 ? by : null;
    Audio.sfx('whoosh', { vol: 1.1 });
  }

  _fallKill(seat) {
    const a = seat.actor, by = a.data.creditBy;
    const dir = new THREE.Vector3(a.pos.x, 0, a.pos.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    if (by) this.hud.feed(`${by.player.name} sent ${seat.player.name} down the shaft`, by.player.color);
    this.kill(seat, 'fall', { dir, quiet: !!by });
  }

  // ---------------------------------------------------------------- cosmetics

  _placeArms(dt) {
    this.armR += (this.discR - this.armR) * Math.min(1, dt * 3);
    const inner = this.armR + 0.25;
    for (const arm of this.arms) {
      arm.beam.scale.x = SHAFT_R - inner;
      arm.beam.position.x = (SHAFT_R + inner) / 2;
      arm.wheel.position.x = inner;
      arm.wheel.rotation.y -= (this.omega * dt * this.armR) / 0.25;
    }
  }

  /** Purely visual: roller arms, rim sparks, shaft glow, motor hum. */
  _animate(dt, sound) {
    this._placeArms(dt);
    if (this.omega > 0.2) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.25 / this.omega;
        const arm = this.arms[this.sparkN++ % this.arms.length];
        this._tmp.set(Math.cos(arm.a) * this.discR, 0.02, Math.sin(arm.a) * this.discR);
        this.fx.sparks(this._tmp, { count: 4, speed: 4 });
      }
      if (sound) {
        this.humT -= dt;
        if (this.humT <= 0) { this.humT = 2.4; Audio.sfx('grind', { vol: 0.12 + this.omega * 0.12 }); }
      }
    }
    this.shaftLight.intensity = 26 + Math.sin(this.clock * 2.3) * 4;
  }

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    if (a.falling) { a.ctrl.setMove(0, 0); a.ctrl.setButtons(false, false); return; }
    const skill = brain.difficulty;
    const myR = Math.hypot(a.pos.x, a.pos.z);
    // The rim the bot plans around: once it notices a warning, the doomed ring no longer counts.
    let safeR = this.discR;
    if (this.warned && this.time >= BREAK_AT[this.breakIdx] - WARN + brain.reaction * 2.5) safeR = RADII[this.breakIdx + 1];

    mem.think = (mem.think ?? 0) - dt;
    if (mem.think <= 0) {
      mem.think = brain.reaction + rand(0.15, 0.4);
      mem.lazy = random() < brain.error;                  // forgets to lean against the spin
      mem.homeR = safeR * rand(0.05, 0.18 + (1 - skill) * 0.3);
      mem.homeA = rand(0, Math.PI * 2);
      // Prey: a nearby rival who is further out than we are.
      mem.prey = null;
      let best = -Infinity;
      for (const o of this.seats) {
        if (o === seat || !o.alive || o.actor.falling) continue;
        const t = o.actor;
        const tr = Math.hypot(t.pos.x, t.pos.z), d = Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
        if (tr < myR + 0.3 || d > 2.5 + skill * 1.5) continue;
        const score = tr - d * 0.5;
        if (score > best) { best = score; mem.prey = o; }
      }
      if (mem.prey && random() > 0.3 + skill * 0.6) mem.prey = null;
    }

    let tx, tz, rush = false, wantB = false;
    const margin = 0.6 + skill * 0.9;
    const prey = mem.prey && mem.prey.alive && !mem.prey.actor.falling ? mem.prey.actor : null;
    if (myR > safeR - margin) {
      tx = 0; tz = 0; rush = true;                         // too close to the rim: back to the hub
    } else if (prey) {
      const pr = Math.hypot(prey.pos.x, prey.pos.z) || 1e-3;
      const ox = prey.pos.x / pr, oz = prey.pos.z / pr;
      const dx = prey.pos.x - a.pos.x, dz = prey.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1e-3;
      // Get on the inside of the prey, then drive into them and shove outward.
      const px = prey.pos.x - ox * 0.85, pz = prey.pos.z - oz * 0.85;
      if (d < 1.3 || Math.hypot(px - a.pos.x, pz - a.pos.z) < 0.45) {
        tx = prey.pos.x; tz = prey.pos.z; rush = true;
        const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
        const facingIt = (fx * dx + fz * dz) / d > 0.6;
        const outward = (dx * ox + dz * oz) / d > 0.2;
        if (d < 1.45 && facingIt && outward && a.shoveCd <= 0 && random() < 0.25 + skill * 0.5) wantB = true;
      } else { tx = px; tz = pz; }
    } else {
      tx = Math.cos(mem.homeA) * mem.homeR;
      tz = Math.sin(mem.homeA) * mem.homeR;
    }

    let vx = (tx - a.pos.x) * 2.5, vz = (tz - a.pos.z) * 2.5;
    if (rush) { const l = Math.hypot(vx, vz) || 1; vx = (vx / l) * a.speed; vz = (vz / l) * a.speed; }
    // Counter the disc: carry velocity (ω·z, −ω·x) plus centrifugal drift CENTRI·ω²·(x, z).
    const w = this.omega, f = CENTRI * w * w, comp = mem.lazy ? 0.15 : 0.45 + 0.55 * skill;
    vx -= (w * a.pos.z + f * a.pos.x) * comp;
    vz -= (-w * a.pos.x + f * a.pos.z) * comp;
    let mx = vx / a.speed, mz = vz / a.speed;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; } else if (l < 0.06) { mx = 0; mz = 0; }
    a.ctrl.setMove(mx, mz);
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    const press = wantB && !mem.bPrev;
    a.ctrl.setButtons(false, press);
    mem.bPrev = press;
  }

  dispose() {
    super.dispose();
    // Plates that fell into the shaft left the scene graph; free them here.
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
  }
}

/**
 * Annular sector plate (top face at y=0, thickness `depth`), centred on bearing
 * 0 and translated so the mid-radius point is the origin. Shape angle a maps to
 * the XZ direction (cos a, −sin a), matching Object3D.rotation.y.
 */
function sectorGeometry(rIn, rOut, half, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(-half) * rOut, Math.sin(-half) * rOut);
  shape.absarc(0, 0, rOut, -half, half, false);
  shape.lineTo(Math.cos(half) * rIn, Math.sin(half) * rIn);
  shape.absarc(0, 0, rIn, half, -half, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(-(rIn + rOut) / 2, -depth, 0);
  return g;
}
