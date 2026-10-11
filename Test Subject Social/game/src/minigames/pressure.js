/**
 * PRESSURE TEST — push your luck at a row of pump stations.
 *
 * Rules
 *  - Every subject stands at their own station: a hand pump, a glass
 *    pressure tank and a big dial gauge. Nobody walks anywhere.
 *  - HOLD A to pump: pressure rises, a little faster the longer you keep
 *    holding (releasing resets the acceleration, so tapping is slower but safer).
 *  - PRESS B to bank: the current pressure (rounded down) is added to your
 *    score and the tank vents to zero (short lock-out while it vents).
 *  - Every tank fill has a hidden burst threshold, random 40–100, re-rolled
 *    after each bank or burst. Exceed it and the tank bursts: the unbanked
 *    pressure is lost, you are blasted back and stunned for 2 s, and you
 *    collect a strike. The third burst is fatal (gib).
 *  - Hint: the gauge needle (and the tank) trembles once the pressure is
 *    within 15 % of the threshold.
 *  - 45 s round. Unbanked pressure at the buzzer is worth nothing. The round
 *    also ends early when only one subject (or nobody) is left alive.
 *  - Ranking: living subjects by banked score, then the dead in reverse
 *    death order (base Minigame.placement()).
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Audio } from '../core/audio.js';
import { Haptics } from '../core/haptics.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow, canvasTexture } from '../core/textures.js';
import { clamp, lerp, damp } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const DURATION = 45;
const MAX_STRIKES = 3;
const STUN_TIME = 2.0;
const VENT_TIME = 0.9;
const THRESH_MIN = 40, THRESH_MAX = 100;
const SHAKE_AT = 0.85;                         // needle trembles from 85 % of the threshold
const RATE_BASE = 6, RATE_GAIN = 9, RATE_MAX = 26; // pressure units / s
const BIG_BANK = 85;                           // feed line for greedy successes
const FACING = 0.45;                           // subjects turn slightly toward their tank
const HANDLE_TOP = 1.12, STROKE = 0.2;         // pump T-handle height / stroke
const GLASS_H = 1.5;
const NEEDLE_0 = Math.PI * 0.75, NEEDLE_SPAN = Math.PI * 1.5; // 0 → lower left, 100 → lower right

export class PressureTest extends Minigame {
  static meta = {
    id: 'pressure',
    title: 'PRESSURE TEST',
    tagline: 'Every tank has a limit. So do you.',
    category: 'Timing',
    controls: [{ input: 'a', label: 'Hold to pump' }, { input: 'b', label: 'Bank pressure' }],
    objective: 'Bank the most pressure before time runs out.',
    rules: [
      'Hold {A} to pump. Pressure climbs faster the longer you hold.',
      'Press {B} to bank: the pressure joins your score and the tank vents.',
      'Each tank bursts at a hidden limit (40–100). A burst loses the fill, stuns you and costs a strike.',
      'The needle trembles near the limit. The third burst is fatal. Unbanked pressure at the buzzer is worthless.',
    ],
  };

  build() {
    const n = this.seats.length;
    this.spacing = n <= 2 ? 3.4 : 3.0;
    const width = n * this.spacing;
    const W = width + 14;
    const scene = this.makeScene({ fogNear: 14, fogFar: 42, ambientIntensity: 0.95 });
    this.makeCamera([0, 3.0, 6.0 + width * 0.42], [0, 1.3, -0.3], 45);
    const fill = new THREE.DirectionalLight(0xd8dce0, 0.6);
    fill.position.set(-2, 6, 10);
    scene.add(fill);

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._steamDrift = new THREE.Vector3(0.15, 0, 0.1);

    // Shared geometry / materials for every station.
    const liquidGeo = new THREE.CylinderGeometry(0.4, 0.4, 1, 16); liquidGeo.translate(0, 0.5, 0);
    const needleGeo = new THREE.BoxGeometry(0.035, 0.34, 0.012); needleGeo.translate(0, 0.12, 0);
    this.geo = {
      plinth: new THREE.BoxGeometry(1.1, 0.16, 1.1),
      cap: new THREE.CylinderGeometry(0.49, 0.49, 0.14, 16),
      glass: new THREE.CylinderGeometry(0.44, 0.44, GLASS_H, 16, 1, true),
      stub: new THREE.CylinderGeometry(0.44, 0.44, 0.22, 16, 1, true),
      liquid: liquidGeo,
      strut: new THREE.BoxGeometry(0.05, GLASS_H, 0.05),
      band: new THREE.TorusGeometry(0.455, 0.025, 4, 18),
      vent: new THREE.CylinderGeometry(0.05, 0.05, 0.32, 6),
      gaugeBody: new THREE.CylinderGeometry(0.42, 0.44, 0.1, 22),
      gaugeFace: new THREE.CircleGeometry(0.37, 28),
      needle: needleGeo,
      hub: new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8),
      stem: new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6),
      pumpBase: new THREE.BoxGeometry(0.4, 0.04, 0.26),
      pumpBarrel: new THREE.CylinderGeometry(0.065, 0.075, 0.64, 8),
      pumpRod: new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
      pumpHandle: new THREE.BoxGeometry(0.6, 0.05, 0.05),
      lamp: new THREE.BoxGeometry(0.22, 0.22, 0.08),
      lampCase: new THREE.BoxGeometry(0.32, 0.32, 0.06),
      shard: new THREE.BoxGeometry(0.14, 0.2, 0.015),
    };
    this.mats = {
      steel: mat(0x8a8e8a, Tex.metal()),
      dark: mat(0x2e302d, Tex.plate()),
      red: mat(0x8f2a1e, Tex.metal()),
      glass: new THREE.MeshLambertMaterial({ color: 0xcfe6e0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      shard: new THREE.MeshBasicMaterial({ color: 0xd8f0ea, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      face: new THREE.MeshBasicMaterial({ map: gaugeTexture(), color: 0xdddddd }),
      needle: glow(0xc81e14),
    };

    // Room
    floor(scene, W, 16, { tex: 'plate', tile: 2, z: 2 });
    block(scene, 0, 3, -2.35, W, 6, 0.3, mat(0xa9a89a, Tex.wall([W / 4, 1.5])));
    block(scene, 0, 0.45, -2.17, W, 0.9, 0.06, mat(0x5a4a3a, Tex.rust([W / 3, 0.5])));
    stencil(scene, 'PRESSURE TEST', -(width / 4 + 1.2), 4.3, -2.18, { w: 5.4, h: 1.6, opacity: 0.55 });
    stencil(scene, 'KNOW YOUR LIMIT', width / 4 + 1.2, 4.3, -2.18, { w: 4.6, h: 1.0, opacity: 0.8, color: '#c0402c' });
    pipe(scene, [-W / 2, 3.5, -2.0], [W / 2, 3.5, -2.0], 0.14);
    pipe(scene, [-W / 2, 3.85, -2.05], [W / 2, 3.85, -2.05], 0.08, 0x3a3f3a);
    for (let i = 0; i < n - 1; i++) hazardStrip(scene, (i + 0.5 - (n - 1) / 2) * this.spacing, 0.1, 0.22, 4.2, 0.008);

    // Two shadow-casting lamps at most.
    const lampXs = n <= 2 ? this.seats.map((_, i) => (i - (n - 1) / 2) * this.spacing) : [-width / 4, width / 4];
    for (const lx of lampXs) hangingLamp(scene, lx, 6.4, -0.2, { intensity: 85, angle: 0.95 });

    // DOM pressure readouts above each gauge.
    this.readoutRoot = document.createElement('div');
    this.readoutRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.hud.root.appendChild(this.readoutRoot);

    this.seats.forEach((seat, i) => this._buildStation(seat, i, (i - (n - 1) / 2) * this.spacing));
  }

  // ------------------------------------------------------------------ stage

  /** Pump, tank, gauge, warning lamp and subject for one seat. */
  _buildStation(seat, i, x0) {
    const scene = this.scene, G = this.geo, M = this.mats;
    const sx = x0 - 0.6, sz = 0.35, tx = x0 + 0.6, tz = -0.55;

    // Tank base (static: survives a burst)
    hazardStrip(scene, tx, tz, 1.5, 1.5, 0.006);
    scene.add(mesh(G.plinth, M.dark, tx, 0.08, tz));
    scene.add(mesh(G.cap, M.steel, tx, 0.23, tz));
    const stub = mesh(G.stub, M.glass, tx, 0.41, tz, { cast: false });
    stub.visible = false;
    scene.add(stub);

    // Tank body (swells with pressure, hidden after a burst)
    const tank = new THREE.Group();
    tank.position.set(tx, 0.3, tz);
    const liqMat = new THREE.MeshLambertMaterial({ color: 0x46d36a, emissive: 0x000000 });
    const liquid = mesh(G.liquid, liqMat, 0, 0, 0, { cast: false });
    liquid.scale.y = 0.001;
    const glass = mesh(G.glass, M.glass, 0, GLASS_H / 2, 0, { cast: false });
    glass.renderOrder = 2;
    tank.add(liquid, glass, mesh(G.cap, M.steel, 0, GLASS_H + 0.07, 0));
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      tank.add(mesh(G.strut, M.steel, Math.cos(a) * 0.47, GLASS_H / 2, Math.sin(a) * 0.47));
    }
    for (const y of [0.3, 1.2]) {
      const band = mesh(G.band, M.steel, 0, y, 0);
      band.rotation.x = Math.PI / 2;
      tank.add(band);
    }
    tank.add(mesh(G.vent, M.steel, 0.22, GLASS_H + 0.3, -0.22));
    scene.add(tank);

    // Dial gauge on a stem above the tank, tilted toward the camera.
    scene.add(mesh(G.stem, M.steel, tx, 2.02, tz + 0.05));
    const gauge = new THREE.Group();
    gauge.position.set(tx, 2.42, tz + 0.12);
    gauge.rotation.x = -0.15;
    const housing = mesh(G.gaugeBody, M.steel);
    housing.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(G.gaugeFace, M.face);
    face.position.z = 0.052;
    const needle = new THREE.Group();
    needle.position.z = 0.062;
    needle.rotation.z = NEEDLE_0;
    needle.add(new THREE.Mesh(G.needle, M.needle));
    const hub = new THREE.Mesh(G.hub, M.dark);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.072;
    gauge.add(housing, face, needle, hub);
    scene.add(gauge);

    // Warning lamp on the wall behind the station.
    pipe(scene, [tx, 0, -2.05], [tx, 3.5, -2.05], 0.07, 0x4d4a44);
    scene.add(mesh(G.lampCase, M.dark, tx - 0.55, 2.9, -2.18));
    const warnMat = glow(0x200404);
    scene.add(mesh(G.lamp, warnMat, tx - 0.55, 2.9, -2.14, { cast: false }));

    // Hand pump in front of the subject.
    const px = sx + Math.sin(FACING) * 0.55, pz = sz + Math.cos(FACING) * 0.55;
    const pump = new THREE.Group();
    pump.position.set(px, 0, pz);
    pump.rotation.y = FACING;
    pump.add(mesh(G.pumpBase, M.dark, 0, 0.02, 0));
    pump.add(mesh(G.pumpBarrel, M.red, 0, 0.36, 0));
    const rod = new THREE.Group();
    rod.add(mesh(G.pumpRod, M.steel, 0, -0.2, 0));
    rod.add(mesh(G.pumpHandle, M.dark, 0, 0, 0));
    rod.position.y = HANDLE_TOP;
    pump.add(rod);
    scene.add(pump);
    pipe(scene, [px, 0.1, pz], [tx - 0.4, 0.2, tz + 0.25], 0.035, 0x1c1c1a);

    this.spawnSubject(seat, { x: sx, z: sz, facing: FACING });

    const readout = document.createElement('div');
    readout.style.cssText = `position:absolute;transform:translate(-50%,-50%);font-family:'VT323',monospace;font-size:calc(var(--u)*3.4);line-height:1;color:${seat.player.color};text-shadow:0 0 calc(var(--u)*0.5) #000,0 0 2px #000;`;
    readout.textContent = '0';
    this.readoutRoot.appendChild(readout);

    Object.assign(seat, {
      idx: i, sx, sz, tx, tz,
      pressure: 0, vis: 0, threshold: 0, fillNo: 0, holdT: 0, rate: 0,
      pumping: false, pumpPhase: 0, down: 0,
      stun: 0, vent: 0, strikes: 0, broken: false, pop: 1, shakeK: 0,
      steamLeft: 0, steamT: 0, statusText: '', statusT: 0,
      tank, liquid, liqMat, stub, gauge, gaugeX: gauge.position.x, needle, rod, warnMat,
      readout, readoutTxt: '0',
    });
    this._rollThreshold(seat);
  }

  // -------------------------------------------------------------- mechanics

  /** New hidden burst threshold for the next fill. */
  _rollThreshold(seat) {
    seat.threshold = rand(THRESH_MIN, THRESH_MAX);
    seat.fillNo++;
  }

  /** Pump / bank / burst logic for one living seat (play state only). */
  _stepSeat(seat, dt) {
    const c = seat.ctrl;
    seat.pumping = false;
    if (seat.stun > 0) {
      seat.stun -= dt;
      seat.holdT = 0; seat.rate = 0;
      if (seat.stun <= 0) {
        // A replacement tank is bolted in.
        seat.stun = 0;
        seat.broken = false;
        seat.tank.visible = true;
        seat.stub.visible = false;
        seat.pop = 0;
        Audio.sfx('clank', { vol: 0.5 });
      }
      return;
    }
    if (seat.vent > 0) { seat.vent -= dt; seat.holdT = 0; seat.rate = 0; return; }
    if (c.bPressed && seat.pressure >= 1) { this._bank(seat); return; }
    if (c.a) {
      seat.holdT += dt;
      seat.rate = Math.min(RATE_MAX, RATE_BASE + RATE_GAIN * seat.holdT);
      seat.pressure += seat.rate * dt;
      seat.pumping = true;
      if (seat.pressure > seat.threshold) this._burst(seat);
    } else {
      seat.holdT = 0;
      seat.rate = 0;
    }
  }

  _bank(seat) {
    const amt = Math.floor(seat.pressure);
    seat.score += amt;
    seat.pressure = 0; seat.holdT = 0; seat.rate = 0; seat.pumping = false;
    seat.vent = VENT_TIME;
    seat.steamLeft = VENT_TIME; seat.steamT = 0;
    this._rollThreshold(seat);
    this._status(seat, `BANKED +${amt}`);
    Audio.sfx('puff');
    Audio.sfx('ding', { vol: 0.3 });
    Haptics.forPlayer(seat.player, 'click');
    if (amt >= BIG_BANK) this.hud.feed(`${seat.player.name} BANKED ${amt}`, seat.player.color);
  }

  _burst(seat) {
    seat.strikes++;
    seat.pressure = 0; seat.vis = 0; seat.holdT = 0; seat.rate = 0; seat.pumping = false;
    seat.broken = true;
    seat.tank.visible = false;
    seat.stub.visible = true;
    seat.steamLeft = 0;
    this._rollThreshold(seat);

    // Glass shards, spray and steam.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rand(-0.3, 0.3);
      const shard = new THREE.Mesh(this.geo.shard, this.mats.shard);
      shard.position.set(seat.tx + Math.cos(a) * 0.42, 0.45 + k * 0.17, seat.tz + Math.sin(a) * 0.42);
      shard.rotation.set(rand(0, 3), rand(0, 3), 0);
      this.fx.addBody(shard,
        new THREE.Vector3(Math.cos(a) * rand(2.5, 6), rand(3, 7), Math.sin(a) * rand(2.5, 6) + 1.2),
        new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)),
        { bleed: false, life: 5, radius: 0.06, bounce: 0.25 });
    }
    const c = this._v2.set(seat.tx, 1.1, seat.tz);
    this.fx.sparks(c, { color: 0xff6a2a, count: 14, speed: 7 });
    this.fx.sparks(c, { color: 0xd8f0ea, count: 10, speed: 5 });
    for (let k = 0; k < 4; k++) {
      this.fx.smoke(new THREE.Vector3(seat.tx + rand(-0.4, 0.4), 0.6 + k * 0.35, seat.tz + rand(-0.4, 0.4)), { color: 0xcfcfc8, size: 0.45, rise: 1.4, life: 1.5, opacity: 0.6 });
    }
    Audio.sfx('explode', { vol: 0.75 });
    this.engine.shake(0.35);

    const dir = new THREE.Vector3(seat.sx - seat.tx, 0, seat.sz - seat.tz).normalize();
    if (seat.strikes >= MAX_STRIKES) {
      this.kill(seat, 'gib', { dir, force: 1.2 });
      return;
    }
    seat.stun = STUN_TIME;
    Haptics.forPlayer(seat.player, 'hit');
    Audio.sfx('wrong', { vol: 0.4 });
    this._status(seat, 'BURST!');
    this.hud.feed(`${seat.player.name} BLEW A TANK (${seat.strikes}/${MAX_STRIKES})`, seat.player.color);
  }

  /** Round over: every remaining tank vents (unbanked pressure is lost). */
  _ventAll() {
    for (const seat of this.seats) {
      seat.pumping = false; seat.rate = 0; seat.holdT = 0;
      if (seat.alive && seat.pressure > 0) { seat.pressure = 0; seat.steamLeft = VENT_TIME; seat.steamT = 0; }
    }
  }

  _status(seat, text) { seat.statusText = text; seat.statusT = 1.0; }

  // -------------------------------------------------------------- lifecycle

  start() {
    for (const seat of this.seats) { seat.vis = 0; seat.pumping = false; seat.rate = 0; seat.pumpPhase = 0; }
    this.hud.prompt('Hold {A} to pump · {B} banks');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
  }

  preview(dt) {
    // Cosmetic demo: everyone pumps, needles wander (no game state touched).
    for (const seat of this.seats) {
      seat.vis = 24 + 18 * Math.sin(this.clock * 0.9 + seat.idx * 1.9);
      seat.pumping = true;
      seat.rate = 10;
      this._animateSeat(seat, dt);
      this._renderTank(seat, dt);
    }
    this._placeReadouts();
  }

  update(dt) {
    const playing = this.state === 'play';
    for (const seat of this.seats) {
      if (playing && seat.alive) this._stepSeat(seat, dt);
      // Displayed pressure: follows rises instantly, drains smoothly when venting.
      if (seat.vis > seat.pressure) seat.vis = Math.max(seat.pressure, seat.vis - dt * 110);
      else seat.vis = seat.pressure;
      seat.statusT = Math.max(0, seat.statusT - dt);
      this._animateSeat(seat, dt);
      this._renderTank(seat, dt);
    }
    this._placeReadouts();

    for (const seat of this.seats) {
      this.hud.setStat(seat, `BANKED ${seat.score} · STRIKES ${seat.strikes}/${MAX_STRIKES}`);
      this.hud.setStatus(seat, !seat.alive ? 'RUPTURED'
        : seat.statusT > 0 ? seat.statusText
          : seat.stun > 0 ? 'STUNNED'
            : seat.pumping ? 'PUMPING' : '');
    }
    if (!playing) return;

    this.hud.setTimer(Math.max(0, DURATION - this.time));
    const alive = this.aliveSeats.length;
    if (alive === 0 || (this.seats.length > 1 && alive === 1)) {
      this.hud.banner(alive ? 'LAST TANK STANDING' : 'TEST CONCLUDED', 2200, alive ? 'good' : 'danger');
      Audio.sfx('horn');
      this._ventAll();
      this.end(2.6);
    } else if (this.time >= DURATION) {
      this.hud.setTimer(0);
      this.hud.banner('TEST CONCLUDED', 2200);
      Audio.sfx('horn');
      this._ventAll();
      this.end(2.4);
    }
  }

  // ---------------------------------------------------------------- visuals

  /** Pumping pose, pump handle and burst knock-back for one seat. */
  _animateSeat(seat, dt) {
    if (!seat.alive) return;
    const s = seat.subject, p = s.parts;
    const stunned = seat.stun > 0;
    s.pose = stunned ? 'cower' : 'idle';
    s.animate(dt, 0);

    if (seat.pumping && !stunned) {
      const TWO_PI = Math.PI * 2;
      const before = Math.floor((seat.pumpPhase - Math.PI) / TWO_PI);
      seat.pumpPhase += dt * (4 + seat.rate * 0.3);
      const after = Math.floor((seat.pumpPhase - Math.PI) / TWO_PI);
      if (after !== before && this.state === 'play') Audio.sfx('step', { vol: 0.7 });
      seat.down = 0.5 - 0.5 * Math.cos(seat.pumpPhase);
    } else {
      seat.pumpPhase = 0;
      seat.down = lerp(seat.down, 0, damp(10, dt));
    }
    seat.rod.position.y = HANDLE_TOP - seat.down * STROKE;

    if (!stunned) {
      // Hands on the T-handle; lean into the down stroke.
      const d = seat.down;
      p.armL.rotation.x = p.armR.rotation.x = -(0.95 - 0.75 * d);
      p.armL.rotation.z = 0.16;
      p.armR.rotation.z = -0.16;
      p.torso.rotation.x = 0.4 * d;
      p.head.rotation.x = -0.25 * d;
      p.hips.position.y -= 0.04 * d;
    }

    // Burst: thrown back away from the tank, a hop, then shuffle back.
    let knock = 0, hop = 0;
    if (stunned) {
      const b = seat.stun / STUN_TIME; // 1 → 0
      const e = 1 - b;
      knock = Math.min(1, e * 6) * Math.min(1, b * 4);
      hop = e < 0.25 ? Math.sin((e / 0.25) * Math.PI) * 0.35 : 0;
    }
    const dx = seat.sx - seat.tx, dz = seat.sz - seat.tz, dl = Math.hypot(dx, dz) || 1;
    s.root.position.set(seat.sx + (dx / dl) * 0.8 * knock, hop, seat.sz + (dz / dl) * 0.8 * knock);
    s.root.rotation.z = stunned ? Math.sin(this.clock * 9) * 0.08 * knock : 0;
  }

  /** Tank swell, liquid level/colour, needle (with the near-limit tremble), steam, lamp. */
  _renderTank(seat, dt) {
    const k = clamp(seat.vis / 100, 0, 1.05);
    seat.pop = Math.min(1, seat.pop + dt * 3.2);
    const pk = seat.pop < 1 ? Math.max(0.01, easeOutBack(seat.pop)) : 1;
    const sw = 1 + 0.17 * k * k;

    const near = this.state === 'play' && seat.alive && !seat.broken && seat.vent <= 0
      && seat.pressure >= seat.threshold * SHAKE_AT;
    const close = near ? clamp((seat.pressure / seat.threshold - SHAKE_AT) / (1 - SHAKE_AT), 0, 1) : 0;
    seat.shakeK = near ? 0.35 + 0.65 * close : 0;
    const jit = near
      ? (Math.sin(this.clock * 57 + seat.idx * 2.1) * 0.7 + Math.sin(this.clock * 31.3 + seat.idx) * 0.3) * (0.07 + 0.1 * close)
      : 0;

    seat.tank.scale.set(sw * pk, (1 + 0.05 * k * k) * pk, sw * pk);
    seat.tank.rotation.z = jit * 0.05;
    seat.liquid.scale.y = Math.max(0.001, k * (GLASS_H - 0.05));
    seat.liqMat.color.setHSL(0.34 * (1 - Math.min(1, k)), 0.85, 0.48);
    seat.liqMat.emissive.copy(seat.liqMat.color).multiplyScalar(0.25 + 0.35 * k);
    seat.needle.rotation.z = NEEDLE_0 - Math.min(k, 1.03) * NEEDLE_SPAN + jit;
    seat.gauge.position.x = seat.gaugeX + jit * 0.06;

    if (seat.steamLeft > 0) {
      seat.steamLeft -= dt;
      seat.steamT -= dt;
      if (seat.steamT <= 0) {
        seat.steamT = 0.12;
        this.fx.smoke(this._v2.set(seat.tx + 0.22, 2.3, seat.tz - 0.22), { color: 0xd6d6cf, size: 0.18, rise: 1.6, life: 1.3, opacity: 0.55, drift: this._steamDrift });
      }
    }

    const lamp = !seat.alive ? 0.8 : seat.stun > 0 ? (Math.sin(this.clock * 14) > 0 ? 1 : 0.2) : 0.12;
    seat.warnMat.color.setRGB(lamp, lamp * 0.12, lamp * 0.06);
  }

  /** Project each pressure readout above its gauge. */
  _placeReadouts() {
    const v = this._v;
    for (const seat of this.seats) {
      const el = seat.readout;
      if (!seat.alive || !this.camera) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      v.set(seat.tx, 3.08, seat.tz + 0.12).project(this.camera);
      el.style.display = '';
      el.style.left = `${((v.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - v.y) / 2) * 100}%`;
      const jx = seat.shakeK > 0 ? Math.sin(this.clock * 70 + seat.idx) * (2 + seat.shakeK * 4) : 0;
      el.style.transform = `translate(calc(-50% + ${jx.toFixed(1)}px),-50%)`;
      const txt = seat.broken ? '—' : String(Math.floor(seat.vis));
      if (txt !== seat.readoutTxt) { seat.readoutTxt = txt; el.textContent = txt; }
    }
  }

  // placement(): the base implementation already ranks the living by banked
  // score (ties share a tier) and then the dead in reverse death order.

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const b = seat.brain, m = b.memory, c = seat.ctrl;
    if (seat.stun > 0 || seat.vent > 0) { c.setButtons(false, false); m.lastB = false; return; }
    if (m.fill !== seat.fillNo) this._botPlan(seat);
    if (m.wait > 0) { m.wait -= dt; c.setButtons(false, false); m.lastB = false; return; }

    const p = seat.pressure;
    let bank = p >= m.target;
    // The needle trembles: a bot that notices it banks after its reaction delay.
    if (m.notice && p >= seat.threshold * SHAKE_AT) {
      m.alarm += dt;
      if (m.alarm >= b.reaction) bank = true;
    }
    // Cash in before the buzzer.
    if (DURATION - this.time < 0.35 + b.reaction + b.difficulty * 0.6 && p >= 5) bank = true;

    if (bank && p >= 1) {
      // Tap B (press on one tick, release on the next).
      c.setButtons(false, !m.lastB);
      m.lastB = !m.lastB;
      return;
    }
    m.lastB = false;
    c.setButtons(true, false);
  }

  /** Per-fill bot plan: target pressure, greed, whether it will notice the tremble. */
  _botPlan(seat) {
    const b = seat.brain, m = b.memory, d = b.difficulty;
    m.fill = seat.fillNo;
    let target = 28 + d * 32 + rand(-6, 6) - seat.strikes * 5 * d;
    if (random() < (1 - d) * 0.4) target += rand(12, 35); // greed (mostly low difficulty)
    m.target = clamp(target, 22, 98);
    m.notice = random() < 0.15 + 0.8 * d;
    m.alarm = 0;
    m.wait = b.reaction + rand(0.1, 0.4 + (1 - d) * 1.2);
  }

  dispose() {
    if (this.readoutRoot) this.readoutRoot.remove();
    super.dispose();
  }
}

// ======================================================================
// Helpers & procedural assets
// ======================================================================

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Dial face: 0–100 over 270°, clockwise, green / yellow / red bands (cached). */
function gaugeTexture() {
  return canvasTexture('pressure-gauge', 128, (c, s) => {
    const cx = s / 2, cy = s / 2, r = s * 0.48;
    const ang = (v) => v * (Math.PI * 1.5 / 100) - Math.PI * 1.25; // canvas angle of dial value v
    c.fillStyle = '#d6cfb8';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(70,50,25,${Math.random() * 0.1})`; c.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
    c.lineWidth = s * 0.075;
    for (const [a, b, col] of [[0, 40, '#3f8f45'], [40, 75, '#c9a227'], [75, 100, '#b3261e']]) {
      c.strokeStyle = col;
      c.beginPath(); c.arc(cx, cy, r * 0.78, ang(a), ang(b)); c.stroke();
    }
    c.strokeStyle = '#1b1a17';
    for (let v = 0; v <= 100; v += 5) {
      const major = v % 20 === 0, a = ang(v);
      c.lineWidth = major ? 3 : 1.5;
      const r0 = r * (major ? 0.62 : 0.7), r1 = r * 0.9;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    c.fillStyle = '#1b1a17';
    c.font = 'bold 13px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= 100; v += 20) { const a = ang(v); c.fillText(String(v), cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45); }
    c.font = 'bold 11px monospace';
    c.fillText('PSI', cx, cy + r * 0.62);
    c.lineWidth = 4;
    c.strokeStyle = '#26241f';
    c.beginPath(); c.arc(cx, cy, r - 2, 0, Math.PI * 2); c.stroke();
  });
}
