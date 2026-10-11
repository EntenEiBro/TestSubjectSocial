/**
 * CONDEMNED FLOOR — a 12×8 grid of rotten old floor tiles (1.2 m each) laid
 * over joists above a very deep shaft.
 *
 * Rules
 *  - The tile under your feet starts cracking the moment you touch it
 *    (it rattles, sinks and darkens) and drops into the shaft 1 s after
 *    first contact. Fallen tiles leave holes for good.
 *  - Standing over a hole = you fall ('fall' death).
 *  - A = hop: ~0.45 s airborne, 1.1 s cooldown. While airborne you touch no
 *    tiles (nothing cracks, holes don't matter) — enough to clear a hole
 *    one tile wide. Land on a hole and you fall anyway.
 *  - B = shove (standard arena shove). Shove rivals into holes.
 *  - Every 15 s a few random tiles turn red and drop 1 s later. From 60 s on
 *    the floor fails every 4 s.
 *  - Last subject standing wins. Hard cap 75 s: survivors share first place.
 *  - Grace: tiles touched during the first second after GO hold for 1.4 s.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { block, stencil, mesh, pipe } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { rand, random, shuffle } from '../core/rng.js';

const COLS = 12, ROWS = 8;
const TS = 1.2;                       // tile pitch
const GAP = 0.06;                     // visual seam between tiles
const TH = 0.22;                      // tile thickness
const GW = COLS * TS, GD = ROWS * TS; // grid extents (14.4 × 9.6)
const CRACK_TIME = 1.0;               // contact → drop (0.7 burnt the whole floor in ~12 s with 4 players)
const OPENING_FUSE = 1.4;             // fuse for tiles touched in the first second
const WARN_TIME = 1.0;                // random failures: red warning time
const HOP_TIME = 0.45, HOP_CD = 1.1, HOP_H = 0.6;
const QUAKE_EVERY = 15;               // random failures early on
const LATE_AT = 60, LATE_EVERY = 4;   // ...and the final collapse
const CAP = 75;                       // hard round limit
const FALL_KILL_Y = -3;
const SPAWN_CELLS = [[2, 2], [9, 5], [9, 2], [2, 5]]; // 2 players: opposite corners
const NB8 = Object.freeze([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map((p) => Object.freeze(p)));
const NB4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]].map((p) => Object.freeze(p)));
const BOT_SLIP = 0.02;                // per tile × brain.error: misjudge the fuse (may fall)
const BOT_HOP_ERR = 0.15;             // per tile × brain.error: hop too early (may land short)
const CROWD_R = 1.8;                  // bots stop loitering when a rival is this close
const BOT_SHOVE = 0.9;                // shoves per second × difficulty when a rival has a hole behind them

/** Grimy old floor tile face, optionally with cracks. (Cosmetic: Math.random is fine here.) */
function tileTexture(base, cracks = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  const img = g.getImageData(0, 0, 64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(40,28,12,${0.08 + Math.random() * 0.14})`;
    g.beginPath(); g.arc(Math.random() * 64, Math.random() * 64, 4 + Math.random() * 12, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 61);
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.strokeRect(5.5, 5.5, 53, 53);
  // chipped corner
  g.fillStyle = 'rgba(20,16,12,0.7)';
  g.beginPath(); g.moveTo(64, 64); g.lineTo(60 - Math.random() * 8, 64); g.lineTo(64, 60 - Math.random() * 8); g.fill();
  g.strokeStyle = 'rgba(12,8,5,0.9)'; g.lineCap = 'round';
  for (let k = 0; k < cracks; k++) {
    g.lineWidth = 1 + Math.random() * 1.5;
    let x = 32 + (Math.random() - 0.5) * 14, y = 32 + (Math.random() - 0.5) * 14;
    let ang = Math.random() * Math.PI * 2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { ang += (Math.random() - 0.5) * 1.1; x += Math.cos(ang) * 6; y += Math.sin(ang) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CrumbleFloor extends Minigame {
  static meta = {
    id: 'crumble',
    title: 'CONDEMNED FLOOR',
    tagline: 'The floor is condemned. So are you.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Hop' }, { input: 'b', label: 'Shove' }],
    objective: 'Be the last subject standing.',
    rules: [
      'Every tile you stand on cracks and drops into the shaft one second later.',
      'Press {A} to hop. In the air you touch nothing and can clear a one-tile hole.',
      'Every 15 seconds the floor fails on its own. Red tiles drop after one second.',
      'Shove rivals toward the holes. Gravity handles the paperwork.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 16, fogFar: 46, floorAt: (x, z) => (this._standable(this.tileAt(x, z)) ? 0 : -Infinity) });
    this.makeCamera([0, 15, 11.2], [0, 0, 0.4], 50);

    this._textures = [];
    this._mats = [];
    this._buildShaft(scene);
    this._buildTiles(scene);

    hangingLamp(scene, -3.8, 7.6, 0.2, { intensity: 95, angle: 0.95 });
    hangingLamp(scene, 3.8, 7.6, 0.2, { intensity: 95, angle: 0.95 });
    this.flicker = hangingLamp(scene, 0, 6.6, -3.4, { intensity: 30, angle: 1.0, shadow: false, color: 0xffc890 });

    // Arena + avatars
    this.arena = new Arena({ bounds: { minX: -GW / 2, maxX: GW / 2, minZ: -GD / 2, maxZ: GD / 2 }, shoveForce: 12 });
    this.seats.forEach((seat, i) => {
      const [c, r] = SPAWN_CELLS[i];
      const t = this._cell(c, r);
      const facing = Math.atan2(-t.x, -t.z);
      this.spawnSubject(seat, { x: t.x, z: t.z, facing });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x: t.x, z: t.z }));
      seat.actor.seat = seat;
      seat.actor.facing = facing;
      seat.actor.data.hopT = 0;
      seat.actor.data.hopCd = 0;
    });
    this.arena.onShove = (att, vic) => { vic.data.lastShover = att.seat; vic.data.shovedAt = this.time; };

    this.nextQuake = QUAKE_EVERY;
    this.quakeN = 0;
    this._crackSfx = 0;
    this._dropSfx = 0;
    this._promptOn = false;
  }

  /** Shaft walls, joists, pit glow, signage. */
  _buildShaft(scene) {
    const wallMat = mat(0xffffff, Tex.wall([3, 3]));
    const rustMat = mat(0x9a9a9a, Tex.rust([3, 4]));
    block(scene, 0, -2, -GD / 2 - 0.25, GW + 1.0, 14, 0.5, wallMat);
    block(scene, -GW / 2 - 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wallMat);
    block(scene, GW / 2 + 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wallMat);
    block(scene, 0, -4.8, GD / 2 + 0.3, GW + 1.0, 9, 0.4, rustMat); // front lip below floor level

    // Rotten joists under the tile seams (visible through the holes).
    const joist = mat(0x7d6c58, Tex.wood([6, 1]));
    for (let r = 0; r <= ROWS; r++) block(scene, 0, -TH - 0.12, (r - ROWS / 2) * TS, GW, 0.2, 0.12, joist);
    for (const c of [0, 4, 8, 12]) block(scene, (c - COLS / 2) * TS, -TH - 0.34, 0, 0.14, 0.22, GD, joist);

    // The bottom is a long way down.
    const pitFloor = mesh(new THREE.PlaneGeometry(GW, GD), mat(0x221a14, Tex.rust([4, 3])), 0, -14, 0, { cast: false });
    pitFloor.rotation.x = -Math.PI / 2;
    scene.add(pitFloor);
    const pitLight = new THREE.PointLight(0xff5a1e, 26, 16, 1.4);
    pitLight.position.set(0, -9, 0);
    scene.add(pitLight);

    // Front railing + ledge trims.
    const railMat = mat(0xc9a227, Tex.hazard([6, 1]));
    block(scene, 0, 0.95, GD / 2 + 0.12, GW, 0.08, 0.08, railMat);
    const postMat = mat(0x3a3a36, Tex.metal());
    for (let x = -GW / 2; x <= GW / 2 + 0.01; x += TS * 2) block(scene, x, 0.48, GD / 2 + 0.12, 0.08, 0.95, 0.08, postMat);
    block(scene, 0, -0.1, -GD / 2 - 0.05, GW, 0.2, 0.1, mat(0xc9a227, Tex.hazard([8, 1])));

    // Signage and barricade planks.
    stencil(scene, 'CONDEMNED', 0, 3.3, -GD / 2 + 0.01, { w: 7, h: 2, opacity: 0.55, color: '#c8b48a' });
    stencil(scene, 'MAX LOAD 0 KG', -4.9, 1.3, -GD / 2 + 0.01, { w: 3.4, h: 1, opacity: 0.4 });
    stencil(scene, 'KEEP MOVING', 4.9, 1.3, -GD / 2 + 0.01, { w: 3.4, h: 1, opacity: 0.4 });
    const plank = mat(0x9a8468, Tex.wood([2, 1]));
    for (const x of [-5.2, 5.2]) {
      block(scene, x, 3.3, -GD / 2 + 0.08, 3.2, 0.32, 0.08, plank).rotation.z = 0.35;
      block(scene, x, 3.3, -GD / 2 + 0.12, 3.2, 0.32, 0.08, plank).rotation.z = -0.35;
    }
    pipe(scene, [-GW / 2 + 0.2, 5.0, -GD / 2 + 0.25], [GW / 2 - 0.2, 5.0, -GD / 2 + 0.25], 0.16);
    pipe(scene, [GW / 2 - 0.25, 5.0, -GD / 2 + 0.2], [GW / 2 - 0.25, -12, -GD / 2 + 0.2], 0.12);
  }

  /** Create the tile grid with a handful of shared materials (fresh variants, crack stages, red warning). */
  _buildTiles(scene) {
    const side = mat(0x4f493f);
    const bottom = mat(0x2a2622);
    const freshTex = ['#8d8774', '#7a8273', '#86735f'].map((b) => tileTexture(b, 0));
    const crackTex = [2, 5, 9].map((n) => tileTexture('#8d8774', n));
    this._textures.push(...freshTex, ...crackTex);
    const set = (top) => { this._mats.push(top); return [side, side, top, bottom, side, side]; };
    this._mats.push(side, bottom);
    this.freshSets = freshTex.map((t) => set(mat(0xffffff, t)));
    this.crackSets = [set(mat(0xd2c8b8, crackTex[0])), set(mat(0x9a8e7e, crackTex[1])), set(mat(0x62584c, crackTex[2]))];
    this.warnTop = mat(0xffa898, crackTex[0], { emissive: 0x6a0c06 });
    this.warnSet = set(this.warnTop);

    const geo = new THREE.BoxGeometry(TS - GAP, TH, TS - GAP);
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * TS, z = (r - (ROWS - 1) / 2) * TS;
        const variant = Math.min(2, Math.floor(random() * 3));
        const group = new THREE.Group();
        const plate = mesh(geo, this.freshSets[variant], 0, -TH / 2, 0, { cast: false });
        plate.rotation.y = Math.floor(random() * 4) * (Math.PI / 2);
        group.add(plate);
        const baseY = rand(-0.012, 0.008); // uneven old floor
        group.position.set(x, baseY, z);
        scene.add(group);
        this.grid.push({
          i: this.grid.length, c, r, x, z, baseY, group, plate, variant,
          state: 'solid', t: Infinity, dur: 1, warned: false, stage: 0,
          vy: 0, fallT: 0, spinX: 0, spinZ: 0,
        });
      }
    }
  }

  // ------------------------------------------------------------------ grid

  /** Tile under world point (x, z), or null outside the grid. */
  tileAt(x, z) {
    const c = Math.floor((x + GW / 2) / TS), r = Math.floor((z + GD / 2) / TS);
    return this._cell(c, r);
  }

  _cell(c, r) { return c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : this.grid[r * COLS + c]; }

  /** Can this tile be stood on right now (including while it cracks)? */
  _standable(t) { return !!t && t.state === 'solid'; }

  /** Untouched, unwarned tile. */
  _fresh(t) { return !!t && t.state === 'solid' && t.t === Infinity; }

  /** Point (x, z) is over a hole or a tile about to go. Outside the grid counts as safe (walls). */
  _holeAt(x, z) {
    const t = this.tileAt(x, z);
    return !!t && (t.state !== 'solid' || t.t < 0.35);
  }

  /** Tile starts its fall. */
  _drop(t) {
    t.state = 'falling';
    t.t = Infinity;
    t.vy = 0;
    t.fallT = 0;
    t.spinX = Math.sin(t.i * 12.9898) * 2.5;
    t.spinZ = Math.cos(t.i * 78.233) * 2.5;
    t.group.position.set(t.x, t.baseY, t.z);
    if (this._dropSfx <= 0) {
      this._dropSfx = 0.1;
      Audio.sfx('crunch', { vol: 0.45 });
      this.fx.smoke(new THREE.Vector3(t.x, 0.05, t.z), { color: 0x6a5f50, size: 0.35, rise: 0.4, life: 0.9, opacity: 0.45 });
    }
  }

  /** A few random fresh tiles turn red and drop after WARN_TIME. */
  _quake(count, late) {
    const pool = this.grid.filter((t) => this._fresh(t));
    for (const t of shuffle(pool).slice(0, count)) { t.warned = true; t.t = WARN_TIME; t.dur = WARN_TIME; }
    Audio.sfx('buzz');
    Audio.sfx('grind', { vol: 0.6 });
    this.engine.shake(0.2);
    this.hud.banner(late ? 'FINAL COLLAPSE' : 'SUBSIDENCE WARNING', 1200, 'danger');
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    this.hud.banner('MIND YOUR STEP', 1200);
    this.hud.prompt('{MOVE} move · {A} hop · {B} shove');
    this._promptOn = true;
  }

  preview(dt) {
    this._animateTiles(dt);
    this._flicker();
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  update(dt) {
    const playing = this.state === 'play';
    this._crackSfx -= dt;
    this._dropSfx -= dt;

    this._updateHops(dt, playing);
    this.arena.step(dt, playing);

    if (playing) {
      // Contact: grounded subjects crack the tile under their centre.
      for (const seat of this.aliveSeats) {
        const a = seat.actor;
        if (a.falling || a.data.hopT > 0) continue;
        const t = this.tileAt(a.pos.x, a.pos.z);
        if (!this._standable(t)) continue;
        const fuse = this.time < 1 ? OPENING_FUSE : CRACK_TIME;
        if (t.t === Infinity) {
          t.t = fuse; t.dur = fuse;
          if (this._crackSfx <= 0) { this._crackSfx = 0.12; Audio.sfx('snap', { vol: 0.18 }); }
        } else if (t.t > fuse) t.t = fuse;
      }
      // Fuses
      for (const t of this.grid) {
        if (t.state !== 'solid' || t.t === Infinity) continue;
        t.t -= dt;
        if (t.t <= 0) this._drop(t);
      }
    }
    this._checkFalls();
    this._animateTiles(dt);
    this._flicker();

    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (a.falling && a.y < FALL_KILL_Y) {
        this._credit(seat);
        this.kill(seat, 'fall', { dir: a.vel.clone().add(a.knock) });
      }
    }
    if (!playing) return;

    // Random floor failures.
    if (this.time >= this.nextQuake) {
      const late = this.time >= LATE_AT - 0.001;
      this._quake(late ? 4 : 3 + this.quakeN, late);
      this.quakeN++;
      this.nextQuake += late ? LATE_EVERY : QUAKE_EVERY;
    }

    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'FELL'); this.hud.setStatus(seat, ''); continue; }
      const a = seat.actor;
      this.hud.setStat(seat, a.falling ? 'FALLING' : a.data.hopT > 0 ? 'AIRBORNE' : 'STANDING');
      this.hud.setStatus(seat, !a.falling && a.data.hopT <= 0 && a.data.hopCd <= 0 ? 'HOP READY' : '');
    }
    this.hud.setTimer(Math.max(0, CAP - this.time));
    if (this._promptOn && this.time > 5) { this._promptOn = false; this.hud.prompt(null); }

    if (this.time >= CAP) { this.hud.banner('TIME UP', 1500); this.end(); return; }
    this.checkLastStanding();
  }

  /** Hop timers, arcs and take-offs (A). */
  _updateHops(dt, playing) {
    for (const seat of this.seats) {
      const a = seat.actor, d = a.data;
      if (!a.alive) continue;
      d.hopCd = Math.max(0, d.hopCd - dt);
      if (d.hopT > 0) {
        d.hopT -= dt;
        if (d.hopT <= 0) {
          d.hopT = 0;
          a.y = 0;
          seat.subject.pose = 'idle';
          Audio.sfx('step', { vol: 2 });
        } else {
          const p = 1 - d.hopT / HOP_TIME;
          a.y = 4 * HOP_H * p * (1 - p);
        }
      } else if (playing && !a.falling && a.stun <= 0 && d.hopCd <= 0 && a.ctrl.aPressed) {
        d.hopT = HOP_TIME;
        d.hopCd = HOP_CD;
        seat.subject.pose = 'armsUp';
        Audio.sfx('whoosh', { vol: 0.35 });
      }
    }
  }

  /** Grounded subjects over a hole start falling. */
  _checkFalls() {
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (a.falling || a.data.hopT > 0) continue;
      if (!this._standable(this.tileAt(a.pos.x, a.pos.z))) {
        a.falling = true;
        a.vy = 0.8;
        seat.subject.pose = 'armsUp';
        Audio.sfx('whoosh', { vol: 1.1 });
        Audio.sfx('wrong', { vol: 0.35 });
      }
    }
  }

  /** Feed line when a recent shove sent someone down. */
  _credit(seat) {
    const d = seat.actor.data, by = d.lastShover;
    if (by && by !== seat && this.time - d.shovedAt < 2.5) this.hud.feed(`${by.player.name} floored ${seat.player.name}`, by.player.color);
  }

  /** Rattle / darken cracking tiles, tumble falling ones (cosmetic, deterministic). */
  _animateTiles(dt) {
    this.warnTop.emissiveIntensity = 0.6 + Math.sin(this.clock * 14) * 0.4;
    for (const t of this.grid) {
      if (t.state === 'solid') {
        if (t.t === Infinity) continue;
        const p = Math.min(1, Math.max(0, 1 - t.t / t.dur));
        const stage = t.warned ? 4 : p < 0.34 ? 1 : p < 0.67 ? 2 : 3;
        if (stage !== t.stage) { t.stage = stage; t.plate.material = stage === 4 ? this.warnSet : this.crackSets[stage - 1]; }
        const amp = 0.012 + p * 0.05;
        const ph = this.clock * 55 + t.i * 1.37;
        t.group.position.set(t.x + Math.sin(ph) * amp, t.baseY - p * 0.07 + Math.sin(ph * 1.3) * amp * 0.5, t.z + Math.cos(ph * 0.9) * amp);
        t.group.rotation.set(Math.sin(ph * 0.7) * p * 0.06, 0, Math.cos(ph * 0.8) * p * 0.06);
      } else if (t.state === 'falling') {
        t.fallT += dt;
        t.vy -= 20 * dt;
        t.group.position.y += t.vy * dt;
        t.group.rotation.x += t.spinX * dt;
        t.group.rotation.z += t.spinZ * dt;
        if (t.group.position.y < -13 || t.fallT > 3) { t.state = 'gone'; t.group.visible = false; }
      }
    }
  }

  /** The bare bulb at the back stutters now and then. */
  _flicker() {
    const k = Math.sin(this.clock * 23) + Math.sin(this.clock * 7.3);
    this.flicker.light.intensity = k > 1.7 ? 4 : 30;
  }

  // ------------------------------------------------------------------- bots
  //
  // One step at a time. A bot stays on its current tile for as long as that is
  // safe — it leaves once the remaining fuse drops to its reaction time + the
  // time needed to get its centre off the tile + a small margin — then steps
  // (or hops) to the neighbouring fresh tile with the most uncontested fresh
  // floor behind it (Tron-style territory count), away from rivals.
  // A new plan is made the moment the bot lands on a new (now cracking) tile.

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, m = brain.memory, d = a.data;
    if (m.going === undefined) { m.step = null; m.think = 0; m.here = null; m.slip = 0; m.hopAt = 0.3; m.land = null; m.commit = 0; m.going = false; }
    let wantA = false, wantB = false;
    m.think -= dt;

    if (a.falling) { a.ctrl.setMove(0, 0); this._botButtons(a, m, false, false); return; }
    if (d.hopT > 0) {
      m.commit = 0;
      if (m.land) steerTo(a, m.land.x, m.land.z, { arrive: 0.05, slow: 0.25 });
      this._botButtons(a, m, false, false);
      return;
    }
    const here = this.tileAt(a.pos.x, a.pos.z);
    if (!this._standable(here)) { a.ctrl.setMove(0, 0); this._botButtons(a, m, false, false); return; }
    if (m.land && m.commit > 0) {
      // A hop was requested; it registers next tick. Keep running at the landing tile meanwhile.
      m.commit -= dt;
      steerTo(a, m.land.x, m.land.z, { arrive: 0, slow: 0.01 });
      this._botButtons(a, m, d.hopCd <= 0, false);
      return;
    }
    m.land = null;
    const left = here.t === Infinity ? CRACK_TIME : here.t; // time until this tile drops

    if (m.here !== here) {
      // New tile (it starts cracking now): roll this tile's rare mistakes and replan.
      m.here = here;
      m.going = false;
      m.step = null;
      m.slip = random() < brain.error * BOT_SLIP ? rand(0.15, 0.3) : 0;       // misjudges the fuse
      m.hopAt = 0.3 + rand(-0.08, 0.12);
      if (random() < brain.error * BOT_HOP_ERR) m.hopAt -= rand(0.45, 0.7);  // jumps too early
    }
    let s = m.step;
    let invalid = !s || s.from !== here || !(this._fresh(s.t) || (s.t.state === 'solid' && s.t.t > left + 0.15));
    if (!invalid && !s.hop && s.t.c !== here.c && s.t.r !== here.r
      && !(this._lasts(this._cell(s.t.c, here.r)) && this._lasts(this._cell(here.c, s.t.r)))) invalid = true;
    // A rival close by can shove us into a hole: don't loiter, move on (re-planned around them).
    let crowded = false;
    for (const o of this.arena.actors) if (o !== a && o.alive && !o.falling && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < CROWD_R) crowded = true;
    if (invalid || ((m.think <= 0 || crowded) && !m.going)) {
      this._planStep(seat, here, d.hopCd < left - 0.3);
      m.think = 0.3 + brain.reaction + rand(0, 0.2);
      s = m.step;
    }
    if (s && s.hop && (d.hopCd > Math.max(0, left - 0.25) || (crowded && d.hopCd > 0))) { this._planStep(seat, here, false); s = m.step; }

    if (!s) steerTo(a, here.x, here.z, { arrive: 0.1, slow: 0.5 });
    else {
      const w = s.t, dx = w.x - here.x, dz = w.z - here.z, len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const rel = (a.pos.x - here.x) * ux + (a.pos.z - here.z) * uz;
      const travel = (s.hop ? Math.max(0, m.hopAt - rel) : this._exitDist(a, here, ux, uz)) / a.speed + 0.12;
      const margin = brain.reaction + travel + 0.06 - m.slip;
      const off = s.hop ? 0.1 : 0.3;
      if ((left > margin && !m.going && !crowded) || (s.hop && d.hopCd > 0)) {
        // Wait near the edge we will leave by (short exit = more time on each tile). A hop
        // still on cooldown also waits here (if it cannot be ready in time we re-plan a walk above).
        steerTo(a, here.x + ux * off, here.z + uz * off, { arrive: 0.05, slow: 0.35 });
      } else {
        m.going = true; // committed: no more periodic replans until the next tile
        if (s.hop) {
          steerTo(a, w.x, w.z, { arrive: 0, slow: 0.01 });
          if (rel >= m.hopAt) { wantA = true; m.land = w; m.commit = 0.1; }
        } else steerTo(a, w.x, w.z, { arrive: 0, slow: 0.5 });
      }
    }

    // Shove a rival who has a hole behind them — only with time to spare on our own tile.
    if (!wantA && a.shoveCd <= 0 && a.stun <= 0 && left > 0.35) {
      for (const o of this.arena.actors) {
        if (o === a || !o.alive || o.falling || o.data.hopT > 0) continue;
        const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z, dd = Math.hypot(dx, dz);
        if (dd > 1.35 || dd < 0.05) continue;
        const ux = dx / dd, uz = dz / dd;
        if (!this._holeAt(o.pos.x + ux * 0.9, o.pos.z + uz * 0.9) && !this._holeAt(o.pos.x + ux * 1.7, o.pos.z + uz * 1.7)) continue;
        if (random() < brain.difficulty * BOT_SHOVE * dt) {
          a.facing = Math.atan2(dx, dz);
          a.ctrl.setMove(ux * 0.3, uz * 0.3);
          wantB = true;
          break;
        }
      }
    }
    this._botButtons(a, m, wantA, wantB);
  }

  /** Buttons are edge-triggered: alternate so repeated intents become fresh presses. */
  _botButtons(a, m, wantA, wantB) {
    a.ctrl.setButtons(wantA && !m.aPrev, wantB && !m.bPrev);
    m.aPrev = wantA && !m.aPrev;
    m.bPrev = wantB && !m.bPrev;
  }

  /** Pick the next step from `here`: a fresh neighbour (8-way, no corner cutting) or a 4-way hop two tiles out. */
  _planStep(seat, here, allowHop) {
    const a = seat.actor, brain = seat.brain, m = brain.memory;
    m.step = null;
    const rivals = this.arena.actors.filter((o) => o !== a && o.alive && !o.falling);
    const rStarts = [];
    for (const o of rivals) { const rt = this.tileAt(o.pos.x, o.pos.z); if (rt) rStarts.push(rt); }
    const rDist = this._bfs(rStarts, 0, null);
    const cands = [];
    for (const [dc, dr] of NB8) {
      const n = this._cell(here.c + dc, here.r + dr);
      if (!this._fresh(n)) continue;
      if (dc && dr && !(this._lasts(this._cell(here.c + dc, here.r)) && this._lasts(this._cell(here.c, here.r + dr)))) continue;
      cands.push({ t: n, hop: false, from: here });
    }
    if (allowHop) {
      for (const [dc, dr] of NB4) {
        const f = this._cell(here.c + dc * 2, here.r + dr * 2);
        if (this._fresh(f)) cands.push({ t: f, hop: true, from: here }); // hops leave the middle tile untouched
      }
    }
    let best = null, bs = -Infinity;
    for (const c of cands) {
      // Territory: fresh tiles we would reach before any rival (diminishing returns).
      const md = this._bfs([c.t], 1, here);
      let terr = 0;
      for (let i = 0; i < md.length; i++) {
        if (md[i] === Infinity) continue;
        if (md[i] < rDist[i]) terr += 1; else if (md[i] === rDist[i]) terr += 0.5;
      }
      let s = Math.sqrt(terr) * 3 + this._openness(c.t) * 0.6 + (c.hop ? 3 : 0);
      for (const o of rivals) {
        const dd = Math.hypot(o.pos.x - c.t.x, o.pos.z - c.t.z);
        if (dd < 3) s -= (3 - dd) * 2.5;
        const os = o.seat ? o.seat.brain.memory.step : null; // another bot's intended step
        if (os) {
          if (os.t === c.t) s -= 6;
          if (c.hop && os.hop) {
            // Two hops crossing mid-air bump into each other: avoid.
            const mx = (here.x + c.t.x) / 2, mz = (here.z + c.t.z) / 2;
            const ox = (os.from.x + os.t.x) / 2, oz = (os.from.z + os.t.z) / 2;
            if (Math.hypot(mx - ox, mz - oz) < 1.3) s -= 6;
          }
        }
      }
      s += rand(-1, 1) * brain.error * 3;
      if (s > bs) { bs = s; best = c; }
    }
    if (best) { m.step = best; return; }

    // Trapped: a standing neighbour that clearly outlasts this tile...
    let bt = here.t + 0.15, bn = null;
    for (const [dc, dr] of NB8) {
      if (dc && dr && !(this._lasts(this._cell(here.c + dc, here.r)) && this._lasts(this._cell(here.c, here.r + dr)))) continue;
      const n = this._cell(here.c + dc, here.r + dr);
      if (this._standable(n) && n.t > bt) { bt = n.t; bn = n; }
    }
    if (bn) { m.step = { t: bn, hop: false, from: here }; return; }
    // ...or a hop onto any standing tile two cells away.
    if (allowHop) {
      for (const [dc, dr] of NB4) {
        const f = this._cell(here.c + dc * 2, here.r + dr * 2);
        if (this._standable(f) && f.t > 0.7) { m.step = { t: f, hop: true, from: here }; return; }
      }
    }
  }

  /** 8-way BFS over fresh tiles from `starts` (distance d0); `block` is never entered. */
  _bfs(starts, d0, block) {
    const dist = new Float64Array(this.grid.length).fill(Infinity);
    const q = [];
    for (const t of starts) if (d0 < dist[t.i]) { dist[t.i] = d0; q.push(t); }
    for (let h = 0; h < q.length; h++) {
      const t = q[h], nd = dist[t.i] + 1;
      for (const [dc, dr] of NB8) {
        const n = this._cell(t.c + dc, t.r + dr);
        if (!n || n === block || !this._fresh(n) || dist[n.i] <= nd) continue;
        dist[n.i] = nd;
        q.push(n);
      }
    }
    return dist;
  }

  /** Fresh neighbours count up, holes and walls count down. */
  _openness(t) {
    let v = 0;
    for (const [dc, dr] of NB8) {
      const n = this._cell(t.c + dc, t.r + dr);
      if (!n) v -= 0.3;
      else if (n.state !== 'solid') v -= 1;
      else if (n.t === Infinity) v += 1;
    }
    return v;
  }

  /** Solid with enough fuse left to cut past its corner. */
  _lasts(t) { return !!t && t.state === 'solid' && t.t > 0.6; }

  /** Distance along (ux, uz) until the actor's centre leaves tile `here`. */
  _exitDist(a, here, ux, uz) {
    let best = Infinity;
    if (ux > 1e-6) best = Math.min(best, (here.x + TS / 2 - a.pos.x) / ux);
    if (ux < -1e-6) best = Math.min(best, (here.x - TS / 2 - a.pos.x) / ux);
    if (uz > 1e-6) best = Math.min(best, (here.z + TS / 2 - a.pos.z) / uz);
    if (uz < -1e-6) best = Math.min(best, (here.z - TS / 2 - a.pos.z) / uz);
    return best === Infinity ? 0.6 : Math.max(0, best);
  }

  dispose() {
    super.dispose();
    for (const t of this._textures || []) t.dispose();
    for (const m of this._mats || []) m.dispose();
  }
}
