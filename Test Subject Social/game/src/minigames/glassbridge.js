/**
 * GLASS PANELS — a long glass bridge across a bottomless chasm.
 *
 * Rules
 *  - The bridge is 8 rows long and two panes wide (far / near). In every row
 *    one pane is tempered (safe), the other shatters the instant a subject's
 *    centre is over it ('fall'). Nothing tells them apart.
 *  - The steel crossbeams between rows are safe to stand on, so subjects can
 *    wait between rows and switch lanes there.
 *  - Shattered panes stay gone, so everyone learns. A tempered pane that has
 *    held somebody for 0.5 s lights up green as known-safe.
 *  - Everyone starts on the safe platform at the same time and moves freely.
 *    B shoves (ideally a rival onto untested glass).
 *  - Reaching the far platform = finished (finish order ranks).
 *  - After 60 s the bridge is decommissioned: a collapse wave sweeps from the
 *    start platform to the far end and everyone not across falls.
 *  - Ranking: finishers in order, then anyone still standing (only if the round
 *    ended early), then the dead in reverse death order. The round ends as soon
 *    as at most one subject is still undecided (their place is fixed by then).
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { Haptics } from '../core/haptics.js';
import { hangingLamp } from '../core/engine.js';
import { block, mesh, stencil, hazardStrip, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { lerp } from '../core/util.js';
import { rand, random, randInt } from '../core/rng.js';

const ROWS = 8;
const PW = 1.5;                        // pane length along the bridge (X)
const GAP = 0.5;                       // walkable steel crossbeam between rows
const PITCH = PW + GAP;
const PD = 1.3;                        // pane depth = half the bridge width
const LANE_Z = [-PD / 2, PD / 2];      // centres of the far (0) and near (1) pane
const SPAN = ROWS * PW + (ROWS - 1) * GAP;
const X0 = -SPAN / 2, X1 = SPAN / 2;   // first / last glass edge
const PLAT_L = 3.4, PLAT_D = 3;        // platform length / half depth
const XS = X0 - PLAT_L, XE = X1 + PLAT_L;
const HOLD = 0.5;                      // seconds a tempered pane must hold someone to glow
const TIME_LIMIT = 60;
const WAVE = 11;                       // collapse wave speed (units/s)
const START = 'start', END = 'end', BEAM = 'beam';
const PARK = [[X1 + 1.6, -2.1], [X1 + 1.6, 2.1], [X1 + 2.7, -1.0], [X1 + 2.7, 1.0]];

const rowX = (r) => X0 + r * PITCH;                                   // near (start-side) edge of row r
const rowCX = (r) => rowX(r) + PW / 2;                                // centre of row r
const beamX = (r) => (r < 0 ? X0 - 0.5 : rowX(r) + PW + GAP / 2);   // beam after row r (-1: start edge)

export class GlassPanels extends Minigame {
  static meta = {
    id: 'glassbridge',
    title: 'GLASS PANELS',
    tagline: 'Half of it is load-bearing. Allegedly.',
    category: 'Deception',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Cross the bridge before it collapses. First across wins.',
    rules: [
      'Every row has two panes. One is tempered. The other is a formality.',
      'Broken panes stay broken. A pane that holds someone for a moment glows green.',
      'Press {B} to shove a rival onto untested glass. Science thanks them.',
      'At zero the bridge is decommissioned — with everyone still on it.',
    ],
  };

  build() {
    this.collapse = null;
    this.panels = [];
    this.rowGroups = [];
    this.fallers = [];
    this.finishCount = 0;
    this._warned = false;
    this._lastSec = null;

    const scene = this.makeScene({ fogNear: 16, fogFar: 48, floorAt: (x, z) => (this._solidAt(x, z) ? 0 : -Infinity) });
    this.makeCamera([0, 12.5, 12.5], [0, -0.8, 0.2], 46);

    this._buildChasm(scene);
    this._buildPlatforms(scene);
    this._buildBridge(scene);

    hangingLamp(scene, -9.5, 6.5, 0.3, { intensity: 55, angle: 0.8, shadow: false });
    hangingLamp(scene, -3.5, 6.8, 0.3, { intensity: 75, angle: 0.9 });
    hangingLamp(scene, 3.5, 6.8, 0.3, { intensity: 75, angle: 0.9 });
    hangingLamp(scene, 9.5, 6.5, 0.3, { intensity: 55, angle: 0.8, shadow: false });

    // Arena: one box covering both platforms; walls block the void beside the bridge.
    this.arena = new Arena({ bounds: { minX: XS, maxX: XE, minZ: -PLAT_D, maxZ: PLAT_D }, shoveForce: 12 });
    this.arena.addWall(X0, X1, PD, PLAT_D + 1);
    this.arena.addWall(X0, X1, -PLAT_D - 1, -PD);
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      const x = X0 - 1.9, z = (i - (n - 1) / 2) * 1.35;
      this.spawnSubject(seat, { x, z, facing: Math.PI / 2 });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
      seat.actor.facing = Math.PI / 2;
      seat.finishOrder = 0;
    });
    this.arena.onShove = (a, b) => { b.data.lastShover = a.seat; b.data.shovedAt = this.time; };
  }

  /** Back wall, pipes and a far-away glowing pit floor. */
  _buildChasm(scene) {
    scene.add(mesh(new THREE.PlaneGeometry(64, 36), mat(0x8c867a, Tex.concrete([10, 6])), 0, -8, -7.5, { cast: false }));
    const pit = mesh(new THREE.PlaneGeometry(64, 30), mat(0x24180f, Tex.rust([8, 4])), 0, -24, 0, { cast: false });
    pit.rotation.x = -Math.PI / 2;
    scene.add(pit);
    this.pitLight = new THREE.PointLight(0xff3a18, 45, 30, 1.2);
    this.pitLight.position.set(0, -16, 0);
    scene.add(this.pitLight);
    pipe(scene, [-30, 4.2, -7.2], [30, 4.2, -7.2], 0.22);
    pipe(scene, [-30, 3.5, -7.3], [30, 3.5, -7.3], 0.12, 0x5a3022);
    pipe(scene, [-4.5, 4.2, -7.2], [-4.5, -20, -7.2], 0.14);
    pipe(scene, [6.5, 3.5, -7.3], [6.5, -20, -7.3], 0.1, 0x5a3022);
    stencil(scene, 'TRUST THE GLASS', 0, 2.1, -7.45, { w: 8, h: 2, opacity: 0.5 });
  }

  /** Start platform (collapses at the end) and the far platform with its exit. */
  _buildPlatforms(scene) {
    const deckMat = mat(0xffffff, Tex.plate([3, 3]));
    const pillarMat = mat(0x9a948a, Tex.concrete([1, 5]));
    const deckGeo = new THREE.BoxGeometry(PLAT_L, 0.6, PLAT_D * 2);
    const pillarGeo = new THREE.BoxGeometry(1.6, 16, 1.6);

    this.startGroup = new THREE.Group();
    this.startGroup.add(mesh(deckGeo, deckMat, XS + PLAT_L / 2, -0.3, 0));
    this.startGroup.add(mesh(pillarGeo, pillarMat, XS + PLAT_L / 2, -8.6, 0));
    hazardStrip(this.startGroup, X0 - 0.25, 0, 0.5, PLAT_D * 2, 0.01);
    scene.add(this.startGroup);

    scene.add(mesh(deckGeo, deckMat, XE - PLAT_L / 2, -0.3, 0));
    scene.add(mesh(pillarGeo, pillarMat, XE - PLAT_L / 2, -8.6, 0));
    hazardStrip(scene, X1 + 0.25, 0, 0.5, PLAT_D * 2, 0.01);

    // Exit door at the back of the far platform.
    const frameMat = mat(0x3a3a36, Tex.metal());
    const dx = XE - 1.7, dz = -PLAT_D + 0.1;
    block(scene, dx - 0.85, 1.2, dz, 0.2, 2.4, 0.2, frameMat);
    block(scene, dx + 0.85, 1.2, dz, 0.2, 2.4, 0.2, frameMat);
    block(scene, dx, 2.45, dz, 1.9, 0.2, 0.2, frameMat);
    scene.add(mesh(new THREE.PlaneGeometry(1.5, 2.3), glow(0x1f6a2a), dx, 1.15, dz - 0.05, { cast: false }));
    const exitLight = new THREE.PointLight(0x40ff6a, 6, 6, 1.5);
    exitLight.position.set(dx, 1.4, dz + 0.8);
    scene.add(exitLight);
    stencil(scene, 'EXIT', dx, 3.0, dz - 0.05, { w: 1.8, h: 0.7, color: '#7dff9a', opacity: 0.85 });
  }

  /** Girders, crossbeams, railings and the 16 glass panes (one fragile per row). */
  _buildBridge(scene) {
    const steel = mat(0x6e706a, Tex.metal());
    const rustM = mat(0xffffff, Tex.rust([2, 1]));
    const beamMat = mat(0xffffff, Tex.hazard([1, 3]));
    const beamGeo = new THREE.BoxGeometry(GAP, 0.22, PD * 2 + 0.3);
    const girderGeo = new THREE.BoxGeometry(PITCH, 0.34, 0.16);
    const girderLastGeo = new THREE.BoxGeometry(PW, 0.34, 0.16);
    const cableGeo = new THREE.BoxGeometry(PITCH, 0.04, 0.04);
    const cableLastGeo = new THREE.BoxGeometry(PW, 0.04, 0.04);
    const strutGeo = new THREE.BoxGeometry(PW, 0.08, 0.08);
    const postGeo = new THREE.BoxGeometry(0.07, 1.0, 0.07);
    const paneGeo = new THREE.BoxGeometry(PW - 0.06, 0.06, PD - 0.08);
    this.glassMat = new THREE.MeshLambertMaterial({ color: 0xa8dbe6, emissive: 0x0e2c33, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    this.safeMat = new THREE.MeshLambertMaterial({ color: 0x7dff9a, emissive: 0x1f8a38, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    this.shardMat = new THREE.MeshLambertMaterial({ color: 0xbfe8f0, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    this.shardGeo = new THREE.CircleGeometry(0.2, 3);

    for (let r = 0; r < ROWS; r++) {
      const g = new THREE.Group();
      const last = r === ROWS - 1;
      const len = last ? PW : PITCH;
      for (const side of [-1, 1]) {
        const gz = side * (PD + 0.08);
        g.add(mesh(last ? girderLastGeo : girderGeo, rustM, rowX(r) + len / 2, -0.17, gz));
        g.add(mesh(postGeo, steel, rowX(r) + 0.04, 0.5, gz));
        g.add(mesh(last ? cableLastGeo : cableGeo, steel, rowX(r) + len / 2, 1.0, gz, { cast: false }));
        if (last) g.add(mesh(postGeo, steel, X1 - 0.04, 0.5, gz));
      }
      g.add(mesh(strutGeo, steel, rowCX(r), -0.1, 0, { cast: false }));
      if (!last) g.add(mesh(beamGeo, beamMat, beamX(r), -0.11, 0));
      scene.add(g);
      this.rowGroups.push(g);

      const bad = randInt(0, 1);
      for (let lane = 0; lane < 2; lane++) {
        const pane = mesh(paneGeo, this.glassMat, rowCX(r), -0.03, LANE_Z[lane], { cast: false });
        scene.add(pane);
        this.panels.push({
          row: r, lane, x: rowCX(r), z: LANE_Z[lane], fragile: lane === bad,
          broken: false, known: false, holdT: 0, provenAt: null, occ: false, mesh: pane,
        });
      }
    }
  }

  // -------------------------------------------------------------- geometry

  /** What lies under world point (x, z): START, END, BEAM or a pane object. */
  _cellAt(x, z) {
    if (x < X0) return START;
    if (x >= X1) return END;
    const local = x - X0;
    const row = Math.min(ROWS - 1, Math.floor(local / PITCH));
    if (local - row * PITCH >= PW) return BEAM;
    return this.panels[row * 2 + (z < 0 ? 0 : 1)];
  }

  /** Can something stand at (x, z) right now? */
  _solidAt(x, z) {
    if (x < XS || x > XE) return false;
    if (this.collapse && x < this.collapse.front) return false;
    const c = this._cellAt(x, z);
    if (c === START || c === END) return Math.abs(z) <= PLAT_D;
    if (Math.abs(z) > PD) return false;
    if (c === BEAM) return true;
    return !c.broken;
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    this.hud.banner('WATCH YOUR STEP', 1400);
    this.hud.prompt('{MOVE} walk · {B} shove');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 4500);
  }

  preview(dt) {
    this._animate(dt);
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  update(dt) {
    const playing = this.state === 'play';
    this._animate(dt);
    this.arena.step(dt, playing);
    if (playing && !this.collapse && this.time >= TIME_LIMIT) this._startCollapse();
    this._updateCollapse(dt);
    this._resolveFooting(dt);
    this._updateFinishers(dt);
    this._updateStats();
    if (!playing) return;

    if (!this.collapse) {
      const left = Math.max(0, TIME_LIMIT - this.time);
      this.hud.setTimer(left);
      if (!this._warned && left <= 10) {
        this._warned = true;
        Audio.sfx('horn');
        this.hud.banner('BRIDGE UNSTABLE', 1400, 'danger');
      }
      const sec = Math.ceil(left);
      if (left <= 5 && sec !== this._lastSec) { this._lastSec = sec; Audio.sfx('tick', { vol: 2 }); }
    } else this.hud.setTimer(null);

    // Done once at most one subject is undecided (their placement can no longer change).
    const pending = this.seats.filter((s) => s.alive && !s.finishOrder);
    if (pending.length <= 1 && !pending.some((s) => s.actor.falling)) { this.end(); return; }
    if (this.time > TIME_LIMIT + 10) this.end(); // safety net
  }

  /** Who stands where: shatter fragile panes, start falls, credit tempered panes. */
  _resolveFooting(dt) {
    for (const p of this.panels) p.occ = false;
    for (const seat of this.seats) {
      if (!seat.alive || seat.finishOrder) continue;
      const a = seat.actor;
      if (a.falling) {
        if (a.y < -3) this._fallKill(seat);
        continue;
      }
      const c = this._cellAt(a.pos.x, a.pos.z);
      if (c === END) {
        if (this.state === 'play' && !(this.collapse && a.pos.x < this.collapse.front)) this._finish(seat);
        if (seat.finishOrder) continue;
      } else if (typeof c === 'object' && !c.broken) {
        if (c.fragile) this._shatter(c);
        else { c.occ = true; if (c.provenAt === null) c.provenAt = this.time; }
      }
      if (!this._solidAt(a.pos.x, a.pos.z)) this._startFall(seat);
    }
    for (const p of this.panels) {
      if (p.fragile || p.broken) continue;
      if (p.occ) {
        p.holdT += dt;
        if (!p.known && p.holdT >= HOLD) {
          p.known = true;
          p.mesh.material = this.safeMat;
          Audio.sfx('ding', { vol: 0.35 });
        }
      } else p.holdT = 0;
    }
  }

  _startFall(seat) {
    const a = seat.actor;
    a.falling = true;
    a.vy = 0.6;
    seat.subject.pose = 'armsUp';
    Audio.sfx('whoosh', { vol: 1.2 });
    Haptics.forPlayer(seat.player, 'hit');
    const by = a.data.lastShover;
    a.data.fellBy = by && by !== seat && this.time - (a.data.shovedAt ?? -9) < 1.5 ? by : null;
  }

  _fallKill(seat) {
    const a = seat.actor, by = a.data.fellBy;
    if (by) this.hud.feed(`${by.player.name} volunteered ${seat.player.name}`, by.player.color);
    const dir = a.knock.lengthSq() > 0.01 ? a.knock.clone() : new THREE.Vector3(1, 0, 0);
    this.kill(seat, 'fall', { dir });
  }

  _finish(seat) {
    const a = seat.actor;
    seat.finishOrder = ++this.finishCount;
    a.frozen = true;
    a.data.park = PARK[(seat.finishOrder - 1) % PARK.length];
    a.data.cheer = 1.6;
    seat.subject.pose = 'armsUp';
    Audio.sfx('ding');
    this.hud.feed(`${seat.player.name} made it across`, seat.player.color);
  }

  /** Finished subjects stroll to a parking spot on the far platform and celebrate. */
  _updateFinishers(dt) {
    for (const seat of this.seats) {
      if (!seat.finishOrder || !seat.alive) continue;
      const a = seat.actor, [px, pz] = a.data.park;
      const dx = px - a.pos.x, dz = pz - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const v = Math.min(3, d * 4);
        a.vel.x = (dx / d) * v; a.vel.z = (dz / d) * v;
        a.facing = Math.atan2(dx, dz);
      } else a.facing = 0;
      if (a.data.cheer > 0) {
        a.data.cheer -= dt;
        if (a.data.cheer <= 0) seat.subject.pose = 'idle';
      }
    }
  }

  /** Remove a pane, throwing glass shards into the chasm. */
  _shatter(p, quiet = false) {
    if (p.broken) return;
    p.broken = true;
    p.mesh.visible = false;
    const n = quiet ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(this.shardGeo, this.shardMat);
      // Kept inside the hole so no shard comes to rest on a neighbouring pane.
      s.position.set(p.x + rand(-0.4, 0.4), -0.03, p.z + rand(-0.3, 0.3));
      s.rotation.set(rand(0, 6.28), rand(0, 6.28), 0);
      s.scale.setScalar(rand(0.6, 1.4));
      this.scene.add(s);
      this.fx.addBody(s, new THREE.Vector3(rand(-0.8, 0.8), rand(-0.5, 1), rand(-0.8, 0.8)),
        new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { bleed: false, life: 3, radius: 0.05 });
    }
    if (!quiet) {
      Audio.sfx('snap', { vol: 1.3 });
      Audio.sfx('crunch', { vol: 0.5 });
      this.fx.sparks(new THREE.Vector3(p.x, 0.05, p.z), { color: 0xd8f4ff, count: 10, speed: 4 });
      this.engine.shake(0.2);
    }
  }

  _startCollapse() {
    this.collapse = { t: 0, front: XS - 0.5, nextRow: 0, startDropped: false };
    Audio.sfx('sting');
    Audio.sfx('grind');
    this.engine.shake(0.6);
    this.hud.banner('BRIDGE DECOMMISSIONED', 1800, 'danger');
    this.hud.setTimer(null);
  }

  /** The collapse wave travels from the start platform to the far edge. */
  _updateCollapse(dt) {
    const c = this.collapse;
    if (!c) return;
    c.t += dt;
    c.front = Math.min(X1, XS - 0.5 + c.t * WAVE);
    if (!c.startDropped && c.front > XS) { c.startDropped = true; this._drop(this.startGroup); }
    while (c.nextRow < ROWS && c.front > rowCX(c.nextRow) - PW * 0.25) {
      const r = c.nextRow++;
      this._shatter(this.panels[r * 2], true);
      this._shatter(this.panels[r * 2 + 1], true);
      this._drop(this.rowGroups[r]);
      Audio.sfx('crunch', { vol: 0.5 });
    }
  }

  _drop(obj) { this.fallers.push({ obj, vy: 0, spin: rand(-0.8, 0.8) }); }

  /** Cosmetics: falling bridge parts, glass shimmer, pit glow. */
  _animate(dt) {
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      f.vy -= 18 * dt;
      f.obj.position.y += f.vy * dt;
      f.obj.rotation.x += f.spin * dt * 0.3;
      if (f.obj.position.y < -40) { f.obj.visible = false; this.fallers.splice(i, 1); }
    }
    this.glassMat.emissiveIntensity = 0.85 + Math.sin(this.clock * 1.7) * 0.15;
    this.pitLight.intensity = 40 + Math.sin(this.clock * 2.3) * 6;
  }

  _updateStats() {
    for (const seat of this.seats) {
      let s;
      if (seat.finishOrder) s = `ACROSS #${seat.finishOrder}`;
      else if (!seat.alive) s = 'FELL';
      else if (seat.actor.falling) s = 'FALLING';
      else if (seat.actor.pos.x < X0) s = 'WAITING';
      else s = 'ON BRIDGE';
      this.hud.setStat(seat, s);
    }
  }

  // ------------------------------------------------------------- placement

  /** Finishers in order, then anyone still standing (furthest first), then the dead (latest first). */
  placement() {
    const fin = this.seats.filter((s) => s.finishOrder).sort((a, b) => a.finishOrder - b.finishOrder).map((s) => [s]);
    const pend = this.seats.filter((s) => s.alive && !s.finishOrder).sort((a, b) => b.actor.pos.x - a.actor.pos.x).map((s) => [s]);
    const dead = groupBy(this.deaths.slice().reverse(), (s) => s.deathTime.toFixed(3));
    return [...fin, ...pend, ...dead];
  }

  // ------------------------------------------------------------------ bots

  /**
   * Which lane of row `r` this bot believes is safe (-1 = unknown). Bots see
   * green panes, subjects standing on glass (after their reaction time),
   * broken panes (the partner must be tempered) and the pane under their feet.
   */
  _laneKnown(seat, r, here) {
    const p0 = this.panels[r * 2], p1 = this.panels[r * 2 + 1];
    if (here === p0 && !p0.broken) return 0;
    if (here === p1 && !p1.broken) return 1;
    const react = seat.brain.reaction;
    const seen = (p) => !p.broken && (p.known || (p.provenAt !== null && this.time - p.provenAt > react));
    if (seen(p0)) return 0;
    if (seen(p1)) return 1;
    if (p0.broken && !p1.broken) return 1;
    if (p1.broken && !p0.broken) return 0;
    return -1;
  }

  /** Is (x, z) a spot this bot knows it can stand on? */
  _botSafe(seat, x, z, F) {
    const c = this._cellAt(x, z);
    if (c === START) return !this.collapse && x > XS + 0.4;
    if (c === END) return false;
    if (Math.abs(z) > PD - 0.1) return false;
    if (c === BEAM) return true;
    if (c.broken) return false;
    return c.row < F && seat.brain.memory.lanes[c.row] === c.lane;
  }

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, m = brain.memory;
    if (a.falling || seat.finishOrder) { a.ctrl.setMove(0, 0); a.ctrl.setButtons(false, false); m.bPrev = false; return; }
    if (!m.lanes) {
      m.lanes = new Array(ROWS).fill(-1);
      m.waitZ = rand(-1.1, 1.1);
      m.waitT = 0;
      m.frontier = -1;
      m.gamble = -1;
      m.huntT = 0;
      m.huntCd = rand(1, 3);
      m.holdDX = rand(-0.5, 0.5); // personal waiting spot so bots don't jostle each other sideways
    }
    const here = this._cellAt(a.pos.x, a.pos.z);

    // What do I know? F = first row without a known safe lane.
    let F = 0;
    for (; F < ROWS; F++) {
      const l = this._laneKnown(seat, F, here);
      if (l < 0) break;
      m.lanes[F] = l;
    }
    if (F !== m.frontier) {
      // Somebody (maybe me) solved a row: wait again before risking the next one.
      m.frontier = F;
      m.waitT = 0;
      m.patience = rand(lerp(0.8, 3.2, brain.difficulty), lerp(2.6, 7.5, brain.difficulty));
      m.gamble = -1;
    }
    m.waitT += dt;
    m.huntCd -= dt;
    if (m.huntT > 0) m.huntT -= dt;

    // Gamble on the frontier once patience runs out or the clock gets tight.
    if (F < ROWS && m.gamble < 0) {
      const left = TIME_LIMIT - this.time;
      const margin = lerp(7, 2.5, brain.difficulty);
      if (m.waitT > m.patience || left < (ROWS - F) * 0.9 + margin) m.gamble = random() < 0.5 ? 0 : 1;
    }
    if (F < ROWS && m.gamble >= 0) m.lanes[F] = m.gamble;
    const goal = F >= ROWS ? ROWS : (m.gamble >= 0 ? F : F - 1);

    // Navigate pane centre → beam (own lane) → switch lane on the beam → next pane.
    const z = a.pos.z;
    let tx = a.pos.x, tz = z;
    let k, onPane = false;
    if (here === START) k = -1;
    else if (here === BEAM) k = Math.floor((a.pos.x - X0) / PITCH);
    else if (here === END) k = ROWS;
    else { k = here.row; onPane = true; }
    if (k !== m.lastK) { m.lastK = k; m.sloppy = random() < brain.error * 0.35; } // clumsy bots cut corners
    if (onPane) {
      const hz = LANE_Z[here.lane];
      if (k < goal) { tx = k === ROWS - 1 ? X1 + 1.4 : beamX(k); tz = hz; }
      else { tx = rowCX(k) + m.holdDX; tz = hz * 1.2; }  // hold: own spot, outer half of the pane
    } else if (k < ROWS) {
      const next = k + 1;
      if (next > goal) {
        // Hold position behind the frontier.
        if (k < 0) { tx = X0 - 1.0 + m.holdDX * 0.8; tz = m.waitZ; }
        else if (m.lanes[k] >= 0) {
          const hz = LANE_Z[m.lanes[k]];
          if (Math.abs(z - hz) > 0.2) { tx = beamX(k); tz = hz; } else { tx = rowCX(k) + m.holdDX; tz = hz * 1.2; }
        }
      } else {
        const nz = LANE_Z[m.lanes[next]];
        if (Math.abs(z - nz) > (m.sloppy ? 0.9 : 0.2)) { tx = beamX(k); tz = nz; }
        else { tx = rowCX(next); tz = nz; }
      }
    }

    // Volunteering others: sneak up behind a rival waiting at the untested row and shove.
    let wantB = false, sx = 0, sz = 0;
    if (F < ROWS && m.gamble < 0) {
      const frontX = rowX(F);
      let victim = null, bd = 2.4;
      for (const s of this.seats) {
        if (s === seat || !s.alive || s.finishOrder) continue;
        const o = s.actor;
        if (o.falling) continue;
        const dx = o.pos.x - a.pos.x, d = Math.hypot(dx, o.pos.z - z);
        if (dx < 0.15 || d > bd) continue;
        if (o.pos.x < frontX - 2.0 || o.pos.x >= frontX) continue;
        bd = d; victim = o;
      }
      if (victim && m.huntT <= 0 && m.huntCd <= 0 && random() < Math.max(0, brain.difficulty - 0.2) * dt * 1.5) m.huntT = 2.5;
      if (victim && m.huntT > 0) {
        const hx = victim.pos.x - 0.8, hz = victim.pos.z;
        if (this._botSafe(seat, hx, hz, F) && this._botSafe(seat, (hx + a.pos.x) / 2, (hz + z) / 2, F)) {
          tx = hx; tz = hz;
          const dx = victim.pos.x - a.pos.x, dz = victim.pos.z - z, d = Math.hypot(dx, dz) || 1;
          if (d < 1.3 && dx > 0.3 && a.shoveCd <= 0 && random() < 0.35) {
            wantB = true;
            sx = dx / d; sz = dz / d;
            m.huntT = 0;
            m.huntCd = rand(2.5, 5) / (0.4 + brain.difficulty);
          }
        } else m.huntT = 0;
      }
    }

    if (wantB) {
      a.facing = Math.atan2(sx, sz);
      a.ctrl.setMove(sx * 0.3, sz * 0.3);
    } else steerTo(a, tx, tz, { arrive: 0.1, slow: 0.6 });
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    a.ctrl.setButtons(false, wantB && !m.bPrev);
    m.bPrev = wantB && !m.bPrev;
  }
}
