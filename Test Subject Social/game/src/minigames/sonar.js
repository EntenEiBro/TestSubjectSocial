/**
 * SONAR CROSSING — a muddy strip of no-man's-land seeded with invisible
 * mines, a harvester grinding up the rear and an exit gate far ahead.
 *
 * Rules
 *  - The field runs from the start line (z = 0) to the exit gate (z = -40),
 *    14 units wide, fenced with barbed wire. ~70 hidden mines are buried in
 *    it (none within 2 units of the start; a passable route always exists).
 *  - Stand still for 0.8 s and your collar emits a SONAR ping: mines within
 *    4.5 units glow red for 3 s. Everyone sees what you reveal.
 *  - Stepping on a mine: explosion, 'gib' for you and anyone within 1.4.
 *  - B shoves. Shoving rivals onto mines is encouraged.
 *  - After 12 s a field harvester (spinning bladed drum spanning the field)
 *    starts rolling forward from behind the start, accelerating. Contact is
 *    fatal. At 60 s it floors it.
 *  - Crossing the exit line = safe; finishers walk off into the dark.
 *  - Placement: finishers in arrival order, then the dead (last to die
 *    ranks highest).
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { floor, block, mesh, stencil, hazardStrip } from '../core/environment.js';
import { Tex, mat, glow, textTexture } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { rand, clamp, lerp } from '../core/util.js';

const HW = 7;                 // field half-width
const START_Z = 0, FINISH_Z = -40;
const MINE_COUNT = 70;
const MINE_TRIGGER = 0.5;     // actor centre within this of a mine sets it off
const BLAST_KILL = 1.4;
const PING_STILL = 0.8, PING_R = 4.5, REVEAL_TIME = 3;
const HARVEST_AT = 12, CAP = 60;
const HARVESTER_START_Z = 7.5, DRUM_R = 1.1;

export class SonarCrossing extends Minigame {
  static meta = {
    id: 'sonar',
    title: 'SONAR CROSSING',
    tagline: 'Stand still and listen. The harvester is not listening.',
    category: 'Hazard',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Cross the minefield and reach the exit gate.',
    rules: [
      'The mines are invisible. Stand still to send a sonar ping that reveals nearby ones.',
      'A mine takes out everyone within arm\'s reach.',
      'After 12 s the harvester starts rolling up behind you — and it speeds up.',
      'Finish order decides placement. Shoving is allowed.',
    ],
  };

  build() {
    const scene = this.makeScene({ fog: 0x0a0b0d, fogNear: 20, fogFar: 46, ambient: 0x4a5060, ambientIntensity: 1.15 });
    this.makeCamera([0, 12, 11], [0, 0, -3.5], 50);
    this.camGoal = 1.0;
    this.camZ = 1.0;

    // --- ground
    floor(scene, 60, 50, { tex: 'dirt', tile: 3, x: 0, z: -16, color: 0x8a8070 });
    floor(scene, HW * 2, 46, { tex: 'dirt', tile: 2, y: 0.004, z: -18, color: 0x6e6352 });
    for (let i = 0; i < 14; i++) {
      const p = mesh(new THREE.CircleGeometry(rand(0.5, 1.4), 9), new THREE.MeshLambertMaterial({ color: 0x1c1a14, transparent: true, opacity: 0.55, depthWrite: false }), rand(-HW + 1, HW - 1), 0.01, rand(FINISH_Z + 2, -2), { cast: false });
      p.rotation.x = -Math.PI / 2;
      p.scale.y = rand(0.5, 1);
      scene.add(p);
    }
    const startLine = mesh(new THREE.PlaneGeometry(HW * 2, 0.25), new THREE.MeshLambertMaterial({ color: 0xd8d2c0 }), 0, 0.02, START_Z, { cast: false });
    startLine.rotation.x = -Math.PI / 2;
    scene.add(startLine);
    stencil(scene, 'LISTEN', 0, 0.03, 2.0, { w: 5, h: 1.6, opacity: 0.35 }).rotation.x = -Math.PI / 2;
    hazardStrip(scene, 0, FINISH_Z, HW * 2, 0.5, 0.02);

    this._buildFences(scene);
    this._buildGate(scene);
    this._buildLights(scene);

    // --- arena + avatars
    this.arena = new Arena({ bounds: { minX: -HW, maxX: HW, minZ: FINISH_Z - 30, maxZ: 3.2 }, shoveForce: 12 });
    this.seats.forEach((seat, i) => {
      const x = (i - (this.seats.length - 1) / 2) * 3, z = 1.6;
      this.spawnSubject(seat, { x, z, facing: Math.PI });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z, speed: 4.8 }));
      seat.actor.seat = seat;
      seat.actor.facing = Math.PI;
      seat.actor.data.still = 0;
      seat.finished = false;
      seat.pinged = false;
    });
    this.arena.onShove = (att, vic) => { vic.data.lastShover = att.seat; vic.data.shovedAt = this.time; };

    this._placeMines(scene);
    this._buildHarvester(scene);
    this.pings = [];
    this.finishers = [];
    this.harvestAnnounced = false;
    this.capAnnounced = false;
  }

  // ------------------------------------------------------------------ stage

  _buildFences(scene) {
    const postMat = mat(0x5a4a38, Tex.wood());
    const wireMat = mat(0x6d6d66, Tex.metal());
    const len = 48, zc = -20;
    for (const sx of [-1, 1]) {
      const x = sx * (HW + 0.35);
      for (let z = 4; z >= FINISH_Z - 1; z -= 2.5) {
        const p = mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), postMat, x, 0.8, z);
        p.rotation.z = rand(-0.06, 0.06);
        scene.add(p);
      }
      for (const y of [0.45, 0.85, 1.25]) block(scene, x, y, zc, 0.03, 0.03, len, wireMat);
      // Barbs: little crossed spikes along the wires.
      const barbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), wireMat, 180);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < 180; i++) {
        const y = [0.45, 0.85, 1.25][i % 3];
        e.set(rand(-1, 1), 0, (i % 2 ? 0.8 : -0.8));
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x, y, 4 - (i / 180) * len), q, new THREE.Vector3(1, 1, 1));
        barbs.setMatrixAt(i, m4);
      }
      scene.add(barbs);
    }
  }

  /** Exit gate + a pitch-black tunnel that finishers disappear into. */
  _buildGate(scene) {
    const z = FINISH_Z - 0.6;
    const steel = mat(0x585c58, Tex.metal());
    block(scene, -HW - 0.4, 2, z, 0.6, 4, 0.6, steel);
    block(scene, HW + 0.4, 2, z, 0.6, 4, 0.6, steel);
    block(scene, 0, 4.2, z, HW * 2 + 1.4, 0.6, 0.6, steel);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ map: textTexture('EXIT', { w: 256, h: 80, size: 64, color: '#39ff5a', bg: '#041004', grimy: false }) }));
    sign.position.set(0, 4.2, z + 0.32);
    scene.add(sign);
    const exitLight = new THREE.PointLight(0x39ff5a, 18, 10, 1.4);
    exitLight.position.set(0, 3.5, z + 1.5);
    scene.add(exitLight);
    const dark = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.6, 4, 14), new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.BackSide }));
    dark.position.set(0, 1.99, z - 7.2);
    scene.add(dark);
  }

  _buildLights(scene) {
    this.moon = new THREE.DirectionalLight(0x8a98b8, 0.9);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const c = this.moon.shadow.camera;
    c.left = -14; c.right = 14; c.top = 14; c.bottom = -14; c.near = 1; c.far = 60;
    scene.add(this.moon, this.moon.target);
    // A watchtower searchlight that follows the pack (keeps the action readable).
    this.packLight = new THREE.PointLight(0xdfe4f0, 34, 24, 1.1);
    scene.add(this.packLight);
    // Floodlight poles along the fences.
    const poleMat = mat(0x3a3a36, Tex.metal());
    for (let i = 0, z = 2; z > FINISH_Z - 2; z -= 9, i++) {
      const sx = i % 2 ? 1 : -1;
      const x = sx * (HW + 1.4);
      block(scene, x, 3, z, 0.2, 6, 0.2, poleMat);
      block(scene, x - sx * 0.4, 6, z, 1, 0.3, 0.5, poleMat);
      scene.add(mesh(new THREE.BoxGeometry(0.7, 0.08, 0.35), glow(0xfff0c0), x - sx * 0.5, 5.83, z, { cast: false }));
      const l = new THREE.PointLight(0xffe2b0, 32, 17, 1.2);
      l.position.set(x - sx * 1.2, 5.4, z);
      scene.add(l);
    }
  }

  /**
   * Scatter mines, keeping a hidden meandering corridor clear so the field
   * is always passable, and nothing within 2 units of the start line.
   */
  _placeMines(scene) {
    const path = [];
    let px = rand(-4, 4);
    for (let z = START_Z; z >= FINISH_Z; z -= 4) { path.push([px, z]); px = clamp(px + rand(-3.5, 3.5), -HW + 1.5, HW - 1.5); }
    const distToPath = (x, z) => {
      let best = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i], [bx, bz] = path[i + 1];
        const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
        best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
      }
      return best;
    };
    this.mines = [];
    const bodyMat = mat(0x3a3c36, Tex.metal());
    const capMat = mat(0x7a2a18, Tex.rust());
    let tries = 0;
    while (this.mines.length < MINE_COUNT && tries++ < 5000) {
      const x = rand(-HW + 0.4, HW - 0.4), z = rand(FINISH_Z + 1.5, START_Z - 2);
      if (distToPath(x, z) < 1.0) continue;
      if (this.mines.some((m) => Math.hypot(m.x - x, m.z - z) < 0.9)) continue;
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 8), bodyMat, 0, 0.05, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6), capMat, 0, 0.13, 0));
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0, depthWrite: false });
      const ring = mesh(new THREE.RingGeometry(0.34, 0.5, 14), glowMat, 0, 0.03, 0, { cast: false });
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      g.position.set(x, 0, z);
      g.visible = false;
      scene.add(g);
      this.mines.push({ x, z, g, glowMat, reveal: 0, alive: true });
    }
  }

  _buildHarvester(scene) {
    const g = new THREE.Group();
    const drum = new THREE.Group();
    const steel = mat(0x8a8c86, Tex.metal());
    const blade = mat(0xb8bab2, Tex.metal());
    const core = mesh(new THREE.CylinderGeometry(DRUM_R * 0.7, DRUM_R * 0.7, HW * 2 + 0.6, 10), mat(0x5a2e1e, Tex.rust()));
    core.rotation.z = Math.PI / 2;
    drum.add(core);
    for (let i = 0; i < 9; i++) {
      const x = -HW + (i / 8) * HW * 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i * 0.4;
        const b = mesh(new THREE.BoxGeometry(0.08, 0.5, 0.35), blade, x, Math.cos(a) * DRUM_R * 0.9, Math.sin(a) * DRUM_R * 0.9);
        b.rotation.x = -a;
        drum.add(b);
      }
    }
    drum.position.y = DRUM_R;
    g.add(drum);
    // Chassis, hood over the drum, exhaust stacks, beacons.
    g.add(mesh(new THREE.BoxGeometry(HW * 2 + 1.2, 2.2, 3.2), mat(0xffffff, Tex.rust([5, 1])), 0, 1.7, 2.6));
    const hood = mesh(new THREE.BoxGeometry(HW * 2 + 1.2, 0.3, 2.4), mat(0xffffff, Tex.hazard([8, 1])), 0, DRUM_R * 2 + 0.25, 0.4);
    g.add(hood);
    g.add(mesh(new THREE.BoxGeometry(2.4, 1.4, 1.8), steel, 0, 3.4, 2.8));
    this.stacks = [];
    for (const x of [-4, 4]) {
      const s = mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.6, 6), mat(0x222222), x, 3.5, 3.4);
      g.add(s);
      this.stacks.push(s);
    }
    this.beacons = [];
    for (const x of [-HW, HW]) {
      const bm = glow(0xff9a1a);
      g.add(mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), bm, x, 3.0, 1.2, { cast: false }));
      this.beacons.push(bm);
    }
    const head = new THREE.SpotLight(0xffe0a0, 60, 22, 0.7, 0.5, 1.2);
    head.position.set(0, 3.2, 0.8);
    head.target.position.set(0, 0, -8);
    g.add(head, head.target);
    g.position.set(0, 0, HARVESTER_START_Z);
    scene.add(g);
    this.harvester = { g, drum, z: HARVESTER_START_Z, speed: 0, active: false, smokeT: 0 };
  }

  /** Front (lethal) edge of the harvester drum. */
  get harvestFront() { return this.harvester.z - DRUM_R - 0.1; }

  // ------------------------------------------------------------------ flow

  start() {
    this.hud.banner('CROSS', 1000);
    this.hud.prompt('STAND STILL TO PING SONAR');
    setTimeout(() => this.hud.prompt(null), 3500);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    this.harvester.drum.rotation.x -= dt * 2;
    this._animateBeacons();
    this._updateCamera(dt);
  }

  /** Emit a sonar pulse from a seat, revealing nearby mines for everybody. */
  ping(seat) {
    const a = seat.actor;
    seat.pinged = true;
    Audio.sfx('sonar');
    const ring = mesh(new THREE.RingGeometry(0.88, 1, 40), new THREE.MeshBasicMaterial({ color: 0x39ff5a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), a.pos.x, 0.06, a.pos.z, { cast: false });
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.2);
    this.scene.add(ring);
    this.pings.push({ ring, t: 0 });
    for (const m of this.mines) {
      if (!m.alive || Math.hypot(m.x - a.pos.x, m.z - a.pos.z) > PING_R) continue;
      m.reveal = REVEAL_TIME;
      for (const s of this.seats) {
        if (!s.isBot) continue;
        s.brain.memory.known = s.brain.memory.known || new Set();
        if (s === seat || Math.random() < 0.55 + 0.45 * s.brain.difficulty) s.brain.memory.known.add(m);
      }
    }
  }

  /** Set off a mine: blast, gib everyone close, shove the rest. */
  detonate(m) {
    if (!m.alive) return;
    m.alive = false;
    m.g.visible = false;
    const at = new THREE.Vector3(m.x, 0.2, m.z);
    this.fx.explosion(at, 0.8);
    Audio.sfx('explode', { vol: 0.8 });
    this.engine.shake(0.5);
    const crater = mesh(new THREE.CircleGeometry(0.9, 10), new THREE.MeshLambertMaterial({ color: 0x0e0c09, transparent: true, opacity: 0.8, depthWrite: false }), m.x, 0.015, m.z, { cast: false });
    crater.rotation.x = -Math.PI / 2;
    this.scene.add(crater);
    if (this.state !== 'play') return;
    for (const seat of this.aliveSeats) {
      if (seat.finished) continue;
      const a = seat.actor;
      const dx = a.pos.x - m.x, dz = a.pos.z - m.z, d = Math.hypot(dx, dz);
      if (d < BLAST_KILL) this.kill(seat, 'gib', { dir: new THREE.Vector3(dx || rand(-1, 1), 0, dz || rand(-1, 1)), force: 1.3 });
      else if (d < 3.5) { a.knock.x += (dx / d) * 8 * (1 - d / 3.5); a.knock.z += (dz / d) * 8 * (1 - d / 3.5); a.stun = 0.25; }
    }
  }

  _finish(seat) {
    seat.finished = true;
    this.finishers.push(seat);
    const a = seat.actor;
    a.alive = false; // leave the physics sim; we animate the walk-off ourselves
    seat.walkZ = a.pos.z;
    Audio.sfx('ding');
    const place = this.finishers.length;
    this.hud.banner(place === 1 ? 'FIRST OUT' : `#${place} OUT`, 1000, 'good');
    this.hud.feed(`${seat.player.name} escaped`, seat.player.color);
    if (!seat.pinged) { this.award(seat, 'blindFaith'); this.hud.feed(`${seat.player.name} never listened`, seat.player.color); }
  }

  _animateBeacons() {
    const on = Math.floor(this.engine.time * 4) % 2 === 0;
    this.beacons[0].color.setHex(on ? 0xff9a1a : 0x3a1a04);
    this.beacons[1].color.setHex(on ? 0x3a1a04 : 0xff9a1a);
  }

  /** Track the average depth of the pack; never pan back toward the start. */
  _updateCamera(dt) {
    const pack = this.seats.filter((s) => s.alive && !s.finished && s.actor);
    if (pack.length) {
      const avg = pack.reduce((acc, s) => acc + s.actor.pos.z, 0) / pack.length;
      const rear = Math.max(...pack.map((s) => s.actor.pos.z));
      // Average depth, held back just enough to keep the straggler in frame.
      this.camGoal = Math.max(FINISH_Z + 1, Math.min(this.camGoal, Math.max(avg, rear - 4.5)));
    }
    this.camZ = lerp(this.camZ, this.camGoal, Math.min(1, dt * 2.5));
    this.camera.position.set(0, 12, this.camZ + 11);
    this.camera.lookAt(0, 0, this.camZ - 3.5);
    this.moon.position.set(6, 20, this.camZ + 6);
    this.moon.target.position.set(0, 0, this.camZ - 4);
    this.packLight.position.set(0, 8, this.camZ - 2);
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    this._animateBeacons();

    // Finished subjects stroll into the dark.
    for (const seat of this.seats) {
      if (!seat.finished || !seat.subject || !seat.subject.root.visible) continue;
      seat.walkZ -= 2.4 * dt;
      seat.subject.root.position.z = seat.walkZ;
      seat.subject.faceAngle(Math.PI, dt);
      seat.subject.animate(dt, 2.4);
      if (seat.walkZ < FINISH_Z - 7) { seat.subject.root.visible = false; seat.tagTarget = null; }
    }

    // Harvester
    const H = this.harvester;
    if (playing && !H.active && this.time >= HARVEST_AT) {
      H.active = true;
      Audio.sfx('grind');
      Audio.sfx('horn');
      this.hud.banner('HARVEST TIME', 1500, 'danger');
    }
    if (H.active) {
      H.speed = this.time >= CAP ? 14 : Math.min(6.5, 1.1 + (this.time - HARVEST_AT) * 0.09);
      if (playing && this.time >= CAP && !this.capAnnounced) { this.capAnnounced = true; this.hud.banner('NO MERCY', 1200, 'danger'); Audio.sfx('sting'); }
      H.z -= H.speed * dt;
      H.drum.rotation.x -= dt * (4 + H.speed * 2);
      H.smokeT -= dt;
      if (H.smokeT <= 0) {
        H.smokeT = 0.18;
        for (const s of this.stacks) this.fx.smoke(s.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), { color: 0x2a2a2a, size: 0.3, life: 1.4, rise: 2 });
        if (Math.random() < 0.3) Audio.sfx('engine', { vol: 0.6 });
      }
    } else H.drum.rotation.x -= dt * 2;
    H.g.position.z = H.z;

    // Sonar rings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt / 0.7;
      p.ring.scale.setScalar(0.2 + p.t * PING_R);
      p.ring.material.opacity = 0.9 * (1 - p.t);
      if (p.t >= 1) { this.scene.remove(p.ring); p.ring.geometry.dispose(); p.ring.material.dispose(); this.pings.splice(i, 1); }
    }
    // Revealed mines fade out
    for (const m of this.mines) {
      if (!m.alive) continue;
      if (m.reveal > 0) {
        m.reveal -= dt;
        m.g.visible = true;
        const k = Math.min(1, m.reveal / 1.2);
        m.glowMat.opacity = k * (0.65 + 0.35 * Math.sin(this.time * 14));
        if (m.reveal <= 0) m.g.visible = false;
      }
      if (H.active && m.z > this.harvestFront) this.detonate(m); // ground up by the drum
    }

    this._updateCamera(dt);
    if (!playing) return;

    for (const seat of this.seats) {
      if (!seat.alive || seat.finished) continue;
      const a = seat.actor;
      // Stillness → sonar
      if (Math.hypot(a.vel.x, a.vel.z) < 0.45 && a.knock.lengthSq() < 0.5) {
        a.data.still += dt;
        if (a.data.still >= PING_STILL) { this.ping(seat); a.data.still = -0.9; }
      } else a.data.still = Math.min(a.data.still, 0) + (a.data.still < 0 ? dt : 0);
      // Mines
      for (const m of this.mines) {
        if (m.alive && Math.abs(m.z - a.pos.z) < 1 && Math.hypot(m.x - a.pos.x, m.z - a.pos.z) < MINE_TRIGGER) { this.detonate(m); break; }
      }
      if (!seat.alive) continue;
      // Harvester
      if (a.pos.z > this.harvestFront - 0.3) {
        this.kill(seat, 'gib', { dir: new THREE.Vector3(rand(-0.3, 0.3), 0, -1), force: 1.6 });
        this.fx.spray(new THREE.Vector3(a.pos.x, 1.5, a.pos.z), 40, { dir: new THREE.Vector3(0, 0.5, -1), speed: 9 });
        continue;
      }
      if (a.pos.z < FINISH_Z) this._finish(seat);
    }

    // HUD
    this.hud.setTimer(this.time < HARVEST_AT ? HARVEST_AT - this.time : Math.max(0, CAP - this.time));
    for (const seat of this.seats) {
      if (seat.finished) this.hud.setStat(seat, `ESCAPED #${this.finishers.indexOf(seat) + 1}`);
      else if (!seat.alive) this.hud.setStat(seat, 'MULCHED');
      else this.hud.setStat(seat, `${Math.max(0, Math.ceil(seat.actor.pos.z - FINISH_Z))}m TO GO`);
    }
    if (this.seats.every((s) => !s.alive || s.finished)) this.end(1.8);
    else if (this.time > CAP + 20) this.end(); // absolute safety net
  }

  /** Finishers in arrival order, then the dead (last to die ranks highest). */
  placement() {
    const tiers = this.finishers.map((s) => [s]);
    const stragglers = this.seats.filter((s) => s.alive && !s.finished);
    if (stragglers.length) tiers.push(stragglers);
    for (const s of this.deaths.slice().reverse()) tiers.push([s]);
    return tiers;
  }

  // ---------------------------------------------------------------------- bots

  /**
   * True if walking from `pos` along the unit direction (dx, dz) for ~1.6 units
   * stays clear of every known live mine (and inside the fences).
   */
  _pathClear(pos, dx, dz, known, reach = 1.6, margin = 0.85) {
    for (let t = 0.35; t <= reach; t += 0.35) {
      const px = pos.x + dx * t, pz = pos.z + dz * t;
      if (Math.abs(px) > HW - 0.4) return false;
      for (const m of known) {
        if (m.alive && Math.hypot(m.x - px, m.z - pz) < margin) return false;
      }
    }
    return true;
  }

  /**
   * Choose the safest of 16 headings around the bot. Clear paths that move
   * toward the exit (−Z) score best, sideways next, backwards last — but a
   * backwards path still beats walking onto a mine. `maxBack` limits how far
   * backwards is acceptable (the harvester may be right behind us).
   * Returns {x, z} or null when every direction is blocked.
   */
  _bestEscape(pos, known, maxBack = Infinity) {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const dx = Math.sin(ang), dz = -Math.cos(ang); // i = 0 points at the exit
      if (dz > 0 && maxBack < 2.5) continue;        // no room to back up: harvester
      if (!this._pathClear(pos, dx, dz, known)) continue;
      // Clearance: distance from the probe end to the nearest known mine.
      const ex = pos.x + dx * 1.6, ez = pos.z + dz * 1.6;
      let clear = 4;
      for (const m of known) if (m.alive) clear = Math.min(clear, Math.hypot(m.x - ex, m.z - ez));
      const score = -dz * 2 + clear * 0.6 + Math.random() * 0.2;
      if (score > bestScore) { bestScore = score; best = { x: dx, z: dz }; }
    }
    return best;
  }

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    if (seat.finished) return;
    mem.known = mem.known || new Set();
    a.ctrl.setButtons(false, false);
    const gap = this.harvestFront - a.pos.z;          // distance to the drum behind us
    const panic = this.harvester.active && gap < 4 + this.harvester.speed * 0.8;

    // Periodic sonar stops (more frequent for careful/skilled bots).
    if (mem.pingT > 0) {
      mem.pingT -= dt;
      if (!panic) { a.ctrl.setMove(0, 0); return; }
      mem.pingT = 0;
    }
    const interval = lerp(6.5, 2.8, brain.difficulty);
    if (mem.lastZ === undefined) {
      mem.lastZ = a.pos.z;
      mem.travel = Math.random() < 0.4 + brain.difficulty * 0.6 ? interval + 1 : 0; // careful bots listen before the first step
    }
    mem.travel += Math.abs(a.pos.z - mem.lastZ);
    mem.lastZ = a.pos.z;
    if (!panic && mem.travel > interval && this.time > 0.6) { mem.travel = 0; mem.pingT = PING_STILL + 0.25 + brain.reaction; a.ctrl.setMove(0, 0); return; }

    // Lane drift keeps the pack from piling into one file.
    mem.laneT = (mem.laneT || 0) - dt;
    if (mem.laneT <= 0 || mem.laneX === undefined) { mem.laneX = rand(-HW + 1.5, HW - 1.5); mem.laneT = rand(2.5, 5); }
    let mx = clamp((mem.laneX - a.pos.x) * 0.15, -0.4, 0.4), mz = -1;

    // Steer around remembered mines ahead.
    for (const m of mem.known) {
      if (!m.alive) { mem.known.delete(m); continue; }
      const dx = a.pos.x - m.x, dz = a.pos.z - m.z, d = Math.hypot(dx, dz);
      if (d > 2.4 || dz < -0.6) continue; // behind us: irrelevant
      const w = (2.4 - d) / 2.4;
      const side = Math.abs(dx) > 0.05 ? Math.sign(dx) : (a.pos.x > 0 ? -1 : 1);
      mx += side * w * 2.6;
      if (d < 1.1) mz += w * 1.4; // too close: ease off the forward push
    }
    // Keep some distance from the others — one mine should not take out a crowd.
    if (!panic) {
      for (const o of this.seats) {
        if (o === seat || !o.alive || o.finished) continue;
        const dx = a.pos.x - o.actor.pos.x, dz = a.pos.z - o.actor.pos.z, d = Math.hypot(dx, dz);
        if (d < 2.2 && d > 0.01) { mx += (dx / d) * (2.2 - d) * 0.6; mz += (dz / d) * (2.2 - d) * 0.25; }
      }
    }
    // Fences
    if (a.pos.x > HW - 1.2) mx -= 1.2;
    if (a.pos.x < -HW + 1.2) mx += 1.2;
    const care = panic ? 1 : lerp(0.75, 0.9, brain.difficulty);

    // Dead ends: if the way we want to go runs into a known mine (e.g. mines
    // left, right AND ahead, where the pushes above cancel out), pick the
    // safest direction all around — backwards included — and back out for a
    // moment before trying a new lane.
    if (mem.backT > 0) {
      mem.backT -= dt;
      if (this._pathClear(a.pos, mem.backX, mem.backZ, mem.known)) { a.ctrl.setMove(mem.backX * care, mem.backZ * care); return; }
      mem.backT = 0; // the escape route itself is blocked now: re-plan below
    }
    let len = Math.hypot(mx, mz) || 1;
    let dirX = mx / len, dirZ = mz / len;
    if (!this._pathClear(a.pos, dirX, dirZ, mem.known)) {
      const escape = this._bestEscape(a.pos, mem.known, panic ? gap : Infinity);
      if (escape) {
        dirX = escape.x; dirZ = escape.z;
        if (escape.z > 0.2) {                   // going backwards: commit for a moment
          mem.backX = dirX; mem.backZ = dirZ;
          mem.backT = rand(0.7, 1.2);
          mem.laneX = rand(-HW + 1.5, HW - 1.5); mem.laneT = rand(2.5, 5); // then try another lane
        }
      }
    }
    len = Math.hypot(dirX, dirZ) || 1;
    a.ctrl.setMove((dirX / len) * care, (dirZ / len) * care);

    // Opportunistic shove: a rival standing next to a known mine.
    if (Math.random() < 0.04 * brain.difficulty) {
      for (const o of this.seats) {
        if (o === seat || !o.alive || o.finished) continue;
        const dx = o.actor.pos.x - a.pos.x, dz = o.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d > 1.3) continue;
        const behindThem = [...mem.known].some((m) => m.alive && Math.hypot(m.x - (o.actor.pos.x + dx / d), m.z - (o.actor.pos.z + dz / d)) < 0.8);
        if (behindThem) { a.ctrl.setMove(dx / d * 0.3, dz / d * 0.3); a.ctrl.setButtons(false, true); break; }
      }
    }
  }
}
