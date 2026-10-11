/**
 * SYMBOL FLOOR — an 8×6 grid of piston-mounted floor plates hangs over a
 * bottomless shaft. Every plate glows with one of four symbols.
 *
 * Rules:
 *   - Wall monitors announce a doomed symbol and count down (4s, shrinking to
 *     1.8s as the round goes on). On the horn every remaining plate showing
 *     that symbol tips over and drops into the pit — gone for good.
 *   - Anyone whose centre is over a missing plate falls and dies.
 *   - Every second cycle the surviving plates are reassigned new symbols.
 *   - Diagonal movement is allowed; B shoves rivals (ideally onto doomed plates).
 *   - Last subject standing wins. After 90s the floor collapses randomly.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { block, stencil, mesh, monitor, drawSymbol, pipe } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { lerp, clamp, rand as crand } from '../core/util.js';
import { rand, pick, shuffle, random } from '../core/rng.js';

const COLS = 8, ROWS = 6;
const TS = 1.6;                      // tile pitch (centre to centre)
const GAP = 0.1;                     // visual gap between plates
const TH = 0.3;                      // plate thickness
const GW = COLS * TS, GD = ROWS * TS; // grid extents
const SYMBOLS = ['X', 'O', 'S', 'T'];
const SYMBOL_NAMES = { X: 'CROSS', O: 'CIRCLE', S: 'SQUARE', T: 'TRIANGLE' };
const SHUDDER = 0.35;                // seconds a doomed plate rattles before it goes
const COLLAPSE_AT = 90;              // seconds until the floor starts failing at random
const HARD_CAP = 125;                // absolute round limit (safety net)

/** Draw the grimy metal face of a plate with a symbol painted on top. */
function plateCanvas(sym, color, emissiveOnly) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (emissiveOnly) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 128, 128);
  } else {
    ctx.fillStyle = '#41443f'; ctx.fillRect(0, 0, 128, 128);
    const img = ctx.getImageData(0, 0, 128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 124, 124);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.strokeRect(7, 7, 114, 114);
    ctx.fillStyle = '#23251f';
    for (const [x, y] of [[12, 12], [116, 12], [12, 116], [116, 116]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
    for (let i = 0; i < 6; i++) { ctx.fillStyle = `rgba(90,50,20,${crand(0.1, 0.25)})`; ctx.beginPath(); ctx.arc(crand(0, 128), crand(0, 128), crand(6, 20), 0, 7); ctx.fill(); }
  }
  drawSymbol(ctx, sym, 64, 64, 34, color, 11);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SymbolFloor extends Minigame {
  static meta = {
    id: 'symbolfloor',
    title: 'SYMBOL FLOOR',
    tagline: 'Literacy is a load-bearing skill.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Stay on solid floor longer than everyone else.',
    rules: [
      'The monitors name a symbol. When the horn sounds, every plate with that symbol drops.',
      'Stand over a missing plate and you fall. The shaft has no bottom worth mentioning.',
      'Plates swap symbols every few cycles. Shove rivals onto the doomed ones.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 16, fogFar: 42, floorAt: (x, z) => (this._present(this.tileAt(x, z)) ? 0 : -Infinity) });
    this.makeCamera([0, 14.2, 10.6], [0, 0, 0.35], 50);

    this._buildShaft(scene);
    this._buildTiles(scene);

    // Wall monitors announcing the doomed symbol.
    // Tilted down toward the camera (negative rotX turns the screen face upward).
    this.monitors = [-4.3, 0, 4.3].map((x) => monitor(scene, x, 2.0, -GD / 2 + 0.25, { w: 2.4, h: 1.8, rotX: -0.5 }));
    this._screenKey = '';

    hangingLamp(scene, -3.5, 7.5, 0.4, { intensity: 95, angle: 0.95 });
    hangingLamp(scene, 3.5, 7.5, 0.4, { intensity: 95, angle: 0.95 });

    // Arena + avatars on four interior plates.
    this.arena = new Arena({ bounds: { minX: -GW / 2, maxX: GW / 2, minZ: -GD / 2, maxZ: GD / 2 }, shoveForce: 12.5 });
    const cells = [[2, 1], [5, 1], [2, 4], [5, 4]];
    this.seats.forEach((seat, i) => {
      const t = this.grid[cells[i][1] * COLS + cells[i][0]];
      this.spawnSubject(seat, { x: t.x, z: t.z });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x: t.x, z: t.z }));
      seat.actor.seat = seat;
    });

    this.phase = 'idle';     // 'idle' | 'calm' | 'announce' | 'drop' | 'collapse'
    this.phaseT = 0;         // time left in the current phase
    this.phaseLen = 1;       // total length of the current phase
    this.doomed = null;      // symbol currently announced
    this.cycle = 0;
    this.collapseT = 0;
    this._lastTick = -1;
  }

  /** Shaft walls, pit floor, railings and grime. */
  _buildShaft(scene) {
    const wallMat = mat(0xffffff, Tex.wall([3, 3]));
    const rustMat = mat(0x9a9a9a, Tex.rust([3, 4]));
    // Walls run from the pit bottom up past the floor level.
    block(scene, 0, -2, -GD / 2 - 0.25, GW + 1.0, 14, 0.5, wallMat);
    block(scene, -GW / 2 - 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wallMat);
    block(scene, GW / 2 + 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wallMat);
    block(scene, 0, -4.8, GD / 2 + 0.3, GW + 1.0, 9, 0.4, rustMat); // front lip below floor level
    // Pit floor far below with a sullen red glow and some spikes.
    const pitFloor = mesh(new THREE.PlaneGeometry(GW, GD), mat(0x2a1d16, Tex.rust([4, 3])), 0, -9, 0, { cast: false });
    pitFloor.rotation.x = -Math.PI / 2;
    scene.add(pitFloor);
    const spikeGeo = new THREE.ConeGeometry(0.18, 1.1, 4);
    const spikeMat = mat(0x6b6d68, Tex.metal());
    for (let i = 0; i < 40; i++) scene.add(mesh(spikeGeo, spikeMat, rand(-GW / 2 + 0.4, GW / 2 - 0.4), -8.5, rand(-GD / 2 + 0.4, GD / 2 - 0.4)));
    const pitLight = new THREE.PointLight(0xff3a18, 40, 16, 1.4);
    pitLight.position.set(0, -5, 0);
    scene.add(pitLight);
    this.pitLight = pitLight;
    // Front railing (the invisible boundary needs an excuse).
    const railMat = mat(0xc9a227, Tex.hazard([6, 1]));
    block(scene, 0, 0.95, GD / 2 + 0.12, GW, 0.08, 0.08, railMat);
    for (let x = -GW / 2; x <= GW / 2 + 0.01; x += TS * 2) block(scene, x, 0.48, GD / 2 + 0.12, 0.08, 0.95, 0.08, mat(0x3a3a36, Tex.metal()));
    // Ledge trims along the walls at floor level.
    block(scene, 0, -0.1, -GD / 2 - 0.05, GW, 0.2, 0.1, mat(0xc9a227, Tex.hazard([8, 1])));
    stencil(scene, 'READ THE FLOOR', 0, 4.0, -GD / 2 + 0.01, { w: 7, h: 1.8, opacity: 0.45 });
    pipe(scene, [-GW / 2 + 0.2, 5.2, -GD / 2 + 0.25], [GW / 2 - 0.2, 5.2, -GD / 2 + 0.25], 0.16);
    pipe(scene, [-GW / 2 + 0.25, 5.2, -GD / 2 + 0.2], [-GW / 2 + 0.25, -9, -GD / 2 + 0.2], 0.12);
  }

  /** Create the plate grid with four shared symbol materials (+ red "doomed" variants). */
  _buildTiles(scene) {
    this._textures = [];
    const side = mat(0x8a8d88, Tex.metal());
    const bottom = mat(0x2a2a28);
    const makeSet = (sym, color, emissive) => {
      const map = plateCanvas(sym, color, false), em = plateCanvas(sym, color, true);
      this._textures.push(map, em);
      const top = new THREE.MeshLambertMaterial({ map, emissive, emissiveMap: em, emissiveIntensity: 1 });
      return { top, mats: [side, side, top, bottom, side, side] };
    };
    this.symMats = {};
    this.doomMats = {};
    for (const s of SYMBOLS) {
      this.symMats[s] = makeSet(s, '#39ff5a', 0xffffff);
      this.doomMats[s] = makeSet(s, '#ff3a26', 0xffffff);
    }
    const plateGeo = new THREE.BoxGeometry(TS - GAP, TH, TS - GAP);
    const pistonGeo = new THREE.CylinderGeometry(0.16, 0.16, 6, 6);
    const pistonMat = mat(0x6e706a, Tex.metal());
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * TS, z = (r - (ROWS - 1) / 2) * TS;
        const group = new THREE.Group();
        const sym = pick(SYMBOLS);
        const plate = mesh(plateGeo, this.symMats[sym].mats, 0, -TH / 2, 0);
        const piston = mesh(pistonGeo, pistonMat, 0, -TH - 3, 0, { cast: false });
        group.add(plate, piston);
        group.position.set(x, 0, z);
        scene.add(group);
        this.grid.push({ c, r, x, z, sym, group, plate, state: 'up', t: 0, vy: 0, spin: new THREE.Vector3() });
      }
    }
  }

  // ------------------------------------------------------------------ grid

  /** Plate under world point (x, z), or null outside the grid. */
  tileAt(x, z) {
    const c = Math.floor((x + GW / 2) / TS), r = Math.floor((z + GD / 2) / TS);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return this.grid[r * COLS + c];
  }

  /** True while a plate can still be stood on (including while it rattles). */
  _present(t) { return !!t && (t.state === 'up' || t.state === 'shudder'); }

  get solidTiles() { return this.grid.filter((t) => t.state === 'up'); }

  _setSym(t, sym) { t.sym = sym; t.plate.material = this.symMats[sym].mats; }

  /** Begin dropping a plate: it rattles red for SHUDDER seconds, then falls. */
  _doom(t) {
    if (t.state !== 'up') return;
    t.state = 'shudder';
    t.t = SHUDDER;
    t.plate.material = this.doomMats[t.sym].mats;
  }

  /** Reassign symbols to all solid plates (guaranteeing at least two kinds). */
  _reshuffle() {
    const tiles = this.solidTiles;
    if (!tiles.length) return;
    for (const t of tiles) this._setSym(t, pick(SYMBOLS));
    if (tiles.length >= 2 && new Set(tiles.map((t) => t.sym)).size < 2) {
      const [a, b] = shuffle(SYMBOLS);
      tiles.forEach((t, i) => this._setSym(t, i % 2 ? a : b));
    }
    Audio.sfx('select', { vol: 0.6 });
    this.hud.banner('SYMBOLS REASSIGNED', 900);
  }

  /** Choose the next doomed symbol: one that exists but never wipes the whole floor. */
  _pickDoomed() {
    let tiles = this.solidTiles;
    const counts = () => { const m = {}; for (const t of tiles) m[t.sym] = (m[t.sym] || 0) + 1; return m; };
    let cnt = counts();
    let options = SYMBOLS.filter((s) => cnt[s] && cnt[s] < tiles.length);
    if (!options.length && tiles.length >= 2) { this._reshuffle(); tiles = this.solidTiles; cnt = counts(); options = SYMBOLS.filter((s) => cnt[s] && cnt[s] < tiles.length); }
    if (!options.length) return pick(SYMBOLS.filter((s) => !cnt[s])) || pick(SYMBOLS);
    return pick(options);
  }

  // ------------------------------------------------------------- lifecycle

  start() { this._enter('calm', 1.4); }

  _enter(phase, len) { this.phase = phase; this.phaseT = len; this.phaseLen = len; }

  /** 0 → 1 difficulty ramp over the first 60 seconds. */
  get ramp() { return clamp(this.time / 60, 0, 1); }

  preview(dt) {
    this._animateTiles(dt);
    this._drawScreens();
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  update(dt) {
    const playing = this.state === 'play';
    this._animateTiles(dt);
    this.arena.step(dt, playing);
    if (playing) this._runCycle(dt);
    this._drawScreens();

    // Falling: anyone whose centre is over a missing plate drops (also during 'over').
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (!a.falling && !this._present(this.tileAt(a.pos.x, a.pos.z))) {
        a.falling = true;
        a.vy = 1.5;
        seat.subject.pose = 'armsUp';
        Audio.sfx('whoosh', { vol: 1.2 });
        Audio.sfx('wrong', { vol: 0.4 });
      }
      if (a.falling && a.y < -3) this.kill(seat, 'fall', { dir: a.vel.clone().add(a.knock) });
    }

    if (!playing) return;
    // Commendation: still standing when the floor first shrinks to ten plates.
    if (!this._tenAwarded && this.solidTiles.length <= 10) {
      this._tenAwarded = true;
      for (const seat of this.aliveSeats) if (!seat.actor.falling) this.award(seat, 'tenTiles');
    }
    for (const seat of this.seats) this.hud.setStat(seat, seat.alive ? (seat.actor.falling ? 'FALLING' : 'STANDING') : 'FELL');
    this.hud.setTimer(this.phase === 'announce' ? this.phaseT : null);
    if (this.time > HARD_CAP) { this.end(); return; }
    this.checkLastStanding();
  }

  /** The announce → horn → drop → (reshuffle) cycle, and the late collapse. */
  _runCycle(dt) {
    if (this.time > COLLAPSE_AT && this.phase !== 'collapse') {
      this._enter('collapse', Infinity);
      this.doomed = null;
      Audio.sfx('sting');
      this.hud.banner('STRUCTURAL FAILURE', 1800, 'danger');
    }
    this.phaseT -= dt;
    switch (this.phase) {
      case 'calm':
        if (this.phaseT <= 0) {
          this.doomed = this._pickDoomed();
          this._enter('announce', lerp(4, 1.8, this.ramp));
          this._lastTick = Math.ceil(this.phaseT);
          Audio.sfx('beep');
          this.hud.banner(`${SYMBOL_NAMES[this.doomed]}`, Math.round(this.phaseLen * 1000), 'danger');
        }
        break;
      case 'announce': {
        const sec = Math.ceil(this.phaseT);
        if (sec !== this._lastTick && sec > 0) { this._lastTick = sec; Audio.sfx('tick', { vol: 2 }); }
        if (this.phaseT <= 0) {
          Audio.sfx('horn');
          this.engine.shake(0.15);
          for (const t of this.grid) if (t.state === 'up' && t.sym === this.doomed) this._doom(t);
          this._enter('drop', 1.0);
        }
        break;
      }
      case 'drop':
        if (this.phaseT <= 0) {
          this.cycle++;
          this.doomed = null;
          if (this.cycle % 2 === 0) this._reshuffle();
          this._enter('calm', lerp(1.6, 0.7, this.ramp));
        }
        break;
      case 'collapse':
        this.collapseT -= dt;
        if (this.collapseT <= 0) {
          this.collapseT = 0.55;
          const solid = this.solidTiles;
          if (solid.length) { this._doom(pick(solid)); Audio.sfx('clank', { vol: 0.5 }); }
        }
        break;
      default: break;
    }
  }

  /** Rattle doomed plates, then tip them into the shaft. */
  _animateTiles(dt) {
    for (const t of this.grid) {
      if (t.state === 'shudder') {
        t.t -= dt;
        t.group.position.set(t.x + rand(-0.04, 0.04), rand(-0.05, 0.02), t.z + rand(-0.04, 0.04));
        if (t.t <= 0) {
          t.state = 'falling';
          t.t = 3;
          t.vy = 0;
          t.spin.set(rand(-2.5, 2.5), rand(-0.6, 0.6), rand(-2.5, 2.5));
          t.group.position.set(t.x, 0, t.z);
          Audio.sfx('clank', { vol: 0.35 });
          this.fx.sparks(new THREE.Vector3(t.x, 0.05, t.z), { count: 5, speed: 3 });
        }
      } else if (t.state === 'falling') {
        t.t -= dt;
        t.vy -= 18 * dt;
        t.group.position.y += t.vy * dt;
        t.group.rotation.x += t.spin.x * dt;
        t.group.rotation.y += t.spin.y * dt;
        t.group.rotation.z += t.spin.z * dt;
        if (t.t <= 0 || t.group.position.y < -14) { t.state = 'gone'; t.group.visible = false; }
      }
    }
    // Slow sinister pulse on every symbol.
    const pulse = 0.75 + Math.sin((this.clock * 1000) * 0.004) * 0.25;
    for (const s of SYMBOLS) this.symMats[s].top.emissiveIntensity = pulse;
  }

  /** Repaint the monitors when their content changes. */
  _drawScreens() {
    const blink = Math.floor((this.clock * 1000) / 250) % 2 === 0;
    let key, paint;
    if (this.phase === 'announce' || this.phase === 'drop') {
      const sec = this.phase === 'announce' ? Math.max(1, Math.ceil(this.phaseT)) : 0;
      const red = this.phase === 'drop';
      key = `a${this.doomed}${sec}${red && blink}`;
      paint = (ctx) => {
        if (red && blink) return;
        const col = red ? '#ff3a26' : '#39ff5a';
        drawSymbol(ctx, this.doomed, 40, 50, 25, col, 8);
        ctx.fillStyle = col; ctx.font = 'bold 46px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(red ? '!' : String(sec), 98, 52);
        ctx.font = '11px monospace'; ctx.fillText(red ? 'DROPPING' : 'DROPS IN', 64, 9);
      };
    } else if (this.phase === 'collapse') {
      key = `c${blink}`;
      paint = (ctx) => {
        ctx.fillStyle = blink ? '#ff3a26' : '#701a12'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('COLLAPSE', 64, 40); ctx.font = '12px monospace'; ctx.fillText('NO SAFE FLOOR', 64, 62);
      };
    } else {
      key = `w${blink}`;
      paint = (ctx) => {
        ctx.fillStyle = '#39ff5a'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(blink ? 'STAND BY' : '', 64, 28);
        SYMBOLS.forEach((s, i) => drawSymbol(ctx, s, 22 + i * 28, 64, 9, '#1f8f34', 3));
      };
    }
    if (key === this._screenKey) return;
    this._screenKey = key;
    for (const m of this.monitors) m.draw(paint);
  }

  // ------------------------------------------------------------- placement

  /** Survivors first; the dead grouped by the instant they died (latest first). */
  placement() {
    const alive = this.aliveSeats;
    const dead = this.deaths.slice().reverse();
    return [...(alive.length ? [alive] : []), ...groupBy(dead, (s) => s.deathTime.toFixed(3))];
  }

  // ------------------------------------------------------------------- bots

  /** Breadth-first distances over solid plates from a start cell (8-way, no corner cutting). */
  _bfs(start) {
    const dist = new Map(), prev = new Map();
    if (!start) return { dist, prev };
    dist.set(start, 0);
    const q = [start];
    while (q.length) {
      const t = q.shift();
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const n = this._cell(t.c + dc, t.r + dr);
          if (!n || n.state !== 'up' || dist.has(n)) continue;
          if (dr && dc && (!this._solid(t.c + dc, t.r) || !this._solid(t.c, t.r + dr))) continue;
          dist.set(n, dist.get(t) + (dr && dc ? 1.4 : 1));
          prev.set(n, t);
          q.push(n);
        }
      }
    }
    return { dist, prev };
  }

  _cell(c, r) { return c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : this.grid[r * COLS + c]; }
  _solid(c, r) { const t = this._cell(c, r); return !!t && t.state === 'up'; }

  /** How exposed a plate is: missing neighbours and the grid edge make it riskier. */
  _exposure(t) {
    let e = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this._cell(t.c + dc, t.r + dr);
      if (!n) e += 0.35; else if (n.state !== 'up') e += 1;
    }
    return e;
  }

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, m = brain.memory;
    a.ctrl.setButtons(false, false);
    if (a.falling) { a.ctrl.setMove(0, 0); return; }

    // What does this bot "know"? It notices a new announcement after its reaction
    // time; clumsy bots occasionally misread the screen for a while.
    const elapsed = this.phaseLen - this.phaseT;
    if (this.phase === 'announce' && m.seenFor !== this.cycle) {
      m.seenFor = this.cycle;
      m.delay = brain.reaction + (random() < brain.error * 0.8 ? rand(0.6, 1.6) : 0);
    }
    const known = this.phase === 'announce' && elapsed > (m.delay ?? 0) ? this.doomed
      : this.phase === 'drop' ? this.doomed : null;

    m.retarget = (m.retarget ?? 0) - dt;
    const here = this.tileAt(a.pos.x, a.pos.z);
    const targetBad = !m.target || m.target.state !== 'up' || (known && m.target.sym === known);
    if (m.retarget <= 0 || targetBad || m.known !== known) {
      m.known = known;
      m.retarget = rand(0.6, 1.2);
      const { dist, prev } = this._bfs(here && here.state === 'up' ? here : null);
      let best = null, bs = Infinity;
      const candidates = dist.size ? [...dist.keys()] : this.solidTiles;
      for (const t of candidates) {
        if (known && t.sym === known) continue;
        let s = (dist.get(t) ?? Math.hypot(t.x - a.pos.x, t.z - a.pos.z) / TS) * (known ? 1 : 0.35);
        s += this._exposure(t) * 0.9;
        for (const o of this.arena.actors) if (o !== a && o.alive && Math.hypot(o.pos.x - t.x, o.pos.z - t.z) < 0.9) s += 1.1;
        if (this.phase === 'collapse') s += random() * 0.5;
        if (s < bs) { bs = s; best = t; }
      }
      m.target = best || here;
      // Path of plates to walk through (start → target).
      m.path = [];
      for (let t = m.target; t && t !== here && prev.has(t); t = prev.get(t)) m.path.unshift(t);
    }

    // Walk the path waypoint by waypoint, then settle in the centre of the target.
    while (m.path && m.path.length && (m.path[0].state !== 'up' && m.path[0] !== m.target || Math.hypot(m.path[0].x - a.pos.x, m.path[0].z - a.pos.z) < 0.45)) m.path.shift();
    const wp = (m.path && m.path[0]) || m.target;
    if (wp) steerTo(a, wp.x, wp.z, { arrive: 0.12, slow: 0.7 });
    else a.ctrl.setMove(0, 0);

    // Opportunistic shove: rival standing on a plate about to drop, me on a safe one.
    if (known && here && here.sym !== known && a.shoveCd <= 0) {
      for (const o of this.arena.actors) {
        if (o === a || !o.alive || o.falling) continue;
        const d = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
        const ot = this.tileAt(o.pos.x, o.pos.z);
        if (d < 1.35 && ot && ot.sym === known && random() < brain.difficulty * dt * 5) {
          const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z;
          a.ctrl.setMove(dx / d * 0.3, dz / d * 0.3);
          a.facing = Math.atan2(dx, dz);
          a.ctrl.setButtons(false, true);
          break;
        }
      }
    }
  }

  dispose() {
    super.dispose();
    for (const t of this._textures || []) t.dispose();
  }
}
