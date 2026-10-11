/**
 * CABLE RUN — every subject is plugged into the mains and drags a live
 * high-voltage cable behind them. Light cycles, but with paperwork.
 *
 * Rules
 *  - Subjects never stop: they run along their heading at constant speed and
 *    steer with the stick (limited, smoothed turn rate). Stick = desired
 *    heading (up = away from the camera).
 *  - Everyone starts at the central junction box running outward on
 *    diverging headings; steering is ignored for the first 0.6 s.
 *  - A = short sprint boost (cooldown 3 s). No shove in this round.
 *  - Each subject's cable is recorded as a polyline (a point every 0.12 s).
 *    It is a finite cord: the oldest end unplugs behind you. The cord holds
 *    6 s of running at GO and grows to 20 s, so the pen fills up gradually.
 *  - Touching any rival's cable, your own cable (except the slack right
 *    behind you) or the electrified perimeter fence = electrocuted ('burn').
 *  - After 25 s the speed ramps up (+65 % over 30 s).
 *  - Last subject standing wins. Hard cap 70 s: survivors share first place,
 *    the dead are ranked by survival time (default placement()).
 *
 * Implementation notes
 *  - No Arena physics (no shove, no body separation). Positions live in
 *    seat.cr; movement is sub-stepped so fast subjects can't tunnel through
 *    a cable, and deaths within one sub-step happen simultaneously.
 *  - Lethal contact uses exact point-to-segment distances. Bots use a coarse
 *    occupancy grid (stamped as cables are laid) for cheap look-ahead probes,
 *    and treat rivals' predicted paths (head + heading × time) as obstacles.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow, canvasTexture } from '../core/textures.js';
import { angleDiff, clamp, damp } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const HALF_W = 9, HALF_D = 6;        // arena half-extents (18 × 12)
const BODY_R = 0.24;                 // head radius vs. the fence
const HIT_R = 0.27;                  // head-to-cable lethal distance
const BASE_SPEED = 3.3;              // units / s
const TURN = 3.4;                    // max turn rate (rad / s) at base speed
const RAMP_START = 25, RAMP_TIME = 30, RAMP_GAIN = 0.65;
const SPRINT_MUL = 1.75, SPRINT_TIME = 0.55, SPRINT_CD = 3;
const REC_DT = 0.12;                 // cable point interval (s)
const OWN_GRACE = 1.1;               // own-cable slack (arc length) that is safe
const CAP = 70;                      // hard time cap (s)
const TRAIL_BASE = 3.5, TRAIL_GROW = 0.22, TRAIL_MAX = 16; // cord length in seconds of running (grows over the round)
const STEER_LOCK = 0.6;              // steering is ignored for the first 0.6 s
const MAX_PTS = 800;                 // 75 s / 0.12 s ≈ 625 points + margin
const CORE_HALF = 0.07, GLOW_HALF = 0.32;
const CABLE_Y = 0.05;
const CELL = 0.25;                   // bot occupancy grid
const GW = Math.ceil((HALF_W * 2) / CELL), GH = Math.ceil((HALF_D * 2) / CELL);
const CANDIDATES = [0, -0.35, 0.35, -0.75, 0.75, -1.2, 1.2, -1.75, 1.75, -2.5, 2.5];

export class CableRun extends Minigame {
  static meta = {
    id: 'cablerun',
    title: 'CABLE RUN',
    tagline: 'Every subject is now an extension cord.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Steer' }, { input: 'a', label: 'Sprint' }],
    objective: 'Be the last subject standing.',
    rules: [
      'You never stop running. Steer with {MOVE}.',
      'You drag a live cable behind you. It gets longer as the test goes on.',
      'Touching any cable or the fence is fatal — yours included.',
      'Press {A} for a short sprint. The pace rises after 25 seconds.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 20, fogFar: 56 });
    this.makeCamera([0, 16, 11], [0, 0, 0.9], 48);

    // --- floor
    floor(scene, 50, 36, { tex: 'concrete', tile: 3 });
    floor(scene, HALF_W * 2, HALF_D * 2, { tex: 'plate', tile: 1.5, y: 0.005, color: 0x6a6e6c });
    stencil(scene, 'HIGH VOLTAGE', 0, 0.015, 0, { w: 10, h: 3.4, opacity: 0.12 }).rotation.x = -Math.PI / 2;
    hazardStrip(scene, 0, -HALF_D - 0.45, HALF_W * 2 + 1.6, 0.5, 0.01);
    hazardStrip(scene, 0, HALF_D + 0.45, HALF_W * 2 + 1.6, 0.5, 0.01);
    hazardStrip(scene, -HALF_W - 0.45, 0, 0.5, HALF_D * 2, 0.01);
    hazardStrip(scene, HALF_W + 0.45, 0, 0.5, HALF_D * 2, 0.01);

    // --- electrified perimeter fence: shared post geometry, glowing wires
    const postGeo = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    const postMat = mat(0xffffff, Tex.metal());
    const capGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 6);
    const capMat = mat(0xc9c2a8);
    const addPost = (x, z) => {
      scene.add(mesh(postGeo, postMat, x, 0.4, z, { cast: false }));
      scene.add(mesh(capGeo, capMat, x, 0.82, z, { cast: false }));
    };
    const PX = HALF_W + 0.08, PZ = HALF_D + 0.08;
    for (let x = -HALF_W; x <= HALF_W + 1e-6; x += 1.5) { addPost(x, -PZ); addPost(x, PZ); }
    for (let z = -HALF_D + 1.5; z < HALF_D - 1e-6; z += 1.5) { addPost(-PX, z); addPost(PX, z); }
    this.wireBase = new THREE.Color(0x6fd0ff);
    this.wireMat = glow(0x6fd0ff);
    for (const y of [0.3, 0.62]) {
      scene.add(mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.16, 0.03, 0.03), this.wireMat, 0, y, -PZ, { cast: false }));
      scene.add(mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.16, 0.03, 0.03), this.wireMat, 0, y, PZ, { cast: false }));
      scene.add(mesh(new THREE.BoxGeometry(0.03, 0.03, HALF_D * 2 + 0.16), this.wireMat, -PX, y, 0, { cast: false }));
      scene.add(mesh(new THREE.BoxGeometry(0.03, 0.03, HALF_D * 2 + 0.16), this.wireMat, PX, y, 0, { cast: false }));
    }

    // --- set dressing: back wall, conduits, transformers
    scene.add(mesh(new THREE.PlaneGeometry(44, 10), mat(0xffffff, Tex.wall([11, 2.5])), 0, 4, -HALF_D - 3.2, { cast: false }));
    stencil(scene, 'MIND THE CABLE', 0, 2.6, -HALF_D - 3.1, { w: 8, h: 2.2, opacity: 0.55 });
    pipe(scene, [-20, 5, -HALF_D - 2.9], [20, 5, -HALF_D - 2.9], 0.22);
    pipe(scene, [-20, 4.3, -HALF_D - 2.95], [20, 4.3, -HALF_D - 2.95], 0.1, 0x2c3a44);
    const xfMat = mat(0x5d6b52, Tex.plate());
    const lampMat = glow(0xff3a20);
    this.xfLamps = [];
    for (const sx of [-1, 1]) {
      block(scene, sx * (HALF_W + 2.6), 1.1, -HALF_D - 1.6, 2.2, 2.2, 1.7, xfMat);
      block(scene, sx * (HALF_W + 2.6), 2.35, -HALF_D - 1.6, 1.4, 0.3, 1.1, mat(0x2b2d2b, Tex.metal()));
      const l = mesh(new THREE.SphereGeometry(0.12, 6, 4), lampMat, sx * (HALF_W + 2.6), 1.7, -HALF_D - 0.72, { cast: false });
      scene.add(l);
      this.xfLamps.push(l);
    }
    stencil(scene, 'DANGER', -(HALF_W + 2.6), 0.9, -HALF_D - 0.74, { w: 1.8, h: 0.6, opacity: 0.8, color: '#e8c33a' });
    stencil(scene, 'DANGER', HALF_W + 2.6, 0.9, -HALF_D - 0.74, { w: 1.8, h: 0.6, opacity: 0.8, color: '#e8c33a' });

    hangingLamp(scene, -4.5, 8, 0.5, { intensity: 85, angle: 0.95 });
    hangingLamp(scene, 4.5, 8, 0.5, { intensity: 85, angle: 0.95 });
    hangingLamp(scene, 0, 8.5, -4, { intensity: 35, angle: 0.9, shadow: false });

    // --- occupancy grid for bot probes (owner = seat index + 1, time stamped)
    this.grid = new Uint8Array(GW * GH);
    this.gridT = new Float32Array(GW * GH);

    // --- subjects, sockets, cables
    const glowTex = cableGlowTexture();
    const sockGeo = new THREE.BoxGeometry(0.46, 0.26, 0.46);
    const sockMat = mat(0x3a3c38, Tex.metal());
    const lightGeo = new THREE.BoxGeometry(0.22, 0.04, 0.22);
    // Everyone starts at the central junction and runs OUTWARD on diverging
    // headings (toward the corners for 4), so nobody shares a lane at GO.
    const n = this.seats.length;
    const CORNER = Math.atan2(HALF_W, HALF_D);
    const layouts = {
      1: [Math.PI / 2],
      2: [-Math.PI / 2, Math.PI / 2],
      3: [Math.PI, Math.PI / 3, -Math.PI / 3],
      4: [-Math.PI + CORNER, Math.PI - CORNER, CORNER, -CORNER],
    };
    const headings = layouts[Math.min(4, Math.max(1, n))];
    scene.add(mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.04, 10), mat(0x2b2d2b, Tex.metal()), 0, 0.02, 0, { cast: false }));
    this.seats.forEach((seat, i) => {
      // Pinwheel: spokes leave the hub radially, but everyone runs a little
      // clockwise of their spoke. With rotational (not mirror) symmetry,
      // neighbours follow each other instead of turning into each other.
      const radial = headings[i % headings.length];
      const heading = radial + 0.7;
      const dx = Math.sin(radial), dz = Math.cos(radial);
      const x = dx * 1.7, z = dz * 1.7;
      this.spawnSubject(seat, { x, z, facing: heading });
      const color = new THREE.Color(seat.player.color);

      // Junction socket the cable comes out of.
      const sx = dx * 1.1, sz = dz * 1.1;
      scene.add(mesh(sockGeo, sockMat, sx, 0.13, sz, { cast: false }));
      scene.add(mesh(lightGeo, new THREE.MeshBasicMaterial({ color }), sx, 0.27, sz, { cast: false }));

      const coreMat = new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), side: THREE.DoubleSide });
      const glowMat = new THREE.MeshBasicMaterial({
        color, map: glowTex, transparent: true, opacity: 0.55, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const ribbons = [this._ribbon(GLOW_HALF, glowMat, CABLE_Y - 0.01, 1), this._ribbon(CORE_HALF, coreMat, CABLE_Y, 2)];
      seat.cr = {
        idx: i, x, z, heading, turn: 0, speed: 0, boost: 0, cd: 0, recT: 0,
        px: [sx, x], pz: [sz, z], cum: [0, 0.6], pt: [0, 0], tail: 0,
        ribbons, glowMat, dirtyFrom: 0, settled: false, sparkT: rand(0, 0.3),
      };
      this._stamp(i, sx, sz, x, z);
      this._refreshCable(seat);
    });

    this.rampAnnounced = false;
    this.promptT = 0;
  }

  /** Preallocated flat ribbon (two vertices per cable point). */
  _ribbon(half, material, y, order) {
    const pos = new Float32Array(MAX_PTS * 2 * 3);
    const uv = new Float32Array(MAX_PTS * 2 * 2);
    for (let i = 0; i < MAX_PTS; i++) { uv[i * 4] = 0; uv[i * 4 + 1] = 0.5; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = 0.5; }
    const idx = new Uint16Array((MAX_PTS - 1) * 6);
    for (let i = 0; i < MAX_PTS - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.set([a, c, b, b, c, d], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const m = new THREE.Mesh(geo, material);
    m.position.y = y;
    m.frustumCulled = false;
    m.renderOrder = order;
    this.scene.add(m);
    return { geo, half, pending: 0 };
  }

  start() {
    this.hud.banner('POWER ON', 900);
    this.hud.prompt('{MOVE} steer · {A} sprint');
    this.promptT = 3.5;
    Audio.sfx('buzz', { vol: 0.6 });
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    this._cosmetics(dt);
  }

  // ------------------------------------------------------------------ helpers

  _ramp() { return 1 + clamp((this.time - RAMP_START) / RAMP_TIME, 0, 1) * RAMP_GAIN; }

  /** Cord length (seconds of running) at the current time. */
  _trail() { return Math.min(TRAIL_MAX, TRAIL_BASE + this.time * TRAIL_GROW); }

  /** Unplug cable points older than the cord length (also for the dead). */
  _unplug() {
    const oldest = this.time - this._trail();
    for (const seat of this.seats) {
      const c = seat.cr, n = c.px.length;
      let t = c.tail;
      while (t < n - 2 && c.pt[t + 1] < oldest) t++;
      if (t !== c.tail) {
        c.tail = t;
        for (const r of c.ribbons) r.geo.setDrawRange(c.tail * 6, (n - c.tail) * 6);
      }
    }
  }

  /** Mark grid cells along a cable segment (3×3 neighbourhood per sample). */
  _stamp(idx, x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 0.12));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = Math.floor((x0 + (x1 - x0) * t + HALF_W) / CELL);
      const gz = Math.floor((z0 + (z1 - z0) * t + HALF_D) / CELL);
      for (let dz = -1; dz <= 1; dz++) {
        const zz = gz + dz;
        if (zz < 0 || zz >= GH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = gx + dx;
          if (xx < 0 || xx >= GW) continue;
          this.grid[zz * GW + xx] = idx + 1;
          this.gridT[zz * GW + xx] = this.time;
        }
      }
    }
  }

  /** Lethal contact test for one seat's head. Returns null or { type, by }. */
  _hitTest(seat) {
    const c = seat.cr, x = c.x, z = c.z;
    if (Math.abs(x) > HALF_W - BODY_R || Math.abs(z) > HALF_D - BODY_R) return { type: 'wall', by: null };
    const r2 = HIT_R * HIT_R;
    for (const o of this.seats) {
      const oc = o.cr, px = oc.px, pz = oc.pz, n = px.length;
      const own = o === seat;
      let last = n - 1;
      if (own) {
        const headCum = oc.cum[n - 1] + Math.hypot(x - px[n - 1], z - pz[n - 1]);
        while (last > 0 && headCum - oc.cum[last] < OWN_GRACE) last--;
      }
      for (let i = oc.tail; i < last; i++) {
        // cheap reject: both ends far away on one axis
        const ax = px[i], bx = px[i + 1];
        if ((ax - x > 1.5 && bx - x > 1.5) || (x - ax > 1.5 && x - bx > 1.5)) continue;
        if (segDist2(x, z, ax, pz[i], bx, pz[i + 1]) < r2) return { type: own ? 'own' : 'cable', by: o };
      }
      // The live end (last laid point → owner's head) is cable too.
      if (!own && segDist2(x, z, px[n - 1], pz[n - 1], oc.x, oc.z) < r2) return { type: 'cable', by: o };
    }
    return null;
  }

  _electrocute(seat, hit) {
    const c = seat.cr;
    const n = c.px.length;
    this._stamp(c.idx, c.px[n - 1], c.pz[n - 1], c.x, c.z);
    seat.subject.root.position.set(c.x, 0, c.z);
    this.fx.sparks(new THREE.Vector3(c.x, 0.5, c.z), { color: 0x9fe4ff, count: 16, speed: 7 });
    this.fx.sparks(new THREE.Vector3(c.x, 1.2, c.z), { color: 0xffffff, count: 8, speed: 4 });
    Audio.sfx('buzz', { vol: 0.9 });
    this.kill(seat, 'burn', { dir: new THREE.Vector3(Math.sin(c.heading), 0, Math.cos(c.heading)), quiet: true });
    const name = seat.player.name;
    const msg = hit.type === 'wall' ? `${name} hugged the fence`
      : hit.type === 'own' ? `${name} tripped over their own cable`
        : `${name} touched ${hit.by.player.name}'s cable`;
    this.hud.feed(msg, seat.player.color);
    c.speed = 0; c.turn = 0; c.boost = 0;
  }

  /** Rewrite the ribbon vertices that changed since the last call. */
  _refreshCable(seat) {
    const c = seat.cr, px = c.px, pz = c.pz, n = px.length; // vertex n = live head
    const from = Math.max(0, Math.min(c.dirtyFrom, n - 1));
    const P = (i) => (i < n ? [px[i], pz[i]] : [c.x, c.z]);
    for (let i = from; i <= n; i++) {
      const [x, z] = P(i);
      const [ax, az] = P(Math.max(0, i - 1));
      const [bx, bz] = P(Math.min(n, i + 1));
      let tx = bx - ax, tz = bz - az;
      let l = Math.hypot(tx, tz);
      if (l < 1e-5) { tx = Math.sin(c.heading); tz = Math.cos(c.heading); l = 1; }
      const nx = -tz / l, nz = tx / l;
      for (const r of c.ribbons) {
        const arr = r.geo.attributes.position.array, o = i * 6, w = r.half;
        arr[o] = x + nx * w; arr[o + 1] = 0; arr[o + 2] = z + nz * w;
        arr[o + 3] = x - nx * w; arr[o + 4] = 0; arr[o + 5] = z - nz * w;
      }
    }
    for (const r of c.ribbons) {
      const attr = r.geo.attributes.position;
      if (attr.updateRanges && attr.addUpdateRange) {
        // Ranges not yet uploaded by the renderer are merged into one.
        r.pending = attr.updateRanges.length === 0 ? from : Math.min(r.pending, from);
        attr.clearUpdateRanges();
        attr.addUpdateRange(r.pending * 6, (n - r.pending + 1) * 6);
      }
      attr.needsUpdate = true;
      r.geo.setDrawRange(c.tail * 6, (n - c.tail) * 6);
    }
    c.dirtyFrom = n - 1;
  }

  /** Purely visual flicker (no game state). */
  _cosmetics(dt) {
    const t = this.clock;
    const f = 0.7 + 0.3 * Math.abs(Math.sin(t * 31) * Math.sin(t * 7.3));
    this.wireMat.color.copy(this.wireBase).multiplyScalar(f);
    for (const l of this.xfLamps) l.visible = Math.sin(t * 4) > 0;
    for (const seat of this.seats) seat.cr.glowMat.opacity = 0.45 + 0.15 * Math.sin(t * 12 + seat.cr.idx * 1.7);
    void dt;
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    this._cosmetics(dt);
    const playing = this.state === 'play';
    if (playing) this._simulate(dt);
    else this._coast(dt);
    for (const seat of this.seats) {
      // A dead subject's cable end is frozen: one last refresh, then leave it.
      if (seat.alive || !seat.cr.settled) { this._refreshCable(seat); if (!seat.alive) seat.cr.settled = true; }
    }
    if (!playing) return;

    if (this.promptT > 0) { this.promptT -= dt; if (this.promptT <= 0) this.hud.prompt(null); }
    if (!this.rampAnnounced && this.time >= RAMP_START) {
      this.rampAnnounced = true;
      this.hud.banner('VOLTAGE RISING', 1400, 'danger');
      Audio.sfx('horn', { vol: 0.5 });
    }

    for (const seat of this.seats) {
      const c = seat.cr;
      if (!seat.alive) { this.hud.setStat(seat, 'FRIED'); this.hud.setStatus(seat, ''); continue; }
      this.hud.setStat(seat, c.cd <= 0 ? 'SPRINT READY' : 'RECHARGING');
      this.hud.setStatus(seat, c.boost > 0 ? 'SPRINTING' : '');
    }
    this.hud.setTimer(Math.max(0, CAP - this.time));

    if (this.time >= CAP) {
      this.hud.prompt(null);
      this.hud.banner('TIME UP', 1600);
      Audio.sfx('horn');
      this.end();
      return;
    }
    const left = this.aliveSeats.length;
    if (this.checkLastStanding()) {
      this.hud.prompt(null);
      this.hud.banner(left === 1 ? 'LAST LIVE WIRE' : 'TOTAL BLACKOUT', 1800);
    }
  }

  _simulate(dt) {
    const ramp = this._ramp();
    const baseSpeed = BASE_SPEED * ramp, turnMax = TURN * Math.sqrt(ramp);
    let maxMove = 0;
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const c = seat.cr, ctrl = seat.ctrl;
      c.cd = Math.max(0, c.cd - dt);
      c.boost = Math.max(0, c.boost - dt);
      if (ctrl.aPressed && c.cd <= 0) {
        c.boost = SPRINT_TIME; c.cd = SPRINT_CD;
        Audio.sfx('whoosh', { vol: 0.5 });
        this.fx.sparks(new THREE.Vector3(c.x, 0.2, c.z), { color: 0x9fe4ff, count: 5, speed: 3 });
      }
      c.speed = baseSpeed * (c.boost > 0 ? SPRINT_MUL : 1);
      const mx = ctrl.moveX, my = ctrl.moveY;
      let want = 0;
      // Opening grace: everyone runs straight out of the junction first.
      if (this.time >= STEER_LOCK && Math.hypot(mx, my) > 0.35) want = clamp(angleDiff(c.heading, Math.atan2(mx, my)) * 6, -turnMax, turnMax);
      c.turn += (want - c.turn) * damp(14, dt);
      maxMove = Math.max(maxMove, c.speed * dt);
    }

    // Sub-stepped movement; everyone hit within one sub-step dies together.
    const nSub = Math.min(8, Math.max(1, Math.ceil(maxMove / 0.12)));
    const sdt = dt / nSub;
    for (let k = 0; k < nSub; k++) {
      for (const seat of this.seats) {
        if (!seat.alive) continue;
        const c = seat.cr;
        c.heading = angleDiff(0, c.heading + c.turn * sdt);
        c.x += Math.sin(c.heading) * c.speed * sdt;
        c.z += Math.cos(c.heading) * c.speed * sdt;
      }
      const hits = [];
      for (const seat of this.seats) {
        if (!seat.alive) continue;
        const h = this._hitTest(seat);
        if (h) hits.push([seat, h]);
      }
      for (const [seat, h] of hits) this._electrocute(seat, h);
    }

    // Lay cable, move avatars.
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const c = seat.cr;
      c.recT += dt;
      if (c.recT >= REC_DT && c.px.length < MAX_PTS - 2) {
        c.recT -= REC_DT;
        const n = c.px.length;
        const lx = c.px[n - 1], lz = c.pz[n - 1];
        c.px.push(c.x); c.pz.push(c.z); c.pt.push(this.time);
        c.cum.push(c.cum[n - 1] + Math.hypot(c.x - lx, c.z - lz));
        this._stamp(c.idx, lx, lz, c.x, c.z);
      }
      c.sparkT -= dt;
      if (c.sparkT <= 0) {
        c.sparkT = 0.25 + random() * 0.35;
        this.fx.sparks(new THREE.Vector3(c.x - Math.sin(c.heading) * 0.3, 0.12, c.z - Math.cos(c.heading) * 0.3), { color: 0xbfe8ff, count: 2, speed: 2.5 });
      }
      const s = seat.subject;
      s.root.position.set(c.x, 0, c.z);
      s.faceAngle(c.heading, dt, 20);
      s.animate(dt, c.speed);
    }
    this._unplug();
  }

  /** Round over: survivors jog to a halt (no more collisions). */
  _coast(dt) {
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const c = seat.cr;
      c.speed *= Math.exp(-4 * dt);
      if (c.speed < 0.05) c.speed = 0;
      c.x = clamp(c.x + Math.sin(c.heading) * c.speed * dt, -HALF_W + BODY_R, HALF_W - BODY_R);
      c.z = clamp(c.z + Math.cos(c.heading) * c.speed * dt, -HALF_D + BODY_R, HALF_D - BODY_R);
      const s = seat.subject;
      s.root.position.set(c.x, 0, c.z);
      s.faceAngle(c.heading, dt, 20);
      s.animate(dt, c.speed);
    }
  }

  // ---------------------------------------------------------------------- bots

  /** Is (x, z) unsafe for `seat` according to the bot's coarse world model? */
  _blocked(seat, x, z, t) {
    if (Math.abs(x) > HALF_W - 0.45 || Math.abs(z) > HALF_D - 0.45) return true;
    const gx = Math.floor((x + HALF_W) / CELL), gz = Math.floor((z + HALF_D) / CELL);
    const gi = gz * GW + gx;
    const owner = this.grid[gi];
    if (owner && this.gridT[gi] > this.time - this._trail() && !(owner === seat.cr.idx + 1 && this.gridT[gi] > this.time - 0.6)) return true;
    for (const o of this.seats) {
      if (o === seat || !o.alive) continue;
      const oc = o.cr, n = oc.px.length;
      // Cable not yet laid in the grid: last point → head.
      if (segDist2(x, z, oc.px[n - 1], oc.pz[n - 1], oc.x, oc.z) < 0.45 * 0.45) return true;
      if (Math.hypot(x - oc.x, z - oc.z) < 0.7) return true;
      // Predicted path: where the rival's head (and so its cable) will be by
      // the time we get here, plus a safety lead. Crossing it is only "free"
      // if we pass well before the rival does; head-on lines are blocked.
      const reach = Math.min(Math.max(oc.speed, BASE_SPEED) * t, 3) + 0.6;
      const ex = oc.x + Math.sin(oc.heading) * reach, ez = oc.z + Math.cos(oc.heading) * reach;
      if (t < 1.2 && segDist2(x, z, oc.x, oc.z, ex, ez) < 0.5 * 0.5) return true;
    }
    return false;
  }

  /**
   * Open space reachable from (x, z): a capped flood fill over the occupancy
   * grid (cables + fence). Light-cycle bots must compare ROOM, not just the
   * free distance straight ahead, or they drive into dead-end corridors.
   */
  _area(seat, x, z, limit) {
    if (!this._ffSeen) { this._ffSeen = new Uint32Array(GW * GH); this._ffQ = new Int32Array(GW * GH); this._ffMark = 0; }
    const seen = this._ffSeen, q = this._ffQ;
    const mark = ++this._ffMark;
    const gx = Math.floor((x + HALF_W) / CELL), gz = Math.floor((z + HALF_D) / CELL);
    if (gx < 2 || gz < 2 || gx >= GW - 2 || gz >= GH - 2) return 0;
    const me = seat.cr.idx + 1, young = this.time - 0.6, unplugged = this.time - this._trail();
    const free = (i) => {
      const o = this.grid[i];
      return !o || this.gridT[i] <= unplugged || (o === me && this.gridT[i] > young);
    };
    let head = 0, tail = 0, count = 0;
    const start = gz * GW + gx;
    seen[start] = mark; q[tail++] = start;
    while (head < tail && count < limit) {
      const i = q[head++]; count++;
      const cx = i % GW, cz = (i - cx) / GW;
      if (cx > 2) { const j = i - 1; if (seen[j] !== mark && free(j)) { seen[j] = mark; q[tail++] = j; } }
      if (cx < GW - 3) { const j = i + 1; if (seen[j] !== mark && free(j)) { seen[j] = mark; q[tail++] = j; } }
      if (cz > 2) { const j = i - GW; if (seen[j] !== mark && free(j)) { seen[j] = mark; q[tail++] = j; } }
      if (cz < GH - 3) { const j = i + GW; if (seen[j] !== mark && free(j)) { seen[j] = mark; q[tail++] = j; } }
    }
    return count;
  }

  /** Where the probe path for `theta` is after `dist` units (or null if blocked before). */
  _probeEnd(seat, theta, dist) {
    const c = seat.cr;
    const ramp = this._ramp();
    const speed = BASE_SPEED * ramp;
    const perDist = (TURN * Math.sqrt(ramp)) / speed;
    const step = 0.25;
    const target = c.heading + theta;
    let h = c.heading, x = c.x, z = c.z, d = 0;
    while (d < dist) {
      h += clamp(target - h, -perDist * step, perDist * step);
      x += Math.sin(h) * step; z += Math.cos(h) * step; d += step;
      if (this._blocked(seat, x, z, d / speed)) return null;
    }
    return { x, z };
  }

  /** Free distance along "turn toward heading + theta at full rate, then straight". */
  _probe(seat, theta, maxD) {
    const c = seat.cr;
    const ramp = this._ramp();
    const speed = BASE_SPEED * ramp;
    const perDist = (TURN * Math.sqrt(ramp)) / speed;
    const step = 0.25;
    const target = c.heading + theta;
    let h = c.heading, x = c.x, z = c.z, d = 0;
    while (d < maxD) {
      h += clamp(target - h, -perDist * step, perDist * step);
      x += Math.sin(h) * step;
      z += Math.cos(h) * step;
      d += step;
      if (this._blocked(seat, x, z, d / speed)) return d - step;
    }
    return maxD;
  }

  botThink(seat, dt) {
    const c = seat.cr, brain = seat.brain, mem = brain.memory;
    if (mem.target === undefined) { mem.target = c.heading; mem.t = 0; mem.aPrev = false; }
    let wantA = false;
    mem.t -= dt;
    if (mem.t <= 0) {
      mem.t = 0.03 + brain.reaction * 0.25;
      wantA = this._botPlan(seat, mem);
    }
    seat.ctrl.setMove(Math.sin(mem.target), Math.cos(mem.target));
    // Edge-triggered button: alternate so a repeated intent becomes a fresh press.
    seat.ctrl.setButtons(wantA && !mem.aPrev, false);
    mem.aPrev = wantA && !mem.aPrev;
  }

  /** Pick a heading via look-ahead probes; returns true to request a sprint. */
  _botPlan(seat, mem) {
    const c = seat.cr, brain = seat.brain, diff = brain.difficulty;
    const maxD = 2.5 + diff * 6.5;

    // Cut-off (difficulty ≥ 0.6 only): if we are clearly AHEAD of and BESIDE
    // a rival running roughly the same way (never head-on), aim across the
    // line in front of them. The probe still has to call that path free.
    let cut = null;
    if (diff >= 0.595 && this.time > 3) {
      const mfx = Math.sin(c.heading), mfz = Math.cos(c.heading);
      let bestAhead = Infinity;
      for (const o of this.seats) {
        if (o === seat || !o.alive) continue;
        const oc = o.cr, ofx = Math.sin(oc.heading), ofz = Math.cos(oc.heading);
        if (mfx * ofx + mfz * ofz < 0.5) continue;              // not parallel enough
        const rx = c.x - oc.x, rz = c.z - oc.z;
        const ahead = rx * ofx + rz * ofz;                       // how far in front of them we are
        const side = Math.abs(rx * ofz - rz * ofx);              // lateral offset
        if (ahead < 1.5 || ahead > 5 || side < 0.8 || side > 3.5) continue;
        if (ahead < bestAhead) {
          bestAhead = ahead;
          const lead = ahead + 1.2 + diff;
          cut = angleDiff(c.heading, Math.atan2(oc.x + ofx * lead - c.x, oc.z + ofz * lead - c.z));
        }
      }
    }

    // Room behind each option: flood-fill from a point ~1.6 u down that path.
    // Better bots look at more of the room (bigger cap), so they also judge
    // large regions; weaker ones only notice tight dead ends.
    const AREA_CAP = 220 + Math.round(diff * 500);
    // Commitment: once a bot has started turning one way it keeps that turn
    // unless the other side is clearly better — flip-flopping between left
    // and right every re-plan means never turning at all (straight into the fence).
    const committed = Math.sign(angleDiff(c.heading, mem.target));
    let bestS = -Infinity, bestTh = 0, fwd = 0;
    for (const th of CANDIDATES) {
      const free = this._probe(seat, th, maxD);
      if (th === 0) fwd = free;
      const end = free >= 1.6 ? this._probeEnd(seat, th, 1.6) : null;
      const room = end ? this._area(seat, end.x, end.z, AREA_CAP) / AREA_CAP : 0;
      // Keep away from the fence: margin to the pen edge a little further down this path.
      const far = free >= 2.6 ? this._probeEnd(seat, th, 2.6) : end;
      const margin = far ? Math.min(HALF_W - Math.abs(far.x), HALF_D - Math.abs(far.z)) : 0;
      let s = free + room * maxD * 1.2 + clamp(margin, 0, 3) * 0.9 - Math.abs(th) * 0.15 + rand(-1, 1) * brain.error * 0.8;
      s -= Math.abs(angleDiff(mem.target, c.heading + th)) * 0.3; // stay close to the current plan
      if (committed && Math.abs(th) > 0.2 && Math.sign(th) !== committed) s -= 1.5;
      if (free < 1.2) s -= 20; // anything that hits a wall/cable almost at once is a last resort
      if (cut !== null && free >= maxD * 0.85) s += (diff - 0.5) * 4 * Math.max(0, 1 - Math.abs(th - cut) / 0.9);
      if (s > bestS) { bestS = s; bestTh = th; }
    }
    mem.target = c.heading + bestTh;

    if (c.cd > 0 || fwd < maxD * 0.95 || Math.abs(bestTh) > 0.4) return false;
    if (cut !== null && Math.abs(cut) < 0.6) return random() < diff * 0.6;
    return random() < 0.03 + diff * 0.03;
  }
}

/** Squared distance from point (x, z) to segment (ax, az)-(bx, bz). */
function segDist2(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - x, ez = az + dz * t - z;
  return ex * ex + ez * ez;
}

/** Soft glow falloff across the cable width (u axis), white with alpha. Cached. */
function cableGlowTexture() {
  return canvasTexture('cableGlow', 64, (c, s) => {
    const img = c.createImageData(s, s);
    for (let x = 0; x < s; x++) {
      const t = Math.abs((x + 0.5) / s - 0.5) * 2;   // 0 centre → 1 edge
      const a = Math.round(255 * Math.max(0, Math.exp(-t * t * 5) - 0.02));
      for (let y = 0; y < s; y++) {
        const o = (y * s + x) * 4;
        img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = a;
      }
    }
    c.putImageData(img, 0, 0);
  });
}
