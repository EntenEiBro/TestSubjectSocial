/**
 * THE INCINERATOR — contraband culture rides a conveyor past every subject.
 *
 * Rules
 *  - Each subject mans their own conveyor lane (left → right) with a furnace
 *    behind them. Items: framed ART and MACHINE PARTS.
 *  - Press A while an item sits in the glowing grab zone to hurl it into the
 *    furnace. Art burned: +1. Machine part burned: −1 (wrong!).
 *  - Art that slips past the grab zone: −1. Parts that pass are correct.
 *  - The belts accelerate over the 45 s shift. Every lane receives the exact
 *    same item sequence at the same moment, so the contest is fair.
 *  - At the whistle the lowest scorer(s) are "filtered" — dragged into their
 *    own furnace. Nobody burns if everyone is tied.
 */
import * as THREE from 'three';
import { Minigame, rankByScore } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow, canvasTexture } from '../core/textures.js';
import { rand, randInt, clamp, lerp, damp } from '../core/util.js';

const DURATION = 45;
const ZONE = [0.40, 0.70];          // grab zone along the belt (0..1)
const HATCH = 0.08;                 // belt fraction hidden inside each end hatch
const BELT_Y = 0.85;                // belt top surface height
const BELT_Z = 1.25;                // belt centre line (in front of the subject)
const BELT_D = 1.0;                 // belt depth
const FURN_FRONT = -1.0;            // furnace mouth plane
const FURN_W = 1.9, MOUTH_W = 1.3, MOUTH_H = 1.55;
const THROW_T = 0.42;               // item flight time into the furnace
const GRAB_COOLDOWN = 0.22;
const ITEM_SCALE = 1.2;             // belt items are drawn slightly oversized for readability
const PART_TYPES = ['gear', 'pipe', 'valve', 'piston', 'spring'];
const ART_STYLES = ['blobs', 'portrait', 'landscape', 'grid', 'swirl'];

/** Belt speed in belt-lengths per second at round time t. */
const speedAt = (t) => 0.30 + 0.0105 * Math.min(t, DURATION);
/** Mean spawn interval (seconds) at round time t. */
const intervalAt = (t) => 1.75 - 0.019 * Math.min(t, DURATION);

export class Incinerator extends Minigame {
  static meta = {
    id: 'incinerator',
    title: 'THE INCINERATOR',
    tagline: 'Culture is flammable. So are you.',
    category: 'Precision',
    controls: [{ input: 'a', label: 'Grab & burn' }],
    objective: 'Burn the art, spare the machinery, and do not finish last.',
    rules: [
      'Press {A} while an item is in your glowing zone to hurl it into the furnace.',
      'Art burned: +1. Machine part burned: −1. Art that slips past: −1.',
      'The belt speeds up. Every lane gets the same items.',
      'Lowest score at the whistle is fed to the furnace.',
    ],
  };

  build() {
    const n = this.seats.length;
    this.spacing = n <= 2 ? 6 : n === 3 ? 5.2 : 4.6;
    this.beltLen = this.spacing - 0.7;
    const width = n * this.spacing;
    const scene = this.makeScene({ fogNear: 18, fogFar: 52, ambientIntensity: 1.1 });
    // Fit every station horizontally: tan(hfov/2) ≈ 0.736 for fov 45 at 16:9.
    const dist = (width + 1.2) / (2 * 0.736 * 0.95);
    const look = new THREE.Vector3(0, 1.45, 0.1);
    const dir = new THREE.Vector3(0, Math.sin(0.4), Math.cos(0.4));
    this.makeCamera(look.clone().addScaledVector(dir, dist).toArray(), look.toArray(), 45);
    // Soft frontal fill so items on the belts read clearly.
    const fill = new THREE.DirectionalLight(0xd8d0c0, 0.9);
    fill.position.set(0, 6, 12);
    scene.add(fill);

    this._buildRoom(width);
    this.kit = buildKit();
    this.artPool = Array.from({ length: 10 }, (_, i) => paintArt(ART_STYLES[i % ART_STYLES.length]));
    // Unlit canvases: the art must stay readable however dim the hall is.
    this.artMats = this.artPool.map((tex) => new THREE.MeshBasicMaterial({ map: tex, color: 0xd8d8d8 }));

    // Shared scrolling belt texture (all belts run at the same speed).
    this.beltTex = canvasTexture('incin-belt', 32, (c, s) => {
      c.fillStyle = '#1f1e1c'; c.fillRect(0, 0, s, s);
      c.fillStyle = '#353330'; c.fillRect(0, 0, 6, s);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 40; i++) c.fillRect(Math.random() * s, Math.random() * s, 1, 1);
    }, { repeat: [8, 1] });

    this.lanes = this.seats.map((seat, i) => this._buildLane(seat, (i - (n - 1) / 2) * this.spacing));
    this.speed = speedAt(0);
    this.phase = 'play';         // 'play' | 'reckoning'
    this.schedule = this._makeSchedule();
    this.nextSpawn = 0;
    this.itemId = 0;
    this.losers = [];
  }

  // ------------------------------------------------------------------ stage

  _buildRoom(width) {
    const scene = this.scene;
    floor(scene, width + 24, 26, { tex: 'plate', tile: 2, z: 2 });
    const wallMat = mat(0xffffff, Tex.wall([(width + 24) / 4, 2]));
    block(scene, 0, 4, -2.75, width + 24, 8, 0.3, wallMat);
    stencil(scene, 'CULTURE IS FUEL', -width / 4, 5.6, -2.58, { w: 7, h: 2.2, opacity: 0.5 });
    stencil(scene, 'SPARE THE PARTS', width / 4, 5.6, -2.58, { w: 7, h: 2.2, opacity: 0.5, color: '#c9a227' });
    // Overhead duct
    pipe(scene, [-width / 2 - 6, 6.8, -2.2], [width / 2 + 6, 6.8, -2.2], 0.35, 0x3d3a34);
    hazardStrip(scene, 0, 2.15, width + 2, 0.35, 0.012);
  }

  /** Build one station: belt, hatches, grab zone, furnace and the subject. */
  _buildLane(seat, x0) {
    const scene = this.scene;
    const L = this.beltLen;
    const color = new THREE.Color(seat.player.color);
    const lane = {
      seat, x0, items: [], beltX0: x0 - L / 2,
      playerX: x0 + ((ZONE[0] + ZONE[1]) / 2 - 0.5) * L,
      cool: 0, flash: 0, burst: 0, smokeT: rand(0, 0.4), flamePhase: rand(0, 6),
    };
    lane.furnX = lane.playerX + 0.95;
    seat.lane = lane;
    seat.correct = 0; seat.decisions = 0; seat.throwT = 0; seat.statusT = 0; seat.statusText = '';

    // Belt body, legs, rollers, top surface.
    const frameMat = mat(0x4a4d48, Tex.metal());
    block(scene, x0, BELT_Y - 0.2, BELT_Z, L + 0.2, 0.36, BELT_D + 0.14, frameMat);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(scene, x0 + sx * (L / 2 - 0.2), (BELT_Y - 0.4) / 2, BELT_Z + sz * 0.4, 0.1, BELT_Y - 0.4, 0.1, frameMat);
    for (const sx of [-1, 1]) {
      const r = mesh(new THREE.CylinderGeometry(0.2, 0.2, BELT_D + 0.1, 10), mat(0x2b2b28, Tex.metal()), x0 + sx * L / 2, BELT_Y - 0.2, BELT_Z);
      r.rotation.x = Math.PI / 2; scene.add(r);
    }
    const top = mesh(new THREE.PlaneGeometry(L, BELT_D), mat(0xffffff, this.beltTex), x0, BELT_Y + 0.002, BELT_Z, { cast: false });
    top.rotation.x = -Math.PI / 2; scene.add(top);
    // Side rails
    for (const sz of [-1, 1]) block(scene, x0, BELT_Y + 0.06, BELT_Z + sz * (BELT_D / 2 + 0.04), L, 0.12, 0.06, mat(0x6a5d2c, Tex.metal()));

    // End hatches with rubber curtains (items appear / vanish inside them).
    const hatchMat = mat(0x8a8470, Tex.plate());
    const hatchW = HATCH * L + 0.12;
    for (const side of [-1, 1]) {
      const hx = x0 + side * (L / 2 - hatchW / 2 + 0.12);
      block(scene, hx, BELT_Y + 0.5, BELT_Z, hatchW, 1.0, BELT_D + 0.2, hatchMat);
      block(scene, hx, BELT_Y + 1.03, BELT_Z, hatchW + 0.06, 0.08, BELT_D + 0.26, mat(0xffffff, Tex.hazard([1, 1])));
      for (let k = 0; k < 4; k++) {
        const strip = mesh(new THREE.BoxGeometry(0.03, 0.8, 0.22), mat(0x161616), hx - side * (hatchW / 2 + 0.02), BELT_Y + 0.42, BELT_Z - 0.36 + k * 0.24);
        scene.add(strip);
      }
    }

    // Grab zone: tinted overlay + glowing cross bars.
    const zx0 = lane.beltX0 + ZONE[0] * L, zx1 = lane.beltX0 + ZONE[1] * L;
    lane.zoneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false });
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(zx1 - zx0, BELT_D), lane.zoneMat);
    zone.rotation.x = -Math.PI / 2; zone.position.set((zx0 + zx1) / 2, BELT_Y + 0.01, BELT_Z);
    scene.add(zone);
    lane.barMat = new THREE.MeshBasicMaterial({ color });
    for (const zx of [zx0, zx1]) scene.add(mesh(new THREE.BoxGeometry(0.05, 0.03, BELT_D + 0.12), lane.barMat, zx, BELT_Y + 0.13, BELT_Z, { cast: false }));
    lane.highlightMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });

    this._buildFurnace(lane, seat);

    // Station divider behind the belt.
    block(scene, x0 + this.spacing / 2, 1.5, -1.8, 0.25, 3, 1.6, mat(0xffffff, Tex.hazard([1, 2])));

    hangingLamp(scene, x0, 5.2, 1.0, { intensity: 55, angle: 0.85, target: new THREE.Vector3(x0, 0, 0.9) });

    this.spawnSubject(seat, { x: lane.playerX, z: 0.15, facing: 0 });
    lane.home = seat.subject.root.position.clone();
    return lane;
  }

  /** Brick furnace with a hollow mouth, flames, flicker light and alarm bulb. */
  _buildFurnace(lane, seat) {
    const scene = this.scene;
    const fx = lane.furnX;
    const brick = mat(0xffffff, brickTex());
    const side = (FURN_W - MOUTH_W) / 2;
    const depth = 1.4, cz = FURN_FRONT - depth / 2;
    block(scene, fx - MOUTH_W / 2 - side / 2, 1.2, cz, side, 2.4, depth, brick);
    block(scene, fx + MOUTH_W / 2 + side / 2, 1.2, cz, side, 2.4, depth, brick);
    block(scene, fx, MOUTH_H + (2.4 - MOUTH_H) / 2, cz, MOUTH_W, 2.4 - MOUTH_H, depth, brick);
    block(scene, fx, 2.55, cz, FURN_W + 0.2, 0.3, depth + 0.2, mat(0x3b3a33, Tex.plate()));
    pipe(scene, [fx, 2.6, cz], [fx, 7.5, cz], 0.28, 0x3a352f);
    // Interior: glowing back wall + coal bed.
    lane.coreMat = glow(0xff6a1a);
    const core = mesh(new THREE.PlaneGeometry(MOUTH_W, MOUTH_H), lane.coreMat, fx, MOUTH_H / 2, FURN_FRONT - depth + 0.05, { cast: false });
    scene.add(core);
    const coalMat = glow(0xc23a0a);
    for (let i = 0; i < 7; i++) scene.add(mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), coalMat, fx + rand(-0.5, 0.5), 0.06, FURN_FRONT - rand(0.3, 1.1), { cast: false }));
    // Flames
    lane.flames = [];
    const fm = [new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85 }), new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.8 })];
    for (let i = 0; i < 6; i++) {
      const f = mesh(new THREE.ConeGeometry(rand(0.12, 0.2), 0.7, 5), fm[i % 2], fx + (i / 5 - 0.5) * (MOUTH_W - 0.3), 0.35, FURN_FRONT - 0.5 - (i % 2) * 0.3, { cast: false });
      f.userData.phase = rand(0, 6); f.userData.rate = rand(9, 15);
      scene.add(f); lane.flames.push(f);
    }
    lane.light = new THREE.PointLight(0xff7a2a, 6, 7, 1.3);
    lane.light.position.set(fx, 1.0, FURN_FRONT + 0.4);
    scene.add(lane.light);
    // Alarm bulb + player-coloured label.
    lane.alarmMat = glow(0x330000);
    scene.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), lane.alarmMat, fx + FURN_W / 2 - 0.15, 2.85, FURN_FRONT - 0.2, { cast: false }));
    stencil(scene, `P${seat.player.slot + 1}`, fx, MOUTH_H + 0.42, FURN_FRONT + 0.02, { w: 0.9, h: 0.38, color: seat.player.color, opacity: 0.95 });
    lane.mouth = new THREE.Vector3(fx, 0.85, FURN_FRONT - 0.45);
  }

  /** Pre-roll the shared item sequence for the whole shift. */
  _makeSchedule() {
    const list = [];
    let t = 0.3, last = null, run = 0;
    while (t < DURATION - 0.6) {
      let kind = Math.random() < 0.56 ? 'art' : 'part';
      if (kind === last && run >= 3) kind = kind === 'art' ? 'part' : 'art';
      run = kind === last ? run + 1 : 1; last = kind;
      list.push({
        t, kind,
        variant: kind === 'art' ? randInt(0, this.artPool.length - 1) : randInt(0, PART_TYPES.length - 1),
        frame: randInt(0, 2),
      });
      t += intervalAt(t) * rand(0.8, 1.25);
    }
    return list;
  }

  // ----------------------------------------------------------------- items

  _spawnDue() {
    while (this.nextSpawn < this.schedule.length && this.time >= this.schedule[this.nextSpawn].t) {
      const spec = this.schedule[this.nextSpawn++];
      const id = this.itemId++;
      for (const lane of this.lanes) {
        const g = spec.kind === 'art' ? buildArt(this.kit, this.artMats[spec.variant], spec.frame) : buildPart(this.kit, PART_TYPES[spec.variant]);
        const hl = new THREE.Mesh(this.kit.geo.highlight, lane.highlightMat);
        hl.rotation.x = -Math.PI / 2; hl.position.y = 0.015; hl.visible = false;
        g.add(hl);
        g.scale.setScalar(ITEM_SCALE);
        this.scene.add(g);
        const it = { id, kind: spec.kind, u: (this.time - spec.t) * this.speed, g, hl, spin: g.spin || null, state: 'belt', resolved: false, fly: null };
        this._placeOnBelt(lane, it, 0);
        lane.items.push(it);
      }
    }
  }

  _placeOnBelt(lane, it, lift) {
    it.g.position.set(lane.beltX0 + it.u * this.beltLen, BELT_Y + lift, BELT_Z);
  }

  /** The item a grab would take right now (most advanced in the zone). */
  _grabbable(lane) {
    let best = null;
    for (const it of lane.items) {
      if (it.state !== 'belt' || it.resolved || it.u < ZONE[0] || it.u > ZONE[1]) continue;
      if (!best || it.u > best.u) best = it;
    }
    return best;
  }

  _grab(lane) {
    const seat = lane.seat;
    lane.cool = GRAB_COOLDOWN;
    seat.throwT = THROW_T;
    const it = this._grabbable(lane);
    if (!it) { Audio.sfx('whoosh', { vol: 0.4 }); return; }
    it.state = 'flying';
    it.resolved = true;
    it.hl.visible = false;
    it.fly = { t: 0, from: it.g.position.clone(), to: lane.mouth.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0, 0)) };
    Audio.sfx('whoosh', { vol: 0.6 });
  }

  /** An item reached the furnace: score it. */
  _incinerate(lane, it) {
    const seat = lane.seat;
    this.scene.remove(it.g);
    it.state = 'gone';
    seat.decisions++;
    lane.burst = Math.min(2, lane.burst + 1);
    this.fx.sparks(lane.mouth.clone().setY(0.6), { count: 10, color: 0xffb040 });
    for (let i = 0; i < 3; i++) this.fx.smoke(lane.mouth.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.9, 0.6)), { color: i ? 0x2a2522 : 0xff7a1a, size: 0.25, rise: 1.6, life: 1.2, opacity: 0.6 });
    Audio.sfx('burn', { vol: 0.8 });
    if (it.kind === 'art') {
      seat.score++; seat.correct++;
      this._status(seat, 'BURNED +1');
    } else {
      seat.score--;
      lane.flash = 0.7;
      Audio.sfx('buzz'); Audio.sfx('clank', { vol: 0.6 });
      this.fx.sparks(lane.mouth.clone().setY(0.9), { count: 14, color: 0xbfe4ff, speed: 8 });
      this._status(seat, 'WRONG! −1');
    }
  }

  _status(seat, text) { seat.statusText = text; seat.statusT = 0.9; }

  _updateLane(lane, dt, playing) {
    const seat = lane.seat;
    lane.cool = Math.max(0, lane.cool - dt);
    lane.flash = Math.max(0, lane.flash - dt);
    if (playing && seat.alive && lane.cool <= 0 && seat.ctrl.aPressed) this._grab(lane);

    let zoneHot = false;
    for (let i = lane.items.length - 1; i >= 0; i--) {
      const it = lane.items[i];
      if (it.state === 'belt') {
        it.u += this.speed * dt;
        const inZone = !it.resolved && it.u >= ZONE[0] && it.u <= ZONE[1];
        zoneHot = zoneHot || inZone;
        it.hl.visible = inZone;
        if (it.spin) it.spin.rotation.z -= this.speed * this.beltLen * dt / (0.37 * ITEM_SCALE);
        this._placeOnBelt(lane, it, inZone ? 0.06 + Math.sin(this.time * 18) * 0.02 : 0);
        if (playing && !it.resolved && it.u > ZONE[1]) {
          it.resolved = true;
          seat.decisions++;
          if (it.kind === 'art') {
            seat.score--;
            lane.flash = 0.45;
            Audio.sfx('wrong', { vol: 0.5 });
            this._status(seat, 'MISSED ART −1');
          } else seat.correct++;
        }
        if (it.u >= 1) { this.scene.remove(it.g); lane.items.splice(i, 1); }
      } else if (it.state === 'flying') {
        const f = it.fly;
        f.t += dt / THROW_T;
        const k = Math.min(1, f.t);
        it.g.position.lerpVectors(f.from, f.to, k);
        it.g.position.y += Math.sin(k * Math.PI) * 1.5;
        it.g.rotation.x -= dt * 9;
        it.g.rotation.z += dt * 4;
        if (k >= 1) { this._incinerate(lane, it); lane.items.splice(i, 1); }
      }
    }
    lane.zoneMat.opacity = zoneHot ? 0.38 + Math.sin(this.time * 20) * 0.08 : 0.16;
    if (lane.flash > 0) { lane.zoneMat.color.set(0xff2020); lane.zoneMat.opacity = 0.5; } else lane.zoneMat.color.set(seat.player.color);
  }

  // -------------------------------------------------------------- animation

  _animateFurnaces(dt) {
    const t = this.engine.time;
    for (const lane of this.lanes) {
      lane.burst = Math.max(0, lane.burst - dt * 1.8);
      const flick = 0.8 + Math.sin(t * 13 + lane.flamePhase) * 0.12 + Math.sin(t * 31 + lane.flamePhase * 2) * 0.08;
      lane.light.intensity = 6 * flick + lane.burst * 14;
      const red = lane.flash > 0 ? 1 : 0;
      lane.light.color.setRGB(1, 0.48 * (1 - red) + 0.05 * red, 0.16 * (1 - red));
      lane.coreMat.color.setRGB(1, 0.35 + 0.15 * flick + lane.burst * 0.2, 0.08);
      lane.alarmMat.color.set(lane.flash > 0 && Math.sin(t * 40) > 0 ? 0xff1a1a : 0x330000);
      for (const f of lane.flames) {
        const s = 0.75 + Math.sin(t * f.userData.rate + f.userData.phase) * 0.3 + lane.burst * 0.9;
        f.scale.set(1 + lane.burst * 0.4, s, 1 + lane.burst * 0.4);
        f.position.y = 0.35 * s;
      }
      lane.smokeT -= dt;
      if (lane.smokeT <= 0) {
        lane.smokeT = rand(0.25, 0.5);
        this.fx.smoke(new THREE.Vector3(lane.furnX + rand(-0.4, 0.4), MOUTH_H - 0.1, FURN_FRONT + 0.15), { color: 0x2a2724, size: 0.18, rise: 1.4, life: 1.4, opacity: 0.35, drift: new THREE.Vector3(rand(-0.1, 0.1), 0, 0.25) });
      }
    }
  }

  _animateSubjects(dt) {
    for (const seat of this.seats) {
      if (!seat.alive || seat.pulled) continue;
      const s = seat.subject, p = s.parts;
      s.animate(dt, 0);
      if (seat.throwT > 0) {
        seat.throwT = Math.max(0, seat.throwT - dt);
        const k = 1 - seat.throwT / THROW_T;
        const ax = k < 0.35 ? lerp(-0.5, -1.3, k / 0.35) : lerp(-1.3, -3.1, (k - 0.35) / 0.65);
        p.armL.rotation.x = p.armR.rotation.x = ax;
        p.torso.rotation.y = k < 0.35 ? lerp(0, -0.25, k / 0.35) : lerp(-0.25, 0.75, (k - 0.35) / 0.65);
      } else {
        p.torso.rotation.y = lerp(p.torso.rotation.y, 0, damp(8, dt));
      }
    }
  }

  // ------------------------------------------------------------------ flow

  preview(dt) {
    this.beltTex.offset.x -= this.speed * 8 * dt;
    this._animateFurnaces(dt);
    this._animateSubjects(dt);
  }

  update(dt) {
    const playing = this.state === 'play' && this.phase === 'play';
    this.speed = playing ? speedAt(this.time) : Math.max(0, this.speed - dt * 0.5);
    this.beltTex.offset.x -= this.speed * 8 * dt;
    if (playing) this._spawnDue();
    for (const lane of this.lanes) this._updateLane(lane, dt, playing);
    this._animateFurnaces(dt);
    this._animateSubjects(dt);

    for (const seat of this.seats) {
      seat.statusT = Math.max(0, seat.statusT - dt);
      const acc = seat.decisions ? Math.round((seat.correct / seat.decisions) * 100) : 100;
      this.hud.setStat(seat, seat.alive ? `SCORE ${seat.score} · ${acc}%` : 'FILTERED');
      this.hud.setStatus(seat, seat.alive && seat.statusT > 0 ? seat.statusText : '');
    }
    if (this.state !== 'play') return;
    if (this.phase === 'play') {
      this.hud.setTimer(DURATION - this.time);
      if (this.time >= DURATION) this._beginReckoning();
    } else this._updateReckoning(dt);
  }

  _beginReckoning() {
    this.phase = 'reckoning';
    this.reckonT = 0;
    this.verdict = false;
    this.hud.setTimer(0);
    Audio.sfx('horn');
    this.hud.banner('SHIFT OVER', 1400);
    for (const lane of this.lanes) for (const it of lane.items) it.hl.visible = false;
  }

  /** Wait for in-flight items to land, pick the loser(s), drag them in. */
  _updateReckoning(dt) {
    this.reckonT += dt;
    const VERDICT = 0.7, PULL_START = 1.6, PULL_DUR = 1.3;
    if (!this.verdict && this.reckonT >= VERDICT) {
      this.verdict = true;
      for (const s of this.seats) if (s.decisions >= 5 && s.correct === s.decisions) this.award(s, 'flawlessFilter');
      const scores = this.seats.map((s) => s.score);
      const min = Math.min(...scores), max = Math.max(...scores);
      this.losers = min === max ? [] : this.seats.filter((s) => s.score === min);
      if (this.losers.length) {
        this.hud.banner('FILTERING...', 1600, 'danger');
        Audio.sfx('sting');
      } else this.hud.banner('ALL SPARED', 1600, 'good');
    }
    if (!this.verdict) return;
    for (const seat of this.losers) {
      if (!seat.alive) continue;
      const k = clamp((this.reckonT - PULL_START) / PULL_DUR, 0, 1);
      if (k <= 0) continue;
      const s = seat.subject, root = s.root;
      if (!seat.pulled) { seat.pulled = true; if (s.ring) s.ring.visible = false; s.pose = 'armsUp'; Audio.sfx('grind'); }
      const e = k * k;
      root.position.lerpVectors(seat.lane.home, new THREE.Vector3(seat.lane.furnX, 0.25, FURN_FRONT - 0.15), e);
      root.rotation.x = -1.0 * e;
      root.rotation.y = Math.sin(k * 25) * 0.25 * (1 - k);
      s.animate(dt, 0);
      s.parts.armL.rotation.x += Math.sin(this.time * 30) * 0.4;
      s.parts.armR.rotation.x -= Math.sin(this.time * 30) * 0.4;
      if (k >= 1) {
        this.kill(seat, 'burn', { dir: new THREE.Vector3(0, 0, -1), force: 0.4 });
        seat.lane.burst = 2.5;
        this.fx.explosion(seat.lane.mouth.clone().setY(0.4), 0.6);
      }
    }
    const done = this.losers.every((s) => !s.alive);
    if (done && this.reckonT >= (this.losers.length ? PULL_START + PULL_DUR + 0.2 : 1.4)) this.end(2.4);
  }

  placement() { return rankByScore(this.seats); }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const ctrl = seat.ctrl, b = seat.brain, lane = seat.lane;
    ctrl.setButtons(false, false);
    if (this.phase !== 'play') return;
    for (const it of lane.items) {
      if (it.state !== 'belt' || it.resolved || it.u < HATCH) continue;
      let m = b.memory[it.id];
      if (!m) {
        // First sight: decide whether this looks like art.
        const want = it.kind === 'art' ? Math.random() < 0.72 + 0.26 * b.difficulty : Math.random() < b.error * 0.6;
        m = b.memory[it.id] = { want, at: null };
      }
      if (!m.want) continue;
      if (it.u >= ZONE[0] && m.at === null) m.at = this.time + b.reaction * rand(0.5, 1.25);
      if (m.at !== null && this.time >= m.at && it.u <= ZONE[1] && lane.cool <= 0 && this._grabbable(lane) === it) {
        ctrl.setButtons(true, false);
        m.want = false;
        break;
      }
    }
    void dt;
  }

  dispose() {
    for (const t of this.artPool || []) t.dispose();
    for (const m of this.artMats || []) m.dispose();
    if (this.kit) this.kit.dispose();
    super.dispose();
  }
}

// ======================================================================
// Procedural assets
// ======================================================================

/** Dark soot-stained brick texture for the furnaces (cached). */
function brickTex() {
  return canvasTexture('incin-brick', 64, (c, s) => {
    c.fillStyle = '#2a1d17'; c.fillRect(0, 0, s, s);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 16 + (row % 2) * 8, y = row * 8;
        const l = 22 + Math.random() * 14;
        c.fillStyle = `hsl(${10 + Math.random() * 12},45%,${l}%)`;
        c.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.1)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  }, { repeat: [1, 2] });
}

/** Paint one small "masterpiece" onto a 64×48 canvas. */
function paintArt(style) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const g = c.getContext('2d');
  const hue = randInt(0, 359);
  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`;
  switch (style) {
    case 'portrait': {
      g.fillStyle = hsl(hue, 45, 50); g.fillRect(0, 0, 64, 48);
      const vg = g.createRadialGradient(32, 18, 3, 32, 24, 38);
      vg.addColorStop(0, 'rgba(255,240,200,0.35)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg; g.fillRect(0, 0, 64, 48);
      g.fillStyle = hsl(hue + 180, 30, 14);
      g.beginPath(); g.ellipse(32, 19, 8, 10, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(32, 50, 19, 17, 0, Math.PI, Math.PI * 2); g.fill();
      g.fillStyle = hsl(hue + 30, 70, 60); g.fillRect(29, 31, 6, 4); // a brooch, very refined
      break;
    }
    case 'landscape': {
      const sky = g.createLinearGradient(0, 0, 0, 30);
      sky.addColorStop(0, hsl(hue, 60, 35)); sky.addColorStop(1, hsl(hue + 40, 70, 70));
      g.fillStyle = sky; g.fillRect(0, 0, 64, 48);
      g.fillStyle = hsl(hue + 60, 90, 75);
      g.beginPath(); g.arc(randInt(12, 52), randInt(8, 18), 6, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 3; k++) {
        g.fillStyle = hsl(hue + 120 + k * 15, 40, 40 - k * 10);
        g.beginPath(); g.moveTo(0, 48);
        const base = 24 + k * 7, amp = rand(3, 7), ph = rand(0, 6);
        for (let x = 0; x <= 64; x += 4) g.lineTo(x, base + Math.sin(x / 9 + ph) * amp);
        g.lineTo(64, 48); g.closePath(); g.fill();
      }
      break;
    }
    case 'grid': {
      g.fillStyle = '#e8e2cf'; g.fillRect(0, 0, 64, 48);
      const cols = [hsl(hue, 80, 50), hsl(hue + 120, 80, 45), hsl(hue + 220, 70, 55), '#111'];
      for (let k = 0; k < 5; k++) { g.fillStyle = cols[k % cols.length]; g.fillRect(randInt(0, 48), randInt(0, 34), randInt(8, 22), randInt(8, 18)); }
      g.fillStyle = '#111';
      for (let k = 0; k < 4; k++) { g.fillRect(randInt(4, 60), 0, 2, 48); g.fillRect(0, randInt(4, 44), 64, 2); }
      break;
    }
    case 'swirl': {
      g.fillStyle = hsl(hue, 50, 20); g.fillRect(0, 0, 64, 48);
      g.lineWidth = 3;
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = hsl(hue + k * 25, 75, 45 + k * 4);
        g.beginPath(); g.arc(32 + rand(-4, 4), 24 + rand(-3, 3), 3 + k * 3.2, rand(0, 3), rand(3.5, 6.5)); g.stroke();
      }
      break;
    }
    default: { // blobs
      g.fillStyle = hsl(hue, 30, 82); g.fillRect(0, 0, 64, 48);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = hsl(hue + rand(-90, 160), 75, rand(35, 60));
        g.beginPath(); g.ellipse(rand(6, 58), rand(6, 42), rand(4, 13), rand(3, 10), rand(0, 3), 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(rand(0, 64), rand(0, 48)); g.bezierCurveTo(rand(0, 64), rand(0, 48), rand(0, 64), rand(0, 48), rand(0, 64), rand(0, 48)); g.stroke();
    }
  }
  // Brush grain + varnish.
  for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.08)`; g.fillRect(rand(0, 64), rand(0, 48), 2, 1); }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Shared geometries + materials for belt items (disposed with the round). */
function buildKit() {
  const geo = {
    artBack: new THREE.BoxGeometry(0.78, 0.6, 0.03),
    artPlane: new THREE.PlaneGeometry(0.72, 0.54),
    frameH: new THREE.BoxGeometry(0.9, 0.08, 0.07),
    frameV: new THREE.BoxGeometry(0.08, 0.6, 0.07),
    stand: new THREE.BoxGeometry(0.55, 0.07, 0.3),
    highlight: new THREE.PlaneGeometry(1.0, 0.8),
    gearDisc: new THREE.CylinderGeometry(0.28, 0.28, 0.1, 12),
    gearTooth: new THREE.BoxGeometry(0.11, 0.11, 0.1),
    hub: new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8),
    pipeBody: new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8),
    flange: new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8),
    valveBody: new THREE.BoxGeometry(0.32, 0.26, 0.26),
    stem: new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6),
    wheel: new THREE.TorusGeometry(0.22, 0.035, 5, 10),
    spoke: new THREE.BoxGeometry(0.44, 0.03, 0.03),
    pistonBase: new THREE.CylinderGeometry(0.17, 0.17, 0.36, 8),
    rod: new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6),
    eye: new THREE.TorusGeometry(0.08, 0.03, 4, 8),
    coil: new THREE.TorusGeometry(0.16, 0.03, 4, 10),
  };
  const mats = {
    gilt: mat(0xb8913a, Tex.metal()),
    wood: mat(0x5a3a22, Tex.wood()),
    black: mat(0x1d1b19, Tex.wood()),
    standWood: mat(0x3e2a19, Tex.wood()),
    backing: mat(0x2a241c),
    steel: mat(0xc4c8c2, Tex.metal()),
    dark: mat(0x6a6e6a, Tex.metal()),
    rust: mat(0xb07048, Tex.rust()),
    red: mat(0x8a2a1c, Tex.metal()),
  };
  return {
    geo, mats, frames: [mats.gilt, mats.wood, mats.black],
    dispose() { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); },
  };
}

const kitMesh = (geo, material, x = 0, y = 0, z = 0) => mesh(geo, material, x, y, z);

/** A framed painting on a little stand, facing the camera. */
function buildArt(kit, canvasMat, frameIdx) {
  const { geo, mats } = kit;
  const g = new THREE.Group();
  g.add(kitMesh(geo.stand, mats.standWood, 0, 0.035, 0));
  const panel = new THREE.Group();
  panel.position.set(0, 0.42, -0.02);
  panel.rotation.x = -0.14;
  const fm = kit.frames[frameIdx % kit.frames.length];
  panel.add(kitMesh(geo.artBack, mats.backing, 0, 0, -0.02));
  const pic = new THREE.Mesh(geo.artPlane, canvasMat);
  pic.position.z = 0.0; panel.add(pic);
  panel.add(kitMesh(geo.frameH, fm, 0, 0.3, 0), kitMesh(geo.frameH, fm, 0, -0.3, 0));
  panel.add(kitMesh(geo.frameV, fm, -0.41, 0, 0), kitMesh(geo.frameV, fm, 0.41, 0, 0));
  g.add(panel);
  return g;
}

/** A low-poly machine part. Gears get a `spin` child so they roll along. */
function buildPart(kit, type) {
  const { geo, mats } = kit;
  const g = new THREE.Group();
  switch (type) {
    case 'gear': {
      const spin = new THREE.Group();
      spin.position.y = 0.38;
      const disc = kitMesh(geo.gearDisc, mats.steel); disc.rotation.x = Math.PI / 2; spin.add(disc);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const t = kitMesh(geo.gearTooth, mats.steel, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0);
        t.rotation.z = a; spin.add(t);
      }
      const hub = kitMesh(geo.hub, mats.dark); hub.rotation.x = Math.PI / 2; spin.add(hub);
      g.add(spin); g.spin = spin;
      break;
    }
    case 'pipe': {
      const body = kitMesh(geo.pipeBody, mats.rust, 0, 0.2, 0); body.rotation.z = Math.PI / 2; g.add(body);
      for (const sx of [-0.4, 0.4]) { const f = kitMesh(geo.flange, mats.dark, sx, 0.2, 0); f.rotation.z = Math.PI / 2; g.add(f); }
      break;
    }
    case 'valve': {
      g.add(kitMesh(geo.valveBody, mats.dark, 0, 0.13, 0));
      g.add(kitMesh(geo.stem, mats.steel, 0, 0.4, 0));
      const wheel = kitMesh(geo.wheel, mats.red, 0, 0.6, 0); wheel.rotation.x = Math.PI / 2; g.add(wheel);
      const s1 = kitMesh(geo.spoke, mats.red, 0, 0.6, 0), s2 = kitMesh(geo.spoke, mats.red, 0, 0.6, 0);
      s2.rotation.y = Math.PI / 2; g.add(s1, s2);
      break;
    }
    case 'piston': {
      g.add(kitMesh(geo.pistonBase, mats.dark, 0, 0.18, 0));
      g.add(kitMesh(geo.rod, mats.steel, 0, 0.55, 0));
      g.add(kitMesh(geo.eye, mats.steel, 0, 0.82, 0));
      break;
    }
    default: { // spring
      for (let i = 0; i < 6; i++) { const c = kitMesh(geo.coil, mats.steel, 0, 0.05 + i * 0.08, 0); c.rotation.x = Math.PI / 2; c.rotation.y = (i % 2 ? 0.12 : -0.12); g.add(c); }
    }
  }
  return g;
}
