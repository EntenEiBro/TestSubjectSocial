/**
 * VENT CRAWL — a seeded maze of low ventilation ducts, littered with data
 * chips and patrolled by security drones that hunt by ear.
 *
 * Rules
 *  - The duct network is a 13×9 maze generated from the round seed, with a
 *    few extra openings so it has loops (no open 2×2 halls, no wall islands).
 *  - Data chips lie at cell centres. Walking over one = +1 chip. When only a
 *    few are left, a fresh batch appears away from everybody.
 *  - A security drone patrols the ducts and paths (BFS along the maze) to the
 *    nearest subject it can HEAR: moving subjects are heard within 6 cells of
 *    duct, standing still only from the next cell, and anyone who just
 *    grabbed a chip is loud (10 cells) for a moment. It remembers the last
 *    heard spot for a short while, otherwise it wanders.
 *  - At 25 s a second drone drops in as far from the subjects as possible.
 *    At 45 s both drones are overclocked (faster, sharper hearing).
 *  - Drone contact is fatal ('shot'). B shoves (nudge a rival into a drone).
 *  - Round: 60 s, or until at most one subject is left. Ranking: the living
 *    by chips, then the dead by chips (later death breaks ties).
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, mesh, pipe, stencil, hazardStrip } from '../core/environment.js';
import { Tex, mat, canvasTexture } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { clamp, angleDiff } from '../core/util.js';
import { random, randInt, pick, shuffle } from '../core/rng.js';

const COLS = 13, ROWS = 9, N = COLS * ROWS;
const CELL = 1.6;
const HW = (COLS * CELL) / 2, HD = (ROWS * CELL) / 2;
const T = 0.22;                 // wall thickness
const WALL_H = 0.75;            // low duct walls
const CENTER = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2);

const ROUND_TIME = 60;
const SECOND_AT = 25;
const OVERCLOCK_AT = 45;
const SUBJECT_SPEED = 4.2;
const DRONE_PATROL = 2.4;       // drone speed when nobody is heard
const DRONE_CHASE = 3.2;        // drone speed while chasing a heard subject
const OVERCLOCK_MUL = 1.2;
const DRONE_Y = 1.3;
const KILL_R = 0.72;
const HEAR_MOVE = 6;            // path cells
const HEAR_STILL = 1;
const HEAR_LOUD = 10;
const LOUD_T = 1.6;             // seconds a chip pickup stays audible
const MEMORY = 2.5;             // seconds a drone keeps hunting the last heard spot
const STILL_SPEED = 1.0;        // below this ground speed a subject counts as quiet
const PICK_R2 = 0.6 * 0.6;
const CHIP_LOW = 3;             // respawn a batch at or below this many chips
const CHIP_POOL = 12;

/** Cell centre coordinates. */
const cx = (i) => -HW + ((i % COLS) + 0.5) * CELL;
const cz = (i) => -HD + (Math.floor(i / COLS) + 0.5) * CELL;

export class VentCrawl extends Minigame {
  static meta = {
    id: 'ventcrawl',
    title: 'VENT CRAWL',
    tagline: 'The ducts are quiet. Keep it that way.',
    category: 'Stealth',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Collect the most data chips without being found.',
    rules: [
      'Data chips lie in the ducts. Each one is worth a point.',
      'Security drones hunt by sound. Moving is loud; standing still is quiet.',
      'Grabbing a chip makes noise. A second drone joins after 25 seconds.',
      'Drone contact is fatal. The living outrank the dead.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 20, fogFar: 48, ambientIntensity: 0.55 });
    this.makeCamera([0, 18.5, 8.2], [0, 0, 0.5], 50);

    // Scratch buffers for the grid searches (no per-tick allocations).
    this._queue = new Int16Array(N);
    this._tmpDist = new Int16Array(N);
    this._tmpMark = new Uint8Array(N);
    this._botDist = new Int16Array(N);
    this._botPar = new Int16Array(N);
    this.danger = new Int16Array(N).fill(-1);
    this._dangerSrc = [];

    this._generateMaze();

    // --- set dressing
    floor(scene, 60, 44, { tex: 'concrete', tile: 3, y: -0.02, color: 0x6f6c66 });
    floor(scene, HW * 2, HD * 2, { tex: 'plate', tile: CELL, y: 0, color: 0x8e918c });
    const grillMat = new THREE.MeshLambertMaterial({ map: ventTexture(), color: 0xb0b0aa });
    const grillGeo = new THREE.PlaneGeometry(CELL * 0.5, CELL * 0.5);
    for (let i = 0; i < N; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      if ((c * 7 + r * 5) % 9 !== 4) continue;
      const g = mesh(grillGeo, grillMat, cx(i), 0.012, cz(i), { cast: false });
      g.rotation.x = -Math.PI / 2;
      scene.add(g);
    }
    hazardStrip(scene, 0, -HD - 0.5, HW * 2 + 1.4, 0.5);
    hazardStrip(scene, 0, HD + 0.5, HW * 2 + 1.4, 0.5);
    const back = mesh(new THREE.PlaneGeometry(48, 8), mat(0xffffff, Tex.wall([12, 2])), 0, 3.5, -HD - 2.4, { cast: false });
    scene.add(back);
    stencil(scene, 'VENT SECTOR 7', -5.5, 2.3, -HD - 2.35, { w: 7, h: 2, opacity: 0.55 });
    stencil(scene, 'DRONES HAVE RIGHT OF WAY', 6, 2.0, -HD - 2.35, { w: 7.5, h: 1.4, opacity: 0.4 });
    pipe(scene, [-24, 4.3, -HD - 2.1], [24, 4.3, -HD - 2.1], 0.25);
    pipe(scene, [-24, 3.6, -HD - 2.2], [24, 3.6, -HD - 2.2], 0.12, 0x5a3022);

    this.lamps = [
      hangingLamp(scene, -5.4, 7.2, -0.6, { intensity: 50, angle: 0.8, color: 0xd6dcff }),
      hangingLamp(scene, 5.4, 7.2, 0.6, { intensity: 50, angle: 0.8, color: 0xd6dcff }),
      hangingLamp(scene, 0, 7, 4.4, { intensity: 22, angle: 0.75, shadow: false }),
    ];

    // --- duct walls: merged straight runs, one shared unit box
    this.arena = new Arena({ bounds: { minX: -HW, maxX: HW, minZ: -HD, maxZ: HD }, shoveForce: 10 });
    const wallMat = mat(0xa3a7a1, Tex.metal());
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const addRun = (minX, maxX, minZ, maxZ) => {
      const m = mesh(unit, wallMat, (minX + maxX) / 2, WALL_H / 2, (minZ + maxZ) / 2);
      m.scale.set(maxX - minX, WALL_H, maxZ - minZ);
      scene.add(m);
      this.arena.addWall(minX, maxX, minZ, maxZ);
    };
    for (let j = 0; j <= ROWS; j++) {          // horizontal lines (constant z)
      const z = -HD + j * CELL;
      let start = -1;
      for (let c = 0; c <= COLS; c++) {
        const has = c < COLS && (j === 0 || j === ROWS || this.south[(j - 1) * COLS + c] === 1);
        if (has && start < 0) start = c;
        if (!has && start >= 0) { addRun(-HW + start * CELL - T / 2, -HW + c * CELL + T / 2, z - T / 2, z + T / 2); start = -1; }
      }
    }
    for (let i = 0; i <= COLS; i++) {          // vertical lines (constant x)
      const x = -HW + i * CELL;
      let start = -1;
      for (let r = 0; r <= ROWS; r++) {
        const has = r < ROWS && (i === 0 || i === COLS || this.east[r * COLS + i - 1] === 1);
        if (has && start < 0) start = r;
        if (!has && start >= 0) { addRun(x - T / 2, x + T / 2, -HD + start * CELL - T / 2, -HD + r * CELL + T / 2); start = -1; }
      }
    }

    // --- subjects in the corners
    const corners = [0, N - 1, COLS - 1, N - COLS];
    this.seats.forEach((seat, i) => {
      const cell = corners[i % 4];
      const x = cx(cell), z = cz(cell);
      this.spawnSubject(seat, { x, z, facing: Math.atan2(-x, -z) });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z, speed: SUBJECT_SPEED }));
      seat.actor.seat = seat;
      seat.actor.facing = Math.atan2(-x, -z);
      seat.actor.data.loudT = 0;
    });

    // --- drones (both built now so the light count never changes mid-round)
    this.drones = [this._makeDrone(scene), this._makeDrone(scene)];
    const d0 = this.drones[0];
    this._placeDrone(d0, CENTER);
    d0.active = true;
    d0.idle = 2;
    this.droneMul = 1;
    this.hearMove = HEAR_MOVE;
    this.overclocked = false;

    // --- data chips (pooled)
    this.chipTarget = 6 + this.seats.length;
    const boardGeo = new THREE.BoxGeometry(0.38, 0.05, 0.28);
    const dieGeo = new THREE.BoxGeometry(0.15, 0.06, 0.15);
    const haloGeo = new THREE.CircleGeometry(0.34, 12);
    const boardMat = new THREE.MeshLambertMaterial({ color: 0x1d6b34, emissive: 0x23b04a, emissiveIntensity: 0.75 });
    const dieMat = mat(0x151615);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x2bff6a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.chips = [];
    for (let k = 0; k < CHIP_POOL; k++) {
      const g = new THREE.Group();
      const board = mesh(boardGeo, boardMat, 0, 0, 0, { cast: false });
      const die = mesh(dieGeo, dieMat, 0, 0.03, 0, { cast: false });
      const halo = mesh(haloGeo, haloMat, 0, -0.26, 0, { cast: false, receive: false });
      halo.rotation.x = -Math.PI / 2;
      g.add(board, die, halo);
      g.visible = false;
      scene.add(g);
      this.chips.push({ g, cell: -1, active: false, pop: 1, phase: k * 1.7 });
    }
    this._spawnChips(this.chipTarget);
  }

  // ------------------------------------------------------------------ maze

  /** Recursive-backtracker maze plus extra openings for loops. */
  _generateMaze() {
    const east = this.east = new Uint8Array(N).fill(1);   // wall on the +X side of a cell
    const south = this.south = new Uint8Array(N).fill(1); // wall on the +Z side of a cell
    const seen = new Uint8Array(N);
    const start = randInt(0, N - 1);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const c = cur % COLS, r = Math.floor(cur / COLS);
      const opts = [];
      if (r > 0 && !seen[cur - COLS]) opts.push(0);
      if (c < COLS - 1 && !seen[cur + 1]) opts.push(1);
      if (r < ROWS - 1 && !seen[cur + COLS]) opts.push(2);
      if (c > 0 && !seen[cur - 1]) opts.push(3);
      if (!opts.length) { stack.pop(); continue; }
      const dir = pick(opts);
      const nxt = dir === 0 ? cur - COLS : dir === 1 ? cur + 1 : dir === 2 ? cur + COLS : cur - 1;
      this._openWall(cur, dir);
      seen[nxt] = 1;
      stack.push(nxt);
    }
    // Knock out ~28% of the remaining inner walls (never leaving a wall-less vertex).
    const walls = [];
    for (let i = 0; i < N; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      if (c < COLS - 1 && east[i]) walls.push(i * 2);
      if (r < ROWS - 1 && south[i]) walls.push(i * 2 + 1);
    }
    let toRemove = Math.round(walls.length * 0.28);
    for (const w of shuffle(walls)) {
      if (toRemove <= 0) break;
      if (this._tryRemove(w >> 1, (w & 1) === 1)) toRemove--;
    }
    // Spawn corners get a second exit where possible (no instant dead ends).
    this._tryRemove(0, false); this._tryRemove(0, true);
    this._tryRemove(COLS - 2, false); this._tryRemove(COLS - 1, true);
    this._tryRemove(N - COLS - COLS, true); this._tryRemove(N - COLS, false);
    this._tryRemove(N - 1 - COLS, true); this._tryRemove(N - 2, false);

    // Neighbour lists (N, E, S, W order).
    this.nbr = [];
    for (let i = 0; i < N; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      const list = [];
      if (r > 0 && !south[i - COLS]) list.push(i - COLS);
      if (c < COLS - 1 && !east[i]) list.push(i + 1);
      if (r < ROWS - 1 && !south[i]) list.push(i + COLS);
      if (c > 0 && !east[i - 1]) list.push(i - 1);
      this.nbr.push(list);
    }
  }

  _openWall(cell, dir) {
    if (dir === 0) this.south[cell - COLS] = 0;
    else if (dir === 1) this.east[cell] = 0;
    else if (dir === 2) this.south[cell] = 0;
    else this.east[cell - 1] = 0;
  }

  /** Remove the east/south wall of `cell` unless that leaves a vertex with no walls. */
  _tryRemove(cell, isSouth) {
    const c = cell % COLS, r = Math.floor(cell / COLS);
    const arr = isSouth ? this.south : this.east;
    if (isSouth ? r >= ROWS - 1 : c >= COLS - 1) return false;
    if (!arr[cell]) return false;
    arr[cell] = 0;
    const ok = isSouth
      ? this._vertexWalls(c, r + 1) > 0 && this._vertexWalls(c + 1, r + 1) > 0
      : this._vertexWalls(c + 1, r) > 0 && this._vertexWalls(c + 1, r + 1) > 0;
    if (!ok) arr[cell] = 1;
    return ok;
  }

  /** Number of wall segments meeting at grid vertex (vx, vy); border vertices always count as walled. */
  _vertexWalls(vx, vy) {
    if (vx <= 0 || vx >= COLS || vy <= 0 || vy >= ROWS) return 9;
    const ul = (vy - 1) * COLS + (vx - 1);
    return this.east[ul] + this.east[ul + COLS] + this.south[ul] + this.south[ul + 1];
  }

  cellAt(x, z) {
    const c = clamp(Math.floor((x + HW) / CELL), 0, COLS - 1);
    const r = clamp(Math.floor((z + HD) / CELL), 0, ROWS - 1);
    return r * COLS + c;
  }

  /** Breadth-first search over open ducts. Writes step counts (-1 = unreached) into `out`. */
  bfs(sources, out, blocked = null, par = null) {
    out.fill(-1);
    const q = this._queue;
    let head = 0, tail = 0;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      if (out[s] >= 0) continue;
      out[s] = 0;
      if (par) par[s] = -1;
      q[tail++] = s;
    }
    while (head < tail) {
      const cur = q[head++];
      const nb = this.nbr[cur];
      const nd = out[cur] + 1;
      for (let k = 0; k < nb.length; k++) {
        const n = nb[k];
        if (out[n] >= 0 || (blocked && blocked(n))) continue;
        out[n] = nd;
        if (par) par[n] = cur;
        q[tail++] = n;
      }
    }
    return out;
  }

  /** First cell on the BFS path from `start` to `goal` (or `start` if none). */
  _firstStep(par, start, goal) {
    if (goal === start) return start;
    let c = goal;
    for (let guard = 0; guard < N; guard++) {
      const p = par[c];
      if (p === start) return c;
      if (p < 0) return start;
      c = p;
    }
    return start;
  }

  // ----------------------------------------------------------------- chips

  /** Top the chip count up to `target`, away from subjects and drones. Returns how many appeared. */
  _spawnChips(target) {
    let active = 0;
    for (const ch of this.chips) if (ch.active) active++;
    if (active >= target) return 0;
    const src = [];
    for (const s of this.seats) if (s.alive && s.actor) src.push(this.cellAt(s.actor.pos.x, s.actor.pos.z));
    for (const d of this.drones) if (d.active) src.push(this.cellAt(d.x, d.z));
    const dist = this.bfs(src, this._tmpDist);
    const taken = this._tmpMark;
    taken.fill(0);
    for (const ch of this.chips) if (ch.active) taken[ch.cell] = 1;
    let spawned = 0;
    for (const ch of this.chips) {
      if (active >= target) break;
      if (ch.active) continue;
      let cands = [];
      for (let i = 0; i < N; i++) if (!taken[i] && dist[i] >= 3) cands.push(i);
      if (!cands.length) { cands = []; for (let i = 0; i < N; i++) if (!taken[i]) cands.push(i); }
      if (!cands.length) break;
      const cell = pick(cands);
      taken[cell] = 1;
      ch.cell = cell;
      ch.active = true;
      ch.pop = 0;
      ch.g.visible = true;
      ch.g.position.set(cx(cell), 0.32, cz(cell));
      active++;
      spawned++;
    }
    return spawned;
  }

  // ---------------------------------------------------------------- drones

  _makeDrone(scene) {
    const g = new THREE.Group();
    const shell = mat(0x3b3f3e, Tex.metal());
    const dark = mat(0x1a1b1a);
    const body = mesh(new THREE.SphereGeometry(0.34, 8, 6), shell);
    body.scale.set(1, 0.45, 1.1);
    const band = mesh(new THREE.TorusGeometry(0.36, 0.035, 4, 14), mat(0xc9a227, Tex.rust()), 0, 0, 0, { cast: false });
    band.rotation.x = Math.PI / 2;
    g.add(body, band);
    const armGeo = new THREE.BoxGeometry(1.0, 0.04, 0.06);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = mesh(armGeo, dark, 0, 0.04, 0);
      arm.rotation.y = a;
      g.add(arm);
    }
    const rotors = [];
    const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6);
    const bladeGeo = new THREE.BoxGeometry(0.36, 0.012, 0.05);
    for (const [x, z] of [[0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]) {
      const rotor = new THREE.Group();
      rotor.position.set(x, 0.08, z);
      rotor.add(mesh(hubGeo, dark, 0, 0, 0, { cast: false }), mesh(bladeGeo, dark, 0, 0.03, 0, { cast: false }));
      g.add(rotor);
      rotors.push(rotor);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2010 });
    g.add(mesh(new THREE.SphereGeometry(0.075, 6, 4), eyeMat, 0, -0.03, 0.36, { cast: false }));
    // Scanning cone (apex at the drone, tilted forward, sweeps side to side).
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.rotation.x = -0.5;
    pivot.position.set(0, -0.05, 0.2);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const cone = mesh(new THREE.ConeGeometry(0.5, 1.45, 14, 1, true), coneMat, 0, -0.725, 0, { cast: false, receive: false });
    pivot.add(cone);
    g.add(pivot);
    const light = new THREE.PointLight(0xff2a1a, 0, 4.5, 1.6);
    light.position.set(0, -0.3, 0.2);
    g.add(light);
    g.visible = false;
    scene.add(g);
    // Red spot where the scanner touches the floor.
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
    const spot = mesh(new THREE.CircleGeometry(0.5, 16), spotMat, 0, 0.025, 0, { cast: false, receive: false });
    spot.rotation.x = -Math.PI / 2;
    spot.visible = false;
    scene.add(spot);
    return {
      g, rotors, eyeMat, pivot, coneMat, spot, spotMat, light,
      active: false, warm: 0, idle: 0, x: 0, z: 0, wp: CENTER, homing: false,
      target: null, goal: CENTER, patrol: -1, memory: 0,
      heading: 0, yaw: 0, bob: 0, scan: 0, flash: 0,
      dist: new Int16Array(N), goalDist: new Int16Array(N),
    };
  }

  _placeDrone(d, cell) {
    d.x = cx(cell); d.z = cz(cell);
    d.wp = cell; d.goal = cell; d.patrol = -1; d.memory = 0; d.homing = false; d.target = null;
    d.g.visible = true;
    d.spot.visible = true;
    d.g.position.set(d.x, DRONE_Y, d.z);
  }

  /** Second drone: drops in on the cell farthest (by duct) from every living subject. */
  _deploySecond() {
    const d = this.drones[1];
    const src = [];
    for (const s of this.seats) if (s.alive) src.push(this.cellAt(s.actor.pos.x, s.actor.pos.z));
    let cell = CENTER;
    if (src.length) {
      const dist = this.bfs(src, this._tmpDist);
      let bd = -1;
      for (let i = 0; i < N; i++) if (dist[i] > bd) { bd = dist[i]; cell = i; }
    }
    this._placeDrone(d, cell);
    d.active = true;
    d.warm = 1.4;
    d.idle = 0;
    this.hud.banner('SECOND DRONE DEPLOYED', 1400, 'danger');
    Audio.sfx('horn', { vol: 0.5 });
  }

  _moveDrone(d, tx, tz, step) {
    const dx = tx - d.x, dz = tz - d.z, len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const m = Math.min(step, len);
    d.x += (dx / len) * m;
    d.z += (dz / len) * m;
    d.heading = Math.atan2(dx, dz);
  }

  _updateDrone(d, dt) {
    if (!d.active) return;
    if (d.warm > 0) { d.warm -= dt; return; }
    if (d.idle > 0) { d.idle -= dt; return; }
    const pc = this.cellAt(d.x, d.z);
    this.bfs([pc], d.dist);

    // Listen: nearest audible subject by duct distance (seat order breaks ties).
    let best = null, bd = 999;
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor;
      const pd = d.dist[this.cellAt(a.pos.x, a.pos.z)];
      if (pd < 0) continue;
      const moving = Math.hypot(a.vel.x, a.vel.z) > STILL_SPEED;
      const range = a.data.loudT > 0 ? HEAR_LOUD : moving ? this.hearMove : HEAR_STILL;
      if (pd <= range && pd < bd) { bd = pd; best = seat; }
    }
    if (best && best !== d.target) Audio.sfx('sonar', { vol: 0.35 });
    d.target = best;
    let tc = -1;
    if (best) { tc = this.cellAt(best.actor.pos.x, best.actor.pos.z); d.goal = tc; d.memory = MEMORY; }
    else if (d.memory > 0) d.memory -= dt;

    const step = (best ? DRONE_CHASE : DRONE_PATROL) * this.droneMul * dt;
    if (best && (tc === pc || tc === d.wp)) {
      // Same or next duct cell: go straight for them.
      d.homing = true;
      this._moveDrone(d, best.actor.pos.x, best.actor.pos.z, step);
      return;
    }
    if (d.homing) { d.homing = false; d.wp = pc; }
    const tx = cx(d.wp), tz = cz(d.wp);
    if (Math.hypot(tx - d.x, tz - d.z) > step) { this._moveDrone(d, tx, tz, step); return; }
    // Reached a cell centre: pick the next one along the shortest duct path.
    d.x = tx; d.z = tz;
    if (!best) {
      if (d.memory > 0 && d.wp === d.goal) d.memory = 0;
      if (d.memory <= 0) {
        if (d.patrol < 0 || d.wp === d.patrol) d.patrol = randInt(0, N - 1);
        d.goal = d.patrol;
      }
    }
    const gd = this.bfs([d.goal], d.goalDist);
    let nxt = d.wp, nd = gd[d.wp] < 0 ? 999 : gd[d.wp];
    const nb = this.nbr[d.wp];
    for (let k = 0; k < nb.length; k++) {
      const v = gd[nb[k]];
      if (v >= 0 && v < nd) { nd = v; nxt = nb[k]; }
    }
    d.wp = nxt;
  }

  /** Multi-source distance field from the drones (read by the bots). */
  _computeDanger() {
    const src = this._dangerSrc;
    src.length = 0;
    for (const d of this.drones) if (d.active) { src.push(this.cellAt(d.x, d.z)); src.push(d.wp); }
    if (src.length) this.bfs(src, this.danger); else this.danger.fill(-1);
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    this.drones[0].idle = 2;
    this._computeDanger();
    this.hud.banner('DRONE ONLINE', 1200, 'danger');
    Audio.sfx('sonar', { vol: 0.5 });
    this.hud.prompt('{MOVE} crawl · {B} shove · stand still to stay quiet');
    setTimeout(() => this.hud.prompt(null), 4500);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    this._animate(dt);
  }

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    if (playing) this._play(dt);
    this._animate(dt);
  }

  _play(dt) {
    for (const seat of this.seats) if (seat.alive) seat.actor.data.loudT = Math.max(0, seat.actor.data.loudT - dt);

    if (!this.drones[1].active && this.time >= SECOND_AT) this._deploySecond();
    if (!this.overclocked && this.time >= OVERCLOCK_AT) {
      this.overclocked = true;
      this.droneMul = OVERCLOCK_MUL;
      this.hearMove = HEAR_MOVE + 2;
      this.hud.banner('DRONES OVERCLOCKED', 1300, 'danger');
      Audio.sfx('grind', { vol: 0.5 });
    }

    for (const d of this.drones) this._updateDrone(d, dt);

    // Drone contact.
    for (const d of this.drones) {
      if (!d.active || d.warm > 0) continue;
      for (const seat of this.seats) {
        if (!seat.alive) continue;
        const a = seat.actor;
        const dx = a.pos.x - d.x, dz = a.pos.z - d.z;
        if (dx * dx + dz * dz < KILL_R * KILL_R) {
          this.fx.sparks(new THREE.Vector3(d.x, DRONE_Y - 0.15, d.z), { color: 0xff3a2a, count: 10 });
          this.kill(seat, 'shot', { dir: new THREE.Vector3(dx, 0, dz) });
          d.flash = 0.25;
          d.target = null;
          d.memory = 0;
        }
      }
    }

    // Chip pickups.
    let left = 0;
    for (const ch of this.chips) {
      if (!ch.active) continue;
      const x = cx(ch.cell), z = cz(ch.cell);
      for (const seat of this.seats) {
        if (!seat.alive) continue;
        const a = seat.actor;
        const dx = a.pos.x - x, dz = a.pos.z - z;
        if (dx * dx + dz * dz < PICK_R2) {
          ch.active = false;
          ch.g.visible = false;
          seat.score++;
          a.data.loudT = LOUD_T;
          Audio.sfx('select', { vol: 0.6 });
          this.fx.sparks(new THREE.Vector3(x, 0.4, z), { color: 0x5aff7a, count: 8, speed: 3 });
          break;
        }
      }
      if (ch.active) left++;
    }
    if (left <= CHIP_LOW && this._spawnChips(this.chipTarget) > 0) {
      this.hud.banner('NEW CHIPS DETECTED', 1000);
      Audio.sfx('beep', { vol: 0.4 });
    }

    this._computeDanger();

    // HUD
    for (const seat of this.seats) {
      this.hud.setStat(seat, `CHIPS ${seat.score}`);
      if (!seat.alive) { this.hud.setStatus(seat, 'NEUTRALIZED'); continue; }
      let heard = false;
      for (const d of this.drones) if (d.active && d.target === seat) heard = true;
      const a = seat.actor;
      const still = Math.hypot(a.vel.x, a.vel.z) <= STILL_SPEED && a.data.loudT <= 0;
      this.hud.setStatus(seat, heard ? 'HEARD' : still ? 'QUIET' : '');
    }
    this.hud.setTimer(Math.max(0, ROUND_TIME - this.time));

    // Ending
    if (this.time >= ROUND_TIME) { this.hud.banner('TIME UP', 1500); Audio.sfx('buzz'); this.end(2.4); return; }
    if (this.aliveSeats.length === 0) { this.hud.banner('VENTS CLEARED', 1500, 'danger'); this.end(2.4); return; }
    this.checkLastStanding();
  }

  /** Purely cosmetic animation (chips, drones, lamp flicker). */
  _animate(dt) {
    for (const ch of this.chips) {
      if (!ch.active) continue;
      ch.pop = Math.min(1, ch.pop + dt * 3);
      ch.g.scale.setScalar(ch.pop);
      ch.g.rotation.y += dt * 1.6;
      ch.g.position.y = 0.32 + Math.sin(this.clock * 3 + ch.phase) * 0.05;
    }
    for (const d of this.drones) {
      if (!d.active) { d.light.intensity = 0; continue; }
      d.bob += dt * 3;
      const y = DRONE_Y + Math.sin(d.bob) * 0.06 + (d.warm > 0 ? d.warm * 5 : 0);
      d.g.position.set(d.x, y, d.z);
      d.yaw += angleDiff(d.yaw, d.heading) * Math.min(1, dt * 8);
      d.g.rotation.y = d.yaw;
      for (const r of d.rotors) r.rotation.y += dt * 40;
      const hot = d.target ? 1 : 0;
      d.scan += dt * (hot ? 6 : 2.2);
      const sweep = Math.sin(d.scan) * (hot ? 0.25 : 0.7);
      d.pivot.rotation.y = sweep;
      const ang = d.yaw + sweep;
      d.spot.position.set(d.x + Math.sin(ang) * 0.7, 0.025, d.z + Math.cos(ang) * 0.7);
      d.spot.visible = d.warm <= 0;
      d.coneMat.opacity = 0.12 + hot * 0.1;
      d.spotMat.opacity = 0.22 + hot * 0.22;
      d.flash = Math.max(0, d.flash - dt);
      d.light.intensity = (d.warm > 0 ? 1 : 3) + hot * 2 + d.flash * 30;
      const blink = hot ? (d.scan % 1) < 0.5 : true;
      d.eyeMat.color.setHex(blink ? 0xff2010 : 0x4a0806);
    }
    const fl = this.lamps[2];
    fl.light.intensity = 22 * (0.8 + 0.2 * Math.sin(this.clock * 23) * Math.sin(this.clock * 7.3));
  }

  // ------------------------------------------------------------- placement

  /** The living by chips, then the dead by chips (later death breaks ties). */
  placement() {
    const alive = this.seats.filter((s) => s.alive).sort((a, b) => b.score - a.score);
    const dead = this.seats.filter((s) => !s.alive).sort((a, b) => (b.score - a.score) || (b.deathTime - a.deathTime));
    return [...groupBy(alive, (s) => s.score), ...groupBy(dead, (s) => `${s.score}|${s.deathTime.toFixed(3)}`)];
  }

  // ------------------------------------------------------------------ bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    if (mem.next === undefined) { mem.next = -1; mem.t = 0; mem.mode = 'chip'; mem.bPrev = false; }
    const my = this.cellAt(a.pos.x, a.pos.z);
    const avoidR = Math.floor(1 + brain.difficulty * 2.4); // 1 / 2 / 3 cells of look-ahead
    mem.t -= dt;
    const adjacent = mem.next === my || this.nbr[my].includes(mem.next);
    // Replan on arrival, when knocked off course, or every reaction interval (hiding bots
    // only re-check on the interval so they actually stay still).
    const arrived = my === mem.next && mem.mode !== 'hide';
    if (mem.next < 0 || arrived || !adjacent || mem.t <= 0) this._botPlan(seat, my, avoidR);

    if (mem.next === my) steerTo(a, cx(my), cz(my), { arrive: mem.mode === 'hide' ? 0.3 : 0.05, slow: 0.6 });
    else this._steerCell(a, my, mem.next);

    // Opportunistic shove at a rival right in front.
    let wantB = false;
    if (mem.mode !== 'hide') {
      for (const o of this.seats) {
        if (o === seat || !o.alive) continue;
        const dx = o.actor.pos.x - a.pos.x, dz = o.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.15 && d > 0.01 && (dx * Math.sin(a.facing) + dz * Math.cos(a.facing)) / d > 0.6 && random() < 0.03 * brain.difficulty) wantB = true;
      }
    }
    a.ctrl.setButtons(false, wantB && !mem.bPrev);
    mem.bPrev = wantB && !mem.bPrev;
  }

  _dg(i) { const v = this.danger[i]; return v < 0 ? 99 : v; }

  /** Decide the next cell: flee if a drone is close, else the nearest chip on a safe path, else hide. */
  _botPlan(seat, my, avoidR) {
    const brain = seat.brain, mem = brain.memory;
    mem.t = 0.2 + brain.reaction;
    const careless = random() < brain.error * 0.3; // occasional blunder: ignores the drones for one step
    const here = this._dg(my);
    if (here <= avoidR && !careless) { this._botFlee(seat, my, here); return; }
    const dist = this._botDist, par = this._botPar;
    this.bfs([my], dist, careless ? null : (n) => this._dg(n) <= avoidR, par);
    let best = -1, bd = 999;
    for (const ch of this.chips) {
      if (!ch.active) continue;
      const d = dist[ch.cell];
      if (d >= 0 && d < bd) { bd = d; best = ch.cell; }
    }
    if (best < 0) { mem.mode = 'hide'; mem.next = my; return; } // no safe chip: keep still and quiet
    mem.mode = 'chip';
    mem.next = this._firstStep(par, my, best);
  }

  /** Run to the safest reachable cell nearby, never stepping closer to a drone, avoiding dead ends. */
  _botFlee(seat, my, here) {
    const mem = seat.brain.memory;
    const dist = this._botDist, par = this._botPar;
    this.bfs([my], dist, here > 0 ? (n) => this._dg(n) < here : null, par);
    let best = my, bs = -1e9;
    for (let i = 0; i < N; i++) {
      const d = dist[i];
      if (d < 0 || d > 6) continue;
      let s = Math.min(this._dg(i), 8) * 2 - d * 0.5;
      if (this.nbr[i].length === 1) s -= 3; // dead ends are coffins
      if (s > bs) { bs = s; best = i; }
    }
    mem.mode = 'flee';
    mem.next = this._firstStep(par, my, best);
  }

  /** Steer from cell `from` into the adjacent cell `to`, keeping to the duct's centre line. */
  _steerCell(a, from, to) {
    let mx, mz;
    if (from % COLS !== to % COLS) {
      mx = Math.sign(cx(to) - a.pos.x);
      const off = cz(from) - a.pos.z;
      mz = clamp(off * 3, -1, 1);
      if (Math.abs(off) > 0.22) mx *= 0.35;
    } else {
      mz = Math.sign(cz(to) - a.pos.z);
      const off = cx(from) - a.pos.x;
      mx = clamp(off * 3, -1, 1);
      if (Math.abs(off) > 0.22) mz *= 0.35;
    }
    const len = Math.hypot(mx, mz) || 1;
    a.ctrl.setMove(mx / len, mz / len);
  }
}

/** Floor vent grille (cosmetic texture; cached). */
function ventTexture() {
  return canvasTexture('ventcrawlGrille', 64, (c, s) => {
    c.fillStyle = '#161716';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#4b4e4a';
    for (let y = 6; y < s - 4; y += 8) c.fillRect(5, y, s - 10, 3);
    c.strokeStyle = '#61645f';
    c.lineWidth = 4;
    c.strokeRect(2, 2, s - 4, s - 4);
    const img = c.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 24;
      img.data[i] += n + 4; img.data[i + 1] += n; img.data[i + 2] += n - 3;
    }
    c.putImageData(img, 0, 0);
  });
}
