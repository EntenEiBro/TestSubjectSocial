/**
 * CHISEL TEST — every subject gets a workbench, a mallet and a slab of nine
 * clay blocks. The big monitor shows a TARGET pattern: which of the nine
 * blocks must be chiselled away. Carve it, submit it, keep your head.
 *
 * Rules:
 *   - Move the cursor one cell at a time; A chisels the block out (press again
 *     on an empty cell to put it back); B submits your slab (locks it).
 *   - When the timer runs out (12s, shrinking by 1s per pattern to 5s) or all
 *     living subjects have submitted, every slab is judged. Unsubmitted slabs
 *     that happen to be correct count as correct.
 *   - Wrong slab → a ceiling turret descends and executes you.
 *   - Patterns grow from 2 removed cells to 7. Last subject alive wins;
 *     anyone still alive after 8 patterns shares first place.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, mesh, monitor, stencil, pipe, hazardStrip } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { rand, lerp, clamp, shuffle, damp } from '../core/util.js';

const PATTERNS = 8;
const CUBE = 0.4, PITCH = 0.46;
const SLAB_TILT = 0.32;            // radians the slab tips toward the camera
const SPACING = 2.8;              // station spacing along X
const PLAYER_DX = -0.95;          // subjects stand at the left end of their bench...
const PLAYER_Z = 0.0;              // ...level with the slab, facing it (+X)
const SLAB_DX = 0.3;               // slab offset to the right of the station centre
const BENCH_TOP = 0.92;
const TURRET_UP = 6.0, TURRET_DOWN = 3.15;

/** Seconds allowed for pattern `r` (1-based). */
const timeFor = (r) => Math.max(5, 12 - (r - 1));
/** Blocks to remove for pattern `r` (1-based). */
const cellsFor = (r) => Math.min(7, 1 + r);

const LAMP = { work: 0xd99a22, sent: 0x3a8fff, pass: 0x39ff5a, fail: 0xff2a1a, off: 0x222222 };

export class ChiselTest extends Minigame {
  static meta = {
    id: 'chisel',
    title: 'CHISEL TEST',
    tagline: 'Measure twice. Cut once. Die never, ideally.',
    category: 'Precision',
    controls: [{ input: 'move', label: 'Move cursor' }, { input: 'a', label: 'Chisel / restore' }, { input: 'b', label: 'Submit' }],
    objective: 'Carve the pattern on the monitor correctly, every time.',
    rules: [
      'The monitor shows which blocks to remove (hollow squares). Carve your slab to match.',
      '{A} chisels or restores the block under your cursor. {B} submits.',
      'When time runs out, every wrong slab earns its carver a visit from the ceiling turret.',
      'Patterns get bigger and the clock gets shorter. Survive all eight.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 14, fogFar: 40, ambientIntensity: 1.0 });
    this.makeCamera([0, 5.3, 7.0], [0, 1.55, -0.35], 46);

    // Room
    floor(scene, 30, 20, { tex: 'concrete', tile: 3 });
    block(scene, 0, 3, -2.75, 30, 6, 0.3, mat(0xffffff, Tex.wall([8, 2])));
    hazardStrip(scene, 0, 1.5, 14, 0.35, 0.012);
    stencil(scene, 'PRECISION IS MANDATORY', -4.6, 4.7, -2.58, { w: 5, h: 1.1, opacity: 0.4 });
    stencil(scene, 'NO REFUNDS', 4.9, 4.7, -2.58, { w: 3.6, h: 1.1, opacity: 0.4 });
    pipe(scene, [-14, 5.6, -2.4], [14, 5.6, -2.4], 0.14);
    block(scene, 0, 5.75, 1.0, 14, 0.18, 0.25, mat(0x55574f, Tex.metal())); // turret rail

    // Big target monitor
    this.screen = monitor(scene, 0, 2.75, -2.3, { w: 2.3, h: 1.72, rotX: -0.2 });
    this._screenKey = '';

    hangingLamp(scene, -3, 6.4, 0.6, { intensity: 70, angle: 0.9 });
    hangingLamp(scene, 3, 6.4, 0.6, { intensity: 70, angle: 0.9 });

    // Shared resources
    this.cubeGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
    this.cubeMat = mat(0xe6cfa2, Tex.concrete());
    this.chipGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);

    const n = this.seats.length;
    this.seats.forEach((seat, i) => this._buildStation(seat, (i - (n - 1) / 2) * SPACING));

    this.round = 0;
    this.phase = 'idle';   // 'idle' | 'work' | 'verdict' | 'intermission'
    this.phaseT = 0;
    this.target = new Array(9).fill(false);
  }

  /** Bench, slab of nine cubes, cursor frame, status lamp, tools and a turret. */
  _buildStation(seat, x) {
    const scene = this.scene;
    const color = new THREE.Color(seat.player.color);
    // Bench
    const wood = mat(0x8a6a48, Tex.wood([2, 1]));
    block(scene, x + SLAB_DX, BENCH_TOP - 0.05, 0, 1.65, 0.1, 1.25, wood);
    for (const dx of [-0.72, 0.72]) for (const dz of [-0.5, 0.5]) block(scene, x + SLAB_DX + dx, (BENCH_TOP - 0.1) / 2, dz, 0.1, BENCH_TOP - 0.1, 0.1, mat(0x3a3a36, Tex.metal()));
    block(scene, x + SLAB_DX, BENCH_TOP - 0.25, 0.62, 1.65, 0.3, 0.04, mat(0xffffff, Tex.hazard([3, 1])));

    // Slab: tilted base plate with nine cubes on top.
    const slab = new THREE.Group();
    slab.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 1.5), mat(0x2c2d2b, Tex.plate())));
    const cubes = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cube = mesh(this.cubeGeo, this.cubeMat, (c - 1) * PITCH, 0.04 + CUBE / 2, (r - 1) * PITCH);
        slab.add(cube);
        cubes.push({ mesh: cube, pop: 1 });
      }
    }
    // Cursor: four glowing bars in the player's colour.
    const cursor = new THREE.Group();
    const barMat = new THREE.MeshBasicMaterial({ color });
    const L = PITCH, T = 0.045;
    cursor.add(mesh(new THREE.BoxGeometry(L, T, T), barMat, 0, 0, -L / 2, { cast: false }));
    cursor.add(mesh(new THREE.BoxGeometry(L, T, T), barMat, 0, 0, L / 2, { cast: false }));
    cursor.add(mesh(new THREE.BoxGeometry(T, T, L), barMat, -L / 2, 0, 0, { cast: false }));
    cursor.add(mesh(new THREE.BoxGeometry(T, T, L), barMat, L / 2, 0, 0, { cast: false }));
    slab.add(cursor);
    slab.position.set(x + SLAB_DX, BENCH_TOP + 0.12, 0.05);
    slab.rotation.x = SLAB_TILT;
    scene.add(slab);

    // Status lamp on the bench front.
    const lampMat = new THREE.MeshBasicMaterial({ color: LAMP.off });
    scene.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), lampMat, x + SLAB_DX + 0.68, BENCH_TOP - 0.25, 0.68, { cast: false }));

    // Subject + tools (mallet right hand, chisel left hand).
    const s = this.spawnSubject(seat, { x: x + PLAYER_DX, z: PLAYER_Z, facing: Math.PI / 2 });
    s.pose = 'hold';
    const mallet = new THREE.Group();
    mallet.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 5), mat(0x6b4a2a, Tex.wood()), 0, -0.12, 0));
    const head = mesh(new THREE.BoxGeometry(0.2, 0.11, 0.11), mat(0x7a7c78, Tex.metal()), 0, -0.3, 0);
    mallet.add(head);
    mallet.position.set(0, -0.78, 0.06);
    mallet.rotation.x = Math.PI / 2;
    s.parts.armR.add(mallet);
    const chisel = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.26), mat(0xa0a29c, Tex.metal()), 0, -0.8, 0.12);
    s.parts.armL.add(chisel);

    // Ceiling turret, parked above the frame until needed.
    const turret = new THREE.Group();
    const steel = mat(0x4a4c48, Tex.metal());
    const arm = mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), steel, 0, 1.6, 0);
    const head2 = new THREE.Group();
    head2.add(mesh(new THREE.BoxGeometry(0.45, 0.32, 0.5), mat(0x3a3328, Tex.rust())));
    head2.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), steel, 0.1, 0, 0.45));
    head2.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), steel, -0.1, 0, 0.45));
    head2.children[1].rotation.x = Math.PI / 2;
    head2.children[2].rotation.x = Math.PI / 2;
    head2.add(mesh(new THREE.SphereGeometry(0.05, 6, 4), glow(0xff2a1a), 0, 0.1, 0.26, { cast: false }));
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 0.75); head2.add(muzzle);
    const laser = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.75 }));
    laser.visible = false;
    head2.add(laser);
    const flash = new THREE.PointLight(0xffc070, 0, 7, 1.5);
    muzzle.add(flash);
    turret.add(arm, head2);
    turret.position.set(x + PLAYER_DX, TURRET_UP, 1.0);
    scene.add(turret);

    seat.bench = {
      x, slab, cubes, cursor, lampMat, mallet,
      removed: new Array(9).fill(false),
      cur: 4, submitted: false, pass: null, swing: 0,
      turret: { group: turret, head: head2, muzzle, laser, flash, y: TURRET_UP, wantDown: false, aim: false },
    };
    this._placeCursor(seat);
  }

  // ------------------------------------------------------------- patterns

  /** Start pattern `round`: new target, fresh slabs, reset submissions. */
  _beginPattern() {
    this.round++;
    const k = cellsFor(this.round);
    const cells = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, k);
    this.target = new Array(9).fill(false);
    for (const i of cells) this.target[i] = true;
    this.phase = 'work';
    this.phaseT = timeFor(this.round);
    this._lastTick = Math.ceil(this.phaseT);
    for (const seat of this.aliveSeats) {
      const b = seat.bench;
      b.removed.fill(false);
      b.cubes.forEach((cb, i) => { cb.mesh.visible = true; cb.pop = -0.1 * i / 9 - 0.05; }); // staggered drop-in
      b.submitted = false;
      b.pass = null;
      b.cur = 4;
      b.lampMat.color.setHex(LAMP.work);
      this._placeCursor(seat);
    }
    Audio.sfx('beep');
    this.hud.banner(`PATTERN ${this.round}`, 1100);
    this.hud.prompt(`PATTERN ${this.round} / ${PATTERNS} — carve the shape on the monitor`);
  }

  /** Judge every living slab and schedule executions. */
  _verdict() {
    this.phase = 'verdict';
    this.phaseT = 0;
    this._fired = false;
    this.hud.banner('VERDICT', 1200, 'danger');
    Audio.sfx('horn', { vol: 0.6 });
    for (const seat of this.aliveSeats) {
      const b = seat.bench;
      b.pass = b.removed.every((v, i) => v === this.target[i]);
      b.lampMat.color.setHex(b.pass ? LAMP.pass : LAMP.fail);
      b.turret.wantDown = !b.pass;
      Audio.sfx(b.pass ? 'ding' : 'wrong', { vol: 0.7 });
    }
  }

  start() { this._beginPattern(); }

  preview(dt) {
    this._animate(dt);
    this._drawScreen();
  }

  update(dt) {
    const playing = this.state === 'play';
    if (playing) {
      this.phaseT += this.phase === 'work' ? -dt : dt;
      if (this.phase === 'work') this._work(dt);
      else if (this.phase === 'verdict') this._runVerdict();
      else if (this.phase === 'intermission' && this.phaseT > 1.2) this._beginPattern();
    }
    this._animate(dt);
    this._drawScreen();
    if (!playing) return;

    this.hud.setTimer(this.phase === 'work' ? this.phaseT : null);
    for (const seat of this.seats) {
      const b = seat.bench;
      const txt = !seat.alive ? 'EXECUTED' : b.pass === true ? 'PASSED' : b.pass === false ? 'FAILED' : b.submitted ? 'SUBMITTED' : 'CARVING';
      this.hud.setStat(seat, txt);
      this.hud.setStatus(seat, seat.alive ? `PATTERN ${this.round}/${PATTERNS}` : '');
    }
  }

  /** Read inputs during the carving phase; end it on timeout or full submission. */
  _work() {
    const sec = Math.ceil(this.phaseT);
    if (sec !== this._lastTick && sec >= 0) { this._lastTick = sec; if (sec <= 3) Audio.sfx('tick', { vol: 2 }); }
    for (const seat of this.aliveSeats) {
      const b = seat.bench, c = seat.ctrl;
      if (b.submitted) continue;
      if (c.dirPressed) {
        let r = Math.floor(b.cur / 3), col = b.cur % 3;
        if (c.dirPressed === 'up') r--; else if (c.dirPressed === 'down') r++;
        else if (c.dirPressed === 'left') col--; else if (c.dirPressed === 'right') col++;
        const nc = clamp(r, 0, 2) * 3 + clamp(col, 0, 2);
        if (nc !== b.cur) { b.cur = nc; this._placeCursor(seat); Audio.sfx('click', { vol: 0.5 }); }
      }
      if (c.aPressed) this._toggle(seat);
      if (c.bPressed) {
        b.submitted = true;
        b.cursor.visible = false;
        b.lampMat.color.setHex(LAMP.sent);
        Audio.sfx('select', { vol: 0.7 });
      }
    }
    if (this.phaseT <= 0 || this.aliveSeats.every((s) => s.bench.submitted)) this._verdict();
  }

  /** Chisel out (or restore) the cell under the cursor. */
  _toggle(seat) {
    const b = seat.bench, i = b.cur, cb = b.cubes[i];
    b.swing = 0.2;
    b.removed[i] = !b.removed[i];
    const p = new THREE.Vector3();
    cb.mesh.getWorldPosition(p);
    if (b.removed[i]) {
      cb.mesh.visible = false;
      Audio.sfx('chisel');
      Audio.sfx('crunch', { vol: 0.3 });
      for (let k = 0; k < 3; k++) {
        const chip = new THREE.Mesh(this.chipGeo, this.cubeMat);
        chip.position.copy(p).add(new THREE.Vector3(rand(-0.12, 0.12), rand(0, 0.15), rand(-0.12, 0.12)));
        this.scene.add(chip);
        this.fx.addBody(chip, new THREE.Vector3(rand(-2, 2), rand(2, 4), rand(-1, 2.5)), new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { life: 1.6, bleed: false, radius: 0.06, bounce: 0.4 });
      }
      this.fx.smoke(p, { color: 0xb8ab90, size: 0.14, life: 0.8, rise: 0.6, opacity: 0.55 });
    } else {
      cb.mesh.visible = true;
      cb.pop = 0.25;
      Audio.sfx('thud', { vol: 0.6 });
    }
  }

  /** Verdict timeline: turrets descend, aim, fire; then next pattern or the end. */
  _runVerdict() {
    const t = this.phaseT;
    const doomed = this.aliveSeats.filter((s) => s.bench.pass === false);
    if (t > 0.9 && t < 1.6) for (const s of doomed) s.bench.turret.aim = true;
    if (t >= 1.6 && !this._fired) {
      this._fired = true;
      for (const s of doomed) {
        const tr = s.bench.turret;
        tr.aim = false;
        const from = new THREE.Vector3(); tr.muzzle.getWorldPosition(from);
        const to = new THREE.Vector3(); s.subject.parts.chest.getWorldPosition(to);
        tr.flash.intensity = 50;
        this.fx.sparks(from, { count: 14, speed: 6 });
        this.fx.smoke(from, { size: 0.2, life: 1, opacity: 0.4 });
        // Same instant for everyone failing this pattern → shared placement tier.
        this.kill(s, 'shot', { dir: to.sub(from), force: 1.3 });
      }
      if (!doomed.length) Audio.sfx('ding');
    }
    if (t >= 2.7) {
      for (const s of this.seats) s.bench.turret.wantDown = false;
      const alive = this.aliveSeats;
      if (alive.length <= 1 || this.round >= PATTERNS) {
        if (this.round >= PATTERNS && alive.length) {
          for (const s of alive) this.award(s, 'masterMason');
          this.hud.banner(alive.length > 1 ? 'APPRENTICES SURVIVE' : 'MASTER MASON', 2000, 'good');
        }
        this.hud.prompt(null);
        this.end();
        return;
      }
      this.phase = 'intermission';
      this.phaseT = 0;
      for (const s of alive) { s.bench.pass = null; s.bench.lampMat.color.setHex(LAMP.off); }
    }
  }

  // ------------------------------------------------------------- visuals

  _placeCursor(seat) {
    const b = seat.bench, r = Math.floor(b.cur / 3), c = b.cur % 3;
    b.cursor.position.set((c - 1) * PITCH, 0.04 + CUBE + 0.03, (r - 1) * PITCH);
  }

  _animate(dt) {
    const now = performance.now();
    for (const seat of this.seats) {
      const b = seat.bench;
      // Cubes: drop-in / restore pop.
      for (const cb of b.cubes) {
        if (cb.pop !== 1) {
          cb.pop = Math.min(1, cb.pop + dt * 4);
          const k = clamp(cb.pop, 0, 1);
          cb.mesh.position.y = 0.04 + CUBE / 2 + (1 - k) * 0.6;
          cb.mesh.scale.setScalar(lerp(0.6, 1, k));
          if (cb.pop >= 1) { cb.mesh.position.y = 0.04 + CUBE / 2; cb.mesh.scale.setScalar(1); }
        }
      }
      b.cursor.visible = seat.alive && !b.submitted && this.phase === 'work' && (Math.floor(now / 180) % 4 !== 0);
      // Turret: descend / park, aim at the subject, laser while aiming.
      const tr = b.turret;
      tr.y += ((tr.wantDown ? TURRET_DOWN : TURRET_UP) - tr.y) * damp(5, dt);
      tr.group.position.y = tr.y;
      const tgt = new THREE.Vector3(b.x + PLAYER_DX, 1.3, PLAYER_Z);
      tr.head.lookAt(tgt);
      tr.laser.visible = tr.aim;
      if (tr.aim) {
        const d = tr.head.getWorldPosition(new THREE.Vector3()).distanceTo(tgt);
        tr.laser.scale.z = d;
        tr.laser.position.set(0, 0, d / 2);
        tr.laser.material.opacity = 0.5 + Math.sin(now * 0.05) * 0.3;
      }
      tr.flash.intensity *= Math.exp(-dt * 20);
      if (!seat.alive) continue;
      // Subject: idle hold, mallet strike on each chisel blow.
      const s = seat.subject, p = s.parts;
      if (b.pass === false && this.phase === 'verdict') { s.pose = 'cower'; s.animate(dt, 0); continue; }
      s.animate(dt, 0);
      b.swing = Math.max(0, b.swing - dt);
      const ax = b.swing > 0.1 ? -2.1 : b.swing > 0 ? -0.75 : -1.25;
      p.armR.rotation.x += (ax - p.armR.rotation.x) * damp(30, dt);
      p.armR.rotation.z = -0.1;
      p.armL.rotation.x = -0.95;
      p.armL.rotation.z = 0.15;
      p.torso.rotation.x = 0.22;
      p.head.rotation.x = 0.35; // stare at the slab
    }
  }

  /** Big monitor: target grid, pattern number and timer. */
  _drawScreen() {
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const sec = Math.max(0, Math.ceil(this.phaseT));
    const key = `${this.phase}|${this.round}|${this.target.join('')}|${this.phase === 'work' ? sec : blink}`;
    if (key === this._screenKey) return;
    this._screenKey = key;
    this.screen.draw((ctx) => {
      ctx.textBaseline = 'middle';
      if (this.phase === 'idle') {
        ctx.fillStyle = '#39ff5a'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
        if (blink) ctx.fillText('AWAITING PATTERN', 64, 48);
        return;
      }
      // Target grid: solid blocks stay, hollow squares must be removed.
      const S = 24, ox = 8, oy = 16;
      for (let i = 0; i < 9; i++) {
        const x = ox + (i % 3) * (S + 2), y = oy + Math.floor(i / 3) * (S + 2);
        if (this.target[i]) {
          ctx.strokeStyle = '#39ff5a'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
          ctx.strokeRect(x + 2, y + 2, S - 4, S - 4);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = '#39ff5a'; ctx.fillRect(x, y, S, S);
          ctx.fillStyle = '#1f8f34'; ctx.fillRect(x + S - 4, y, 4, S); ctx.fillRect(x, y + S - 4, S, 4);
        }
      }
      ctx.fillStyle = '#39ff5a'; ctx.textAlign = 'center';
      ctx.font = '10px monospace'; ctx.fillText('TARGET', 46, 8);
      ctx.fillText(`PATTERN ${this.round}/${PATTERNS}`, 104, 10);
      if (this.phase === 'work') {
        ctx.font = 'bold 34px monospace';
        ctx.fillStyle = sec <= 3 ? '#ff3a26' : '#39ff5a';
        ctx.fillText(String(sec), 104, 48);
        ctx.font = '10px monospace'; ctx.fillStyle = '#39ff5a';
        ctx.fillText(`CUT ${this.target.filter(Boolean).length}`, 104, 78);
      } else if (this.phase === 'verdict') {
        ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#ff3a26';
        if (blink) ctx.fillText('VERDICT', 104, 48);
      } else {
        ctx.font = 'bold 13px monospace';
        ctx.fillText('NEXT', 104, 48);
      }
    });
  }

  // ------------------------------------------------------------- placement

  /** Survivors share first; the executed are grouped by the instant they died. */
  placement() {
    const alive = this.aliveSeats;
    const dead = this.deaths.slice().reverse();
    return [...(alive.length ? [alive] : []), ...groupBy(dead, (s) => s.deathTime.toFixed(3))];
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const c = seat.ctrl, brain = seat.brain, m = brain.memory, b = seat.bench;
    c.setButtons(false, false);
    c.setMove(0, 0);
    if (this.phase !== 'work' || b.submitted) return;
    if (m.round !== this.round) {
      // New pattern: read the monitor (clumsy bots occasionally misread one cell).
      m.round = this.round;
      m.wait = brain.reaction + rand(0.3, 0.7) + cellsFor(this.round) * 0.07;
      m.goal = this.target.slice();
      if (Math.random() < brain.error * 0.8) { const i = Math.floor(Math.random() * 9); m.goal[i] = !m.goal[i]; }
    }
    m.wait -= dt;
    if (m.wait > 0) return;
    m.wait = lerp(0.4, 0.17, brain.difficulty) + rand(-0.02, 0.08);

    const needed = [];
    for (let i = 0; i < 9; i++) if (b.removed[i] !== m.goal[i]) needed.push(i);
    if (!needed.length) { c.setButtons(false, true); return; } // submit
    const r0 = Math.floor(b.cur / 3), c0 = b.cur % 3;
    // Rare slip: chisel the wrong cell (it will notice and fix it if time allows).
    if (!needed.includes(b.cur) && Math.random() < brain.error * 0.4) { c.setButtons(true, false); return; }
    let best = needed[0], bd = Infinity;
    for (const i of needed) { const d = Math.abs(Math.floor(i / 3) - r0) + Math.abs((i % 3) - c0); if (d < bd) { bd = d; best = i; } }
    if (best === b.cur) { c.setButtons(true, false); return; }
    const r1 = Math.floor(best / 3), c1 = best % 3;
    if (r1 !== r0) c.tapDir(r1 < r0 ? 'up' : 'down');
    else c.tapDir(c1 < c0 ? 'left' : 'right');
  }
}
