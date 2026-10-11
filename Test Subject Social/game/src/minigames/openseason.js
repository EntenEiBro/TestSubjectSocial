/**
 * OPEN SEASON — rotating hunter vs. runners in a long walled courtyard.
 *
 * Rules:
 *  - The round is split into N sub-rounds (N = number of players). In each,
 *    one player is the HUNTER (in a sniper nest behind the camera) and every
 *    other player is a RUNNER.
 *  - Runners start at the far end of the courtyard and must reach the green
 *    exit strip near the nest. Crates, barriers and pillars provide cover.
 *    B = shove / forward dive.
 *  - The hunter steers a swaying crosshair with the stick and fires with A
 *    (bolt action, 1.2 s between shots). Shots are raycast from the camera:
 *    skull = instant kill, body = wounded (55 % speed, blood trail), a second
 *    body hit kills. Cover blocks shots.
 *  - A sub-round ends when every runner is dead or out, or after 30 s.
 *  - Points: runner escapes +2, hunter +1 per kill. Everyone returns for the
 *    next sub-round, so deaths here are per-sub-round avatars (fx only, not
 *    this.kill()). Final ranking: tiers by total points.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh } from '../core/environment.js';
import { Tex, mat, glow, textTexture } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { clamp, damp } from '../core/util.js';
import { rand, pick, random } from '../core/rng.js';

const HALF_W = 7;           // courtyard half-width
const FAR_Z = -22;          // far wall
const START_Z = -19;        // runner start line
const EXIT_Z = 4.5;         // crossing this line = escaped
const SUB_TIME = 30;
const INTRO = 2.4, OUTRO = 2.4;
const FIRE_CD = 1.2;
const CROSS_SPEED = 1.25;   // NDC units / second (vertical); horizontal scaled by aspect
const ASPECT = 16 / 9;
const RUN_MUL = 0.85;       // runner base speed multiplier
const WOUND_MUL = 0.55;

/** Cover layout: [x, z, w, d, h, kind]. Rows are derived from z. */
const COVER = [
  [-4.4, -14.0, 1.2, 1.2, 2.4, 'stack'],
  [0.6, -13.6, 2.6, 0.6, 1.0, 'barrier'],
  [4.6, -14.6, 0.9, 0.9, 3.2, 'pillar'],
  [-1.8, -9.2, 0.9, 0.9, 3.2, 'pillar'],
  [2.8, -9.4, 1.2, 1.2, 1.2, 'crate'],
  [-5.3, -8.8, 1.2, 1.2, 1.2, 'crate'],
  [-3.4, -4.6, 2.6, 0.6, 1.0, 'barrier'],
  [1.4, -4.2, 1.2, 1.2, 2.4, 'stack'],
  [5.3, -5.0, 1.2, 1.2, 1.2, 'crate'],
  [-1.2, 0.0, 1.2, 1.2, 1.2, 'crate'],
  [3.4, -0.6, 0.9, 0.9, 3.2, 'pillar'],
  [-5.4, 0.4, 1.2, 1.2, 2.4, 'stack'],
];
const rowOf = (z) => (z < -12 ? 0 : z < -7 ? 1 : z < -2.5 ? 2 : 3);

export class OpenSeason extends Minigame {
  static meta = {
    id: 'openseason',
    title: 'OPEN SEASON',
    tagline: 'Everyone gets a turn with the rifle. Everyone gets a turn being the deer.',
    category: 'Roles',
    controls: [{ input: 'move', label: 'Run / Aim' }, { input: 'a', label: 'Fire (hunter)' }, { input: 'b', label: 'Dive / Shove (runner)' }],
    objective: 'Score the most points: escape as a runner, drop runners as the hunter.',
    rules: [
      'Each player hunts once from the nest while the others run for the green exit.',
      'Headshots kill instantly. A body hit wounds; a second one finishes the job.',
      'Cover blocks bullets. Escaping scores +2, every kill scores the hunter +1.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 26, fogFar: 72 });
    this.makeCamera([0, 7, 13], [0, 0, -7], 52);
    scene.add(this.camera); // the rifle model hangs off the camera

    this.blockers = []; // meshes that stop bullets (cover, walls, floor)
    const len = EXIT_Z + 3 - FAR_Z;
    const midZ = (EXIT_Z + 3 + FAR_Z) / 2;
    const ground = floor(scene, HALF_W * 2 + 8, len + 14, { tex: 'concrete', tile: 3, z: midZ + 3 });
    this.blockers.push(ground);
    floor(scene, HALF_W * 2, len, { tex: 'tiles', tile: 1.6, y: 0.004, z: midZ });

    // Courtyard walls
    const wallMat = mat(0xffffff, Tex.wall([len / 4, 1]));
    const farMat = mat(0xffffff, Tex.wall([HALF_W / 2, 1.5]));
    this.blockers.push(
      block(scene, -HALF_W - 0.2, 2, midZ, 0.4, 4, len, wallMat),
      block(scene, HALF_W + 0.2, 2, midZ, 0.4, 4, len, wallMat),
      block(scene, 0, 3, FAR_Z - 0.2, HALF_W * 2 + 0.8, 6, 0.4, farMat),
    );
    stencil(scene, 'RUN', 0, 3.4, FAR_Z + 0.02, { w: 7, h: 2.6, opacity: 0.6 });
    stencil(scene, 'NO LOITERING', -HALF_W + 0.03, 2.4, -10, { w: 5, h: 1.2, rotY: Math.PI / 2, opacity: 0.4 });
    hazardStrip(scene, 0, START_Z + 1.2, HALF_W * 2, 0.35, 0.01);

    // Exit strip + gate posts with signs
    const exitGlow = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.6), new THREE.MeshBasicMaterial({ color: 0x39ff5a, transparent: true, opacity: 0.28, depthWrite: false }));
    exitGlow.rotation.x = -Math.PI / 2;
    exitGlow.position.set(0, 0.015, EXIT_Z + 0.8);
    scene.add(exitGlow);
    this.exitGlow = exitGlow;
    for (const side of [-1, 1]) {
      block(scene, side * (HALF_W - 0.3), 1.5, EXIT_Z, 0.5, 3, 0.5, mat(0x5a5d58, Tex.plate()));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45), new THREE.MeshBasicMaterial({ map: textTexture('EXIT', { w: 128, h: 64, size: 46, color: '#39ff5a', bg: '#0a1a0a' }) }));
      sign.position.set(side * (HALF_W - 0.3), 2.5, EXIT_Z + 0.26);
      scene.add(sign);
    }
    // Sandbag lip of the sniper nest along the bottom of the frame
    const bagMat = mat(0x7a6a48, Tex.fabric());
    for (let i = -4; i <= 4; i++) {
      const b = mesh(new THREE.BoxGeometry(1.0, 0.4, 0.6), bagMat, i * 0.95, 4.35 + (i % 2) * 0.05, 10.7, { cast: false });
      b.rotation.y = rand(-0.1, 0.1);
      scene.add(b);
    }
    block(scene, 0, 2.1, 10.9, 9, 4.2, 0.6, mat(0x55524a, Tex.concrete()));

    // Lighting along the courtyard
    for (const z of [-18, -11, -4, 2.5]) hangingLamp(scene, 0, 6, z, { intensity: 75, angle: 1.0, distance: 26 });

    // Cover + collision
    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: FAR_Z + 0.4, maxZ: EXIT_Z + 2.5 }, shoveForce: 10 });
    this.cover = COVER.map(([x, z, w, d, h, kind]) => {
      this._buildCover(scene, x, z, w, d, h, kind);
      this.arena.addWall(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
      return { x, z, w, d, h, row: rowOf(z) };
    });

    this._buildRifle();
    this._buildCrosshair();

    this.ray = new THREE.Raycaster();
    this.ray.far = 80;
    this.cross = { x: 0, y: 0.05 };
    this.cool = 0;
    this.boltT = 0;
    this.leaving = [];
    this.tracers = [];
    // Tracers clone this material; the hidden template lets prewarm() compile its shader.
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    const template = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), this.tracerMat);
    template.visible = false;
    this.scene.add(template);
    this.swayT = 0;
    for (const seat of this.seats) seat.os = { points: 0, kills: 0, escapes: 0, wounded: false, down: false, escaped: false, meshes: [], trailT: 0 };
    this._setupSub(0);
  }

  // ------------------------------------------------------------------ stage

  _buildCover(scene, x, z, w, d, h, kind) {
    const add = (m) => { scene.add(m); this.blockers.push(m); return m; };
    if (kind === 'crate' || kind === 'stack') {
      const crateMat = mat(0xffffff, Tex.crate());
      const s = h > 1.5 ? h / 2 : h;
      add(mesh(new THREE.BoxGeometry(w, s, d), crateMat, x, s / 2, z));
      if (kind === 'stack') add(mesh(new THREE.BoxGeometry(w * 0.9, s, d * 0.9), crateMat, x + 0.05, s * 1.5, z - 0.03)).rotation.y = 0.12;
    } else if (kind === 'pillar') {
      add(mesh(new THREE.BoxGeometry(w, h, d), mat(0x8a877e, Tex.concrete()), x, h / 2, z));
      add(mesh(new THREE.BoxGeometry(w + 0.04, 0.4, d + 0.04), mat(0xffffff, Tex.hazard()), x, 0.5, z));
    } else { // barrier: tapered concrete block
      const c = mat(0x9a968c, Tex.concrete());
      add(mesh(new THREE.BoxGeometry(w, h * 0.45, d), c, x, h * 0.225, z));
      add(mesh(new THREE.BoxGeometry(w, h * 0.55, d * 0.55), c, x, h * 0.45 + h * 0.275, z));
    }
  }

  /** Bolt-action rifle hanging in the lower right of the hunter's view. */
  _buildRifle() {
    const g = new THREE.Group();
    const wood = mat(0xffffff, Tex.wood());
    const steel = mat(0x6a6e6c, Tex.metal());
    const add = (geo, m, x, y, z, rx = 0) => { const o = mesh(geo, m, x, y, z, { cast: false, receive: false }); o.rotation.x = rx; g.add(o); return o; };
    add(new THREE.BoxGeometry(0.09, 0.13, 0.55), wood, 0, -0.02, 0.18);
    add(new THREE.BoxGeometry(0.07, 0.08, 0.34), steel, 0, 0.02, -0.22);
    add(new THREE.CylinderGeometry(0.018, 0.02, 0.8, 6), steel, 0, 0.03, -0.75, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.036, 0.036, 0.34, 8), steel, 0, 0.11, -0.22, Math.PI / 2);
    add(new THREE.BoxGeometry(0.02, 0.06, 0.02), steel, 0.05, 0.04, -0.12);
    this.rifleBand = add(new THREE.BoxGeometry(0.095, 0.035, 0.08), glow(0xffffff), 0, 0.03, 0.02);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.03, -1.16);
    g.add(this.muzzle);
    g.position.set(0.36, -0.3, -0.6);
    g.scale.setScalar(0.62);
    this.camera.add(g);
    this.rifle = g;
    this.recoil = 0;
  }

  /** DOM reticle drawn inside the HUD root (removed in dispose()). */
  _buildCrosshair() {
    const el = document.createElement('div');
    el.className = 'os-crosshair';
    el.style.cssText = 'position:absolute;left:50%;top:50%;width:calc(var(--u)*8);height:calc(var(--u)*8);transform:translate(-50%,-50%);pointer-events:none;filter:drop-shadow(0 0 2px #000);transition:opacity .12s;color:#fff;';
    el.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="4"><circle cx="50" cy="50" r="28"/><path d="M50 2v32M50 66v32M2 50h32M66 50h32"/><circle cx="50" cy="50" r="3" fill="currentColor" stroke="none"/></svg>';
    this.hud.root.appendChild(el);
    this.crossEl = el;
  }

  dispose() {
    if (this.crossEl) this.crossEl.remove();
    super.dispose();
  }

  // ------------------------------------------------------------ sub-rounds

  /** Rebuild avatars for sub-round `i` (hunter = seat i). */
  _setupSub(i) {
    for (const seat of this.seats) {
      this._removeAvatar(seat);
      Object.assign(seat.os, { wounded: false, down: false, escaped: false, trailT: 0, meshes: [] });
    }
    this.arena.actors = [];
    const hunter = this.seats[i];
    this.sub = { index: i, hunter, phase: 'intro', t: 0 };
    const runners = this.seats.filter((s) => s !== hunter);
    runners.forEach((seat, k) => {
      const x = (k - (runners.length - 1) / 2) * 2.6;
      const z = START_Z;
      const s = this.spawnSubject(seat, { x, z, facing: 0 });
      const actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: s, x, z }));
      actor.facing = 0;
      actor.speedMul = RUN_MUL;
      actor.seat = seat;
      seat.actor = actor;
      // Hit zones: anything under the head group is "head", the rest "body".
      seat.os.meshes = [];
      const headSet = new Set();
      s.parts.head.traverse((o) => headSet.add(o));
      s.root.traverse((o) => {
        if (!o.isMesh || o === s.ring) return;
        o.userData.osSeat = seat;
        o.userData.osZone = headSet.has(o) ? 'head' : 'body';
        seat.os.meshes.push(o);
      });
      seat.brain.memory = {};
    });
    hunter.subject = null;
    hunter.actor = null;
    hunter.tagTarget = null;
    hunter.brain.memory = {};
    this.cross.x = 0; this.cross.y = 0.05;
    this.cool = 0.4;
    this.rifleBand.material.color.set(hunter.player.color);
    this.crossEl.style.color = hunter.player.color;
  }

  /** Remove a living avatar from the previous sub-round (corpses stay). */
  _removeAvatar(seat) {
    const s = seat.subject;
    if (s && !seat.os.down && !seat.os.escaped) { this.scene.remove(s.root); s.dispose(); }
    seat.subject = null;
    seat.actor = null;
    seat.tagTarget = null;
  }

  _announceSub() {
    const h = this.sub.hunter;
    this.hud.banner(`${h.player.name} HAS THE RIFLE`, 2000, 'danger');
    this.hud.feed(`ROUND ${this.sub.index + 1}/${this.seats.length} — HUNTER: ${h.player.name}`, h.player.color);
    const human = !h.isBot ? 'Hunter: {MOVE} aims, {A} fires' : 'Runners: reach the green exit, {B} dives';
    this.hud.prompt(human);
    Audio.sfx('reload');
  }

  _activeRunners() {
    return this.seats.filter((s) => s !== this.sub.hunter && s.actor && s.actor.alive && !s.os.down && !s.os.escaped);
  }

  start() { this._announceSub(); }

  preview(dt) {
    for (const s of this.seats) if (s.subject && s.actor) s.subject.animate(dt, 0);
    this.swayT += dt;
  }

  update(dt) {
    this._updateFx(dt);
    if (this.state !== 'play') { this.arena.step(dt, false); this._placeCrosshair(false); return; }
    const sub = this.sub;
    sub.t += dt;
    this.swayT += dt;
    this.cool = Math.max(0, this.cool - dt);
    if (this.boltT > 0) { this.boltT -= dt; if (this.boltT <= 0) Audio.sfx('reload'); }
    this._moveCrosshair(dt, sub.phase !== 'outro');

    if (sub.phase === 'intro') {
      this.arena.step(dt, false);
      if (sub.t >= INTRO) { sub.phase = 'run'; sub.t = 0; Audio.sfx('go'); this.hud.banner('RUN', 800); this.hud.prompt(null); }
    } else if (sub.phase === 'run') {
      this._stepRunners(dt);
      const h = sub.hunter;
      if (h.ctrl.aPressed && this.cool <= 0) this._fire(h);
      if (!this._activeRunners().length || sub.t >= SUB_TIME) this._endSub();
    } else {
      this.arena.step(dt, false);
      if (sub.t >= OUTRO) {
        if (sub.index + 1 < this.seats.length) { this._setupSub(sub.index + 1); this._announceSub(); } else this._finish();
      }
    }
    this._hudUpdate();
  }

  /** Runner movement, dives, wound trails and escapes. */
  _stepRunners(dt) {
    const runners = this._activeRunners();
    const dives = runners.filter((s) => s.actor.stun <= 0 && s.ctrl.bPressed && s.actor.shoveCd <= 0);
    this.arena.step(dt, true);
    for (const s of dives) s.actor.knock.addScaledVector(s.actor.forward, 6.5);
    for (const s of runners) {
      const a = s.actor;
      if (s.os.wounded) {
        s.subject.root.rotation.z = Math.sin(this.time * 9) * 0.12;
        s.os.trailT -= dt;
        if (s.os.trailT <= 0) { s.os.trailT = 0.3; this.fx.pool(a.pos.x, a.pos.z, 0.35); }
      }
      if (a.pos.z > EXIT_Z) this._escape(s);
    }
  }

  _escape(seat) {
    seat.os.escaped = true;
    seat.os.points += 2;
    seat.os.escapes++;
    seat.actor.alive = false;
    seat.tagTarget = null;
    if (seat.subject.ring) seat.subject.ring.visible = false;
    this.leaving.push({ s: seat.subject, t: 0 });
    Audio.sfx('ding');
    this.hud.feed(`${seat.player.name} ESCAPED +2`, seat.player.color);
  }

  _endSub() {
    const sub = this.sub;
    sub.phase = 'outro';
    sub.t = 0;
    const kills = this.seats.filter((s) => s !== sub.hunter && s.os.down).length;
    const out = this.seats.filter((s) => s !== sub.hunter && s.os.escaped).length;
    this.hud.banner(`${kills} DOWN · ${out} OUT`, 2000, kills ? 'danger' : 'good');
    Audio.sfx(kills ? 'sting' : 'beep', { vol: 0.5 });
  }

  _finish() {
    for (const s of this.seats) { s.alive = true; s.score = s.os.points; }
    const sorted = this.seats.slice().sort((a, b) => b.os.points - a.os.points);
    this.finalTiers = groupBy(sorted, (s) => s.os.points);
    this.hud.banner('SEASON CLOSED', 2000);
    this.crossEl.style.opacity = '0';
    this.end(2.2, this.finalTiers);
  }

  placement() {
    return this.finalTiers || groupBy(this.seats.slice().sort((a, b) => b.os.points - a.os.points), (s) => s.os.points);
  }

  // ---------------------------------------------------------------- the rifle

  /** Crosshair position including breathing sway (NDC). */
  _crossPos() {
    const t = this.swayT;
    return {
      x: clamp(this.cross.x + Math.sin(t * 1.3) * 0.006 + Math.sin(t * 3.1) * 0.003, -0.98, 0.98),
      y: clamp(this.cross.y + Math.cos(t * 1.1) * 0.008 + Math.sin(t * 2.7) * 0.003, -0.98, 0.98),
    };
  }

  _moveCrosshair(dt, active) {
    const c = this.sub.hunter.ctrl;
    if (active) {
      this.cross.x = clamp(this.cross.x + c.moveX * CROSS_SPEED * dt / ASPECT, -0.97, 0.97);
      this.cross.y = clamp(this.cross.y - c.moveY * CROSS_SPEED * dt, -0.97, 0.97);
    }
    this._placeCrosshair(active);
  }

  _placeCrosshair(active) {
    const p = this._crossPos();
    this.crossEl.style.left = `${((p.x + 1) / 2) * 100}%`;
    this.crossEl.style.top = `${((1 - p.y) / 2) * 100}%`;
    this.crossEl.style.opacity = !active ? '0.25' : this.cool > 0 ? '0.4' : '1';
    this.rifle.rotation.y = -p.x * 0.45;
    this.rifle.rotation.x = p.y * 0.3;
  }

  /** Meshes a shot can hit, nearest first after raycasting. */
  _rayHit(x, y) {
    const list = this.blockers.slice();
    for (const s of this._activeRunners()) list.push(...s.os.meshes);
    // World matrices are normally refreshed by the renderer; make sure they are
    // current even if logic runs ahead of rendering.
    this.scene.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits = this.ray.intersectObjects(list, false);
    return hits[0] || null;
  }

  _fire(hunter) {
    this.cool = FIRE_CD;
    this.boltT = 0.5;
    this.recoil = 1;
    const p = this._crossPos();
    const hit = this._rayHit(p.x, p.y);
    Audio.sfx('shot');
    this.engine.shake(0.2);
    const from = new THREE.Vector3();
    this.muzzle.getWorldPosition(from);
    this.fx.sparks(from, { count: 4, speed: 2, color: 0xffe08a });
    const to = hit ? hit.point.clone() : from.clone().add(this.ray.ray.direction.clone().multiplyScalar(60));
    this._tracer(from, to);
    if (!hit) return;
    const victim = hit.object.userData.osSeat;
    const dir = this.ray.ray.direction.clone();
    if (!victim) {
      this.fx.smoke(hit.point, { size: 0.18, life: 0.7, color: 0x8a8270, rise: 0.6 });
      this.fx.sparks(hit.point, { count: 5, speed: 3 });
      return;
    }
    if (hit.object.userData.osZone === 'head') {
      this._down(victim, hunter, dir, true);
    } else if (victim.os.wounded) {
      this._down(victim, hunter, dir, false);
    } else {
      victim.os.wounded = true;
      victim.actor.speedMul = RUN_MUL * WOUND_MUL;
      victim.actor.stun = 0.25;
      this.fx.spray(hit.point, 14, { dir, speed: 4 });
      Audio.sfx('splat', { vol: 0.5 });
      this.hud.feed(`${victim.player.name} WOUNDED`, hunter.player.color);
    }
  }

  /** A runner is dropped for this sub-round (per-sub-round avatar, not this.kill()). */
  _down(victim, hunter, dir, headshot) {
    victim.os.down = true;
    victim.actor.alive = false;
    victim.tagTarget = null;
    if (victim.subject.ring) victim.subject.ring.visible = false;
    this.fx.kill(victim.subject, 'shot', { dir, force: headshot ? 1.3 : 1 });
    Audio.sfx('splat', { vol: 0.8 });
    this.engine.shake(0.3);
    hunter.os.points += 1;
    hunter.os.kills++;
    this.hud.feed(`${hunter.player.name} ▸ ${victim.player.name}${headshot ? ' — HEADSHOT' : ''}`, hunter.player.color);
    if (headshot) this.award(hunter, 'cleanShot');
  }

  _tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ m: line, life: 0.12 });
  }

  _updateFx(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.12);
      // (the material is not disposed: that would drop its compiled shader, recompiled on the next shot)
      if (t.life <= 0) { this.scene.remove(t.m); t.m.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      l.s.root.position.z += 4.5 * dt;
      l.s.root.rotation.y = 0;
      l.s.animate(dt, 4.5);
      if (l.t > 1.6) { this.scene.remove(l.s.root); l.s.dispose(); this.leaving.splice(i, 1); }
    }
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.rifle.position.z = -0.6 + this.recoil * 0.12;
    this.exitGlow.material.opacity = 0.2 + Math.sin(this.time * 4) * 0.08;
  }

  _hudUpdate() {
    const sub = this.sub;
    for (const s of this.seats) {
      let status = 'RUNNER';
      if (s === sub.hunter) status = 'HUNTER';
      else if (s.os.down) status = 'RUNNER · DOWN';
      else if (s.os.escaped) status = 'RUNNER · OUT';
      else if (s.os.wounded) status = 'RUNNER · WOUNDED';
      this.hud.setStatus(s, status);
      this.hud.setStat(s, `PTS ${s.os.points}`);
    }
    this.hud.setTimer(sub.phase === 'run' ? SUB_TIME - sub.t : sub.phase === 'intro' ? SUB_TIME : null);
  }

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    if (seat === this.sub.hunter) this._botHunter(seat, dt);
    else this._botRunner(seat, dt);
  }

  /**
   * Hunter bot: pick the most urgent visible runner, sweep the crosshair
   * toward head or chest with skill-dependent wobble, fire once settled.
   */
  _botHunter(seat, dt) {
    const c = seat.ctrl, brain = seat.brain, m = brain.memory, d = brain.difficulty;
    const wasA = m.lastA;
    m.lastA = false;
    c.setButtons(false, false);
    const runners = this._activeRunners();
    if (!runners.length || this.sub.phase === 'outro') { c.setMove(0, 0); return; }
    m.retarget = (m.retarget ?? 0) - dt;
    if (!m.target || !runners.includes(m.target) || m.retarget <= 0) {
      const sorted = runners.slice().sort((a, b) => b.actor.pos.z - a.actor.pos.z);
      m.target = sorted.find((s) => this._visible(s)) || sorted[0];
      m.retarget = rand(1.4, 2.4);
      m.head = random() < 0.15 + 0.35 * d;
      m.onT = 0;
    }
    const t = m.target;
    const v = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    (m.head ? t.subject.parts.skull : t.subject.parts.chest).getWorldPosition(v);
    v.project(this.camera);
    // Smoothly wandering aim error.
    const amp = 0.006 + 0.045 * (1 - d);
    m.nt = (m.nt ?? 0) - dt;
    if (m.nt <= 0) { m.ntx = rand(-1, 1) * amp; m.nty = rand(-1, 1) * amp; m.nt = rand(0.2, 0.5); }
    const k = damp(6, dt);
    m.nx = (m.nx ?? 0) + ((m.ntx ?? 0) - (m.nx ?? 0)) * k;
    m.ny = (m.ny ?? 0) + ((m.nty ?? 0) - (m.ny ?? 0)) * k;
    const cur = this._crossPos();
    const ex = v.x + m.nx - cur.x, ey = v.y + m.ny - cur.y;
    c.setMove(clamp((ex * ASPECT) / (CROSS_SPEED * 0.15), -1, 1), clamp(-ey / (CROSS_SPEED * 0.15), -1, 1));
    if (this.sub.phase !== 'run' || this.cool > 0) { m.onT = 0; return; }
    const err = Math.hypot(ex * ASPECT, ey);
    if (err < (m.head ? 0.02 : 0.035)) {
      m.onT += dt;
      if (m.onT > brain.reaction) {
        const hit = this._rayHit(cur.x, cur.y);
        const onTarget = hit && hit.object.userData.osSeat === t;
        const blocked = hit && !hit.object.userData.osSeat && hit.distance < v.distanceTo(this.camera.position);
        if (onTarget || (m.onT > brain.reaction + 0.6 && !blocked)) {
          if (!wasA) { c.setButtons(true, false); m.lastA = true; }
          m.onT = 0;
          m.head = random() < 0.15 + 0.35 * d;
        } else if (m.onT > 1.2) { m.retarget = 0; }
      }
    } else m.onT = Math.max(0, m.onT - dt);
  }

  /** Line-of-sight from the nest to a runner's chest. */
  _visible(seat) {
    const v = new THREE.Vector3();
    seat.subject.parts.chest.getWorldPosition(v);
    v.project(this.camera);
    const hit = this._rayHit(v.x, v.y);
    return !!hit && hit.object.userData.osSeat === seat;
  }

  /** Runner bot: hop between cover pieces row by row, then sprint for the exit. */
  _botRunner(seat, dt) {
    const a = seat.actor, c = seat.ctrl, brain = seat.brain, m = brain.memory;
    c.setButtons(false, false);
    if (!a || !a.alive || this.sub.phase !== 'run') { c.setMove(0, 0); return; }
    if (!m.plan) { m.plan = this._makePlan(); m.step = 0; m.wait = 0; }
    if (m.wait > 0) {
      m.wait -= dt;
      c.setMove(0, 0);
      // Break cover right after the rifle fires.
      if (this.cool > 0.6 && random() < brain.difficulty * dt * 6) m.wait = 0;
      if (this.sub.t > SUB_TIME - 8) m.wait = 0;
      return;
    }
    const wp = m.plan[m.step];
    const d = this._goTo(a, m, wp.x, wp.z, dt);
    if (d < 0.5 && m.step < m.plan.length - 1) {
      m.step++;
      if (wp.cover) m.wait = rand(0.2, 1.3) * (seat.os.wounded ? 0.4 : 1);
    }
    if (d > 3 && a.shoveCd <= 0 && random() < 0.25 * dt) c.setButtons(false, true);
  }

  _makePlan() {
    const plan = [];
    for (let row = 0; row < 4; row++) {
      if (random() < 0.2) continue;
      const c = pick(this.cover.filter((cv) => cv.row === row));
      plan.push({ x: c.x + rand(-0.3, 0.3) * c.w, z: c.z - c.d / 2 - 0.6, cover: true });
    }
    plan.push({ x: rand(-HALF_W + 1.2, HALF_W - 1.2), z: EXIT_Z + 1.5, cover: false });
    return plan;
  }

  /** Steer toward a point, routing around the first blocking obstacle via its corners. */
  _goTo(a, m, x, z, dt) {
    let tx = x, tz = z;
    const goal = { x, z };
    if (!this.arena.clearLine(a.pos, goal, 0.2)) {
      const w = this._firstBlock(a.pos, goal);
      if (w) {
        const r = 0.65;
        const corners = [[w.minX - r, w.minZ - r], [w.maxX + r, w.minZ - r], [w.minX - r, w.maxZ + r], [w.maxX + r, w.maxZ + r]];
        let best = null, bc = Infinity;
        for (const [cx, cz] of corners) {
          const pt = { x: cx, z: cz };
          const near = Math.hypot(cx - a.pos.x, cz - a.pos.z);
          if (near < 0.3) continue;
          const cost = near + Math.hypot(x - cx, z - cz) + (this.arena.clearLine(a.pos, pt, 0.2) ? 0 : 50);
          if (cost < bc) { bc = cost; best = pt; }
        }
        if (best) { tx = best.x; tz = best.z; }
      }
    }
    // Stuck detection → short random sidestep.
    m.stuckT = (m.stuckT || 0) + dt;
    if (m.detourT > 0) { m.detourT -= dt; a.ctrl.setMove(m.dx, m.dz); return Math.hypot(x - a.pos.x, z - a.pos.z); }
    steerTo(a, tx, tz, { arrive: 0.1, slow: 0.3 });
    if (m.stuckT > 0.7) {
      const moved = m.lastPos ? Math.hypot(a.pos.x - m.lastPos.x, a.pos.z - m.lastPos.z) : 1;
      if (moved < 0.3 && a.stun <= 0) { const ang = rand(0, Math.PI * 2); m.dx = Math.sin(ang); m.dz = Math.cos(ang); m.detourT = 0.4; }
      m.lastPos = { x: a.pos.x, z: a.pos.z };
      m.stuckT = 0;
    }
    return Math.hypot(x - a.pos.x, z - a.pos.z);
  }

  _firstBlock(from, to) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 1; i < n; i++) {
      const x = from.x + ((to.x - from.x) * i) / n, z = from.z + ((to.z - from.z) * i) / n;
      for (const w of this.arena.walls) if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) return w;
    }
    return null;
  }
}
