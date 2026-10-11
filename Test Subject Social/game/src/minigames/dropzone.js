/**
 * DROP ZONE — a loading bay under an overhead crane. Collect golden rations
 * while the crane keeps dropping freight.
 *
 * Rules
 *  - 60 s shift in a walled loading bay.
 *  - The crane lowers crates in from above. A red shadow circle marks each
 *    impact point and grows for ~1.2 s (the ring shows its final size), then
 *    the load drops. Anyone inside the circle at impact is crushed ('crush').
 *    Subjects just outside the circle are knocked back by the impact.
 *  - Some drops are heavy pallets (2x2 crates) with a much wider shadow.
 *  - The drop rate rises over the shift (and later loads arrive in pairs).
 *  - Landed loads sit on the floor as obstacles for a few seconds, then the
 *    crane hauls them away. All loads come from a fixed pool (bounded count).
 *  - Golden ration tins lie on the floor (seats + 1 at a time). Walking over
 *    one = +1 point; it reappears elsewhere. A load landing on a tin destroys it.
 *  - B shoves. Shoving a rival under a falling load is encouraged.
 *  - Ranking: survivors above the crushed; within each group by points
 *    (ties among the dead: whoever died later ranks higher).
 *  - The shift ends at 60 s, or as soon as at most one subject is alive.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe, crate } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { clamp } from '../core/util.js';
import { rand, random, pick } from '../core/rng.js';

const HALF_W = 8, HALF_D = 5.5;     // inner bay half-extents
const ROUND_TIME = 60;
const FALL = 0.3;                    // free-fall time at the end of a warning
const HANG_TOP = 10;                 // height a load enters / leaves at
const HANG_LOW = 4.6;                // height a load is released from
const CLEAR_TIME = 0.7;              // crane haul-away duration
const KILL_PAD = 0.12;               // centre within shadow radius + pad = crushed
const PICKUP_R = 0.7;
const KINDS = Object.freeze({
  crate: Object.freeze({ r: 0.95, col: 0.72, warn: 1.2, stay: 2.4, top: 1.3, pool: 14 }),
  pallet: Object.freeze({ r: 1.75, col: 1.42, warn: 1.35, stay: 3.0, top: 1.32, pool: 4 }),
});

/** Distance from point (cx, cz) to the segment p→q (pure helper). */
function segDist(px, pz, qx, qz, cx, cz) {
  const vx = qx - px, vz = qz - pz;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-6 ? ((cx - px) * vx + (cz - pz) * vz) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px + vx * t - cx, pz + vz * t - cz);
}

export class DropZone extends Minigame {
  static meta = {
    id: 'dropzone',
    title: 'DROP ZONE',
    tagline: 'Heavy loads. Light compensation.',
    category: 'Competitive',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Collect the most golden rations without getting flattened.',
    rules: [
      'The crane drops freight all shift. A red shadow marks every impact.',
      'Stand in a shadow when the load lands and you are flattened.',
      'Walk over golden rations for points. Survivors outrank the flattened.',
      'Drops speed up and heavy pallets hit wider. {B} shoves.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 52 });
    this.makeCamera([0, 15.5, 11.5], [0, 0, 0.6], 48);

    // --- the bay
    floor(scene, 46, 34, { tex: 'concrete', tile: 3 });
    floor(scene, HALF_W * 2, HALF_D * 2, { tex: 'plate', tile: 2, y: 0.005 });
    stencil(scene, 'DROP ZONE', 0, 0.02, 0.4, { w: 8, h: 2.6, opacity: 0.16 }).rotation.x = -Math.PI / 2;
    hazardStrip(scene, 0, -HALF_D + 0.2, HALF_W * 2, 0.4, 0.012);
    hazardStrip(scene, 0, HALF_D - 0.2, HALF_W * 2, 0.4, 0.012);
    hazardStrip(scene, -HALF_W + 0.2, 0, 0.4, HALF_D * 2 - 0.8, 0.012);
    hazardStrip(scene, HALF_W - 0.2, 0, 0.4, HALF_D * 2 - 0.8, 0.012);

    const wallMat = mat(0xffffff, Tex.plate([6, 1]));
    block(scene, 0, 0.45, -HALF_D - 0.3, HALF_W * 2 + 1.2, 0.9, 0.6, wallMat);
    block(scene, 0, 0.45, HALF_D + 0.3, HALF_W * 2 + 1.2, 0.9, 0.6, wallMat);
    block(scene, -HALF_W - 0.3, 0.45, 0, 0.6, 0.9, HALF_D * 2, wallMat);
    block(scene, HALF_W + 0.3, 0.45, 0, 0.6, 0.9, HALF_D * 2, wallMat);

    const back = mesh(new THREE.PlaneGeometry(46, 12), mat(0xffffff, Tex.wall([11, 3])), 0, 6, -8, { cast: false });
    scene.add(back);
    stencil(scene, 'OVERHEAD LOADS', -4.5, 1.9, -7.95, { w: 7, h: 2, opacity: 0.55 });
    stencil(scene, 'QUOTA IS LAW', 5.5, 1.9, -7.95, { w: 6, h: 1.8, opacity: 0.4 });
    pipe(scene, [-23, 3.4, -7.8], [23, 3.4, -7.8], 0.2);
    pipe(scene, [-23, 2.9, -7.85], [23, 2.9, -7.85], 0.1, 0x5a3022);

    // Gantry: two rails on columns flanking the bay.
    const steel = mat(0xb08a2a, Tex.metal());
    const steelDark = mat(0x55524a, Tex.metal());
    for (const sx of [-1, 1]) {
      block(scene, sx * 9.8, 7.2, 0, 0.35, 0.45, 14.6, steel);
      block(scene, sx * 9.8, 3.6, -6.8, 0.4, 7.2, 0.4, steelDark);
      block(scene, sx * 9.8, 3.6, 6.8, 0.4, 7.2, 0.4, steelDark);
    }
    block(scene, 0, 7.2, -6.8, 20, 0.45, 0.35, steel);
    // Waiting freight outside the bay.
    crate(scene, -10.6, 0, -4.6, 1.2, 0.2);
    crate(scene, -10.4, 1.2, -4.7, 1.0, 0.7);
    crate(scene, -10.8, 0, -3.1, 1.1, -0.3);
    crate(scene, 10.6, 0, -4.2, 1.3, 0.1);
    crate(scene, 10.9, 0, 2.8, 1.0, 0.5);

    hangingLamp(scene, -4, 7, 0.5, { intensity: 90, angle: 0.9 });
    hangingLamp(scene, 4, 7, 0.5, { intensity: 90, angle: 0.9 });
    // Rotating warning beacon (cosmetic, no shadows).
    this.beaconMat = glow(0x5a0d06);
    scene.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), this.beaconMat, 0, 4.4, -7.7, { cast: false }));
    this.beacon = new THREE.PointLight(0xff3a14, 0, 12, 1.6);
    this.beacon.position.set(0, 4.2, -7.3);
    scene.add(this.beacon);

    // --- arena + avatars
    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, shoveForce: 12 });
    const n = this.seats.length;
    const spots = n <= 2 ? [[-3, 0.5], [3, 0.5]]
      : n === 3 ? [[-3.5, -1], [3.5, -1], [0, 2.5]]
        : [[-3, -1.5], [3, -1.5], [-3, 2.5], [3, 2.5]];
    this.seats.forEach((seat, i) => {
      const [x, z] = spots[i % spots.length];
      seat.idx = i;
      seat.score = 0;
      this.spawnSubject(seat, { x, z });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
    });
    this.arena.onShove = (a, b) => { b.data.lastShover = a.seat; b.data.shovedAt = this.time; };

    // --- shared geometry / materials, then the fixed pools
    this.geo = {
      crate: new THREE.BoxGeometry(1.3, 1.3, 1.3),
      base: new THREE.BoxGeometry(2.7, 0.22, 2.7),
      small: new THREE.BoxGeometry(1.2, 1.1, 1.2),
      strap: new THREE.BoxGeometry(2.62, 0.08, 0.16),
      cable: new THREE.CylinderGeometry(0.035, 0.035, 1, 4),
      hook: new THREE.BoxGeometry(0.34, 0.22, 0.34),
      bar: new THREE.BoxGeometry(2.3, 0.12, 0.12),
      disc: new THREE.CircleGeometry(1, 28),
      ring: new THREE.RingGeometry(0.9, 1, 36),
      tin: new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10),
      lid: new THREE.CylinderGeometry(0.26, 0.26, 0.05, 10),
      tokRing: new THREE.RingGeometry(0.36, 0.48, 20),
    };
    this.mats = {
      crate: mat(0xffffff, Tex.crate()),
      wood: mat(0xb08a60, Tex.wood()),
      strap: mat(0xffffff, Tex.hazard([2, 1])),
      cable: mat(0x1a1a1a),
      hook: mat(0x8a8d88, Tex.metal()),
      gold: glow(0xffc23a),
      lid: mat(0x8a6a1a, Tex.metal()),
      tokRing: new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.55, depthWrite: false }),
    };
    this.drops = [];
    let slot = 0;
    for (const kind of ['crate', 'pallet']) {
      for (let i = 0; i < KINDS[kind].pool; i++) this.drops.push(this._makeDrop(kind, slot++));
    }
    this.dropSerial = 0;

    this.tokens = [];
    const tokenCount = Math.min(5, n + 1);
    for (let i = 0; i < tokenCount; i++) this.tokens.push(this._makeToken());
    for (const tk of this.tokens) { this._placeToken(tk); tk.pop = 1; tk.g.scale.setScalar(1); }

    this.dropT = 1.0;          // first drop shortly after GO
    this.quotaStage = 0;
    this.palletWarned = false;
  }

  /** One pooled load: body + crane rig (hook and cable) + red shadow disc and ring. */
  _makeDrop(kind, slot) {
    const K = KINDS[kind], geo = this.geo, M = this.mats;
    const g = new THREE.Group();
    if (kind === 'crate') {
      g.add(mesh(geo.crate, M.crate, 0, 0.65, 0));
    } else {
      g.add(mesh(geo.base, M.wood, 0, 0.11, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(geo.small, M.crate, sx * 0.66, 0.77, sz * 0.66));
      const s1 = mesh(geo.strap, M.strap, 0, 0.8, 0);
      const s2 = mesh(geo.strap, M.strap, 0, 0.8, 0);
      s2.rotation.y = Math.PI / 2;
      g.add(s1, s2);
    }
    const rig = new THREE.Group();
    rig.position.y = K.top;
    rig.add(mesh(geo.hook, M.hook, 0, 0.11, 0));
    if (kind === 'pallet') rig.add(mesh(geo.bar, M.hook, 0, 0.04, 0));
    const cable = mesh(geo.cable, M.cable, 0, 0.22 + 4.5, 0, { cast: false, receive: false });
    cable.scale.y = 9;
    rig.add(cable);
    g.add(rig);
    g.visible = false;
    this.scene.add(g);

    const discMat = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0, depthWrite: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0, depthWrite: false });
    const y = 0.03 + slot * 0.0015;
    const disc = new THREE.Mesh(geo.disc, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = y;
    disc.visible = false;
    const ring = new THREE.Mesh(geo.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y + 0.0007;
    ring.visible = false;
    this.scene.add(disc, ring);
    return { kind, K, g, rig, disc, ring, discMat, ringMat, state: 'free', t: 0, x: 0, z: 0, col: null, notice: null, id: 0 };
  }

  /** One pooled golden ration tin with a floor ring. */
  _makeToken() {
    const g = new THREE.Group();
    const tin = new THREE.Group();
    tin.add(
      mesh(this.geo.tin, this.mats.gold, 0, 0, 0, { receive: false }),
      mesh(this.geo.lid, this.mats.lid, 0, 0.16, 0, { receive: false }),
      mesh(this.geo.lid, this.mats.lid, 0, -0.16, 0, { receive: false }),
    );
    tin.position.y = 0.45;
    tin.rotation.z = 0.25;
    const ring = new THREE.Mesh(this.geo.tokRing, this.mats.tokRing);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    g.add(tin, ring);
    g.visible = false;
    this.scene.add(g);
    return { g, tin, x: 0, z: 0, active: false, respawn: 0, pop: 0, phase: this.tokens.length * 1.7 };
  }

  start() {
    this.hud.banner('COLLECT THE RATIONS', 1400);
    this.hud.prompt('Grab golden rations · dodge red shadows · {B} shoves');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
    this._updateHud();
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    this._animateTokens(dt);
    this._animateBeacon();
  }

  // ------------------------------------------------------------------ drops

  _freeDrop(kind) {
    for (const d of this.drops) if (d.state === 'free' && d.kind === kind) return d;
    return null;
  }

  /** Choose an impact point: on a subject, on a ration, or anywhere. Avoids other loads. */
  _pickSpot(r) {
    const lx = HALF_W - r * 0.75, lz = HALF_D - r * 0.75;
    for (let tries = 0; tries < 10; tries++) {
      const m = random();
      let x, z;
      const alive = this.aliveSeats;
      const live = this.tokens.filter((t) => t.active);
      if (m < 0.45 && alive.length) {
        const a = pick(alive).actor;
        const lead = rand(0, 0.45);
        x = a.pos.x + a.vel.x * lead + rand(-1, 1) * r * 0.7;
        z = a.pos.z + a.vel.z * lead + rand(-1, 1) * r * 0.7;
      } else if (m < 0.72 && live.length) {
        const t = pick(live);
        x = t.x + rand(-0.7, 0.7);
        z = t.z + rand(-0.7, 0.7);
      } else {
        x = rand(-lx, lx);
        z = rand(-lz, lz);
      }
      x = clamp(x, -lx, lx);
      z = clamp(z, -lz, lz);
      let ok = true;
      for (const d of this.drops) {
        if (d.state === 'free') continue;
        if (Math.hypot(d.x - x, d.z - z) < d.K.r + r - 0.25) { ok = false; break; }
      }
      if (ok) return { x, z };
    }
    return null;
  }

  _spawnDrop(kind) {
    let d = this._freeDrop(kind);
    if (!d && kind === 'pallet') { kind = 'crate'; d = this._freeDrop(kind); }
    if (!d) return false;
    const spot = this._pickSpot(d.K.r);
    if (!spot) return false;
    d.state = 'warn';
    d.t = 0;
    d.x = spot.x; d.z = spot.z;
    d.id = ++this.dropSerial;
    d.g.position.set(d.x, HANG_TOP, d.z);
    d.g.rotation.y = rand(0, Math.PI / 2);
    d.g.visible = true;
    d.rig.visible = true;
    d.disc.position.x = d.ring.position.x = d.x;
    d.disc.position.z = d.ring.position.z = d.z;
    d.disc.scale.setScalar(0.01);
    d.ring.scale.setScalar(d.K.r);
    d.discMat.opacity = 0;
    d.ringMat.opacity = 0;
    d.disc.visible = d.ring.visible = true;
    // Per-seat moment a bot "notices" this shadow (humans: immediately).
    d.notice = this.seats.map((s) => (s.isBot
      ? s.brain.reaction + (1 - s.brain.difficulty) * 0.2 + (random() < s.brain.error * 0.5 ? 0.35 : 0)
      : 0));
    if (kind === 'pallet' && !this.palletWarned) {
      this.palletWarned = true;
      this.hud.banner('HEAVY LOADS INBOUND', 1300, 'danger');
    }
    Audio.sfx('tick', { vol: 0.5 });
    return true;
  }

  /** Spawn schedule: interval shrinks 1.5 s → 0.5 s; pallets and pairs later on. */
  _schedule(dt) {
    this.dropT -= dt;
    if (this.dropT > 0) return;
    const p = clamp(this.time / ROUND_TIME, 0, 1);
    this.dropT += 1.5 - p * 1.0;
    const palletChance = this.time < 8 ? 0 : 0.1 + 0.2 * p;
    this._spawnDrop(random() < palletChance ? 'pallet' : 'crate');
    if (this.time > 15 && random() < 0.15 + 0.35 * p) this._spawnDrop('crate');
  }

  _updateDrops(dt, live) {
    for (const d of this.drops) {
      if (d.state === 'free') continue;
      d.t += dt;
      const K = d.K;
      if (d.state === 'warn') {
        const hang = K.warn - FALL;
        const k = Math.min(1, d.t / K.warn);
        if (d.t < hang) {
          const e = d.t / hang;
          d.g.position.y = HANG_TOP + (HANG_LOW - HANG_TOP) * (1 - (1 - e) * (1 - e));
        } else {
          d.rig.visible = false; // released
          const f = Math.min(1, (d.t - hang) / FALL);
          d.g.position.y = HANG_LOW * (1 - f * f);
        }
        d.disc.scale.setScalar(K.r * (0.2 + 0.8 * k));
        d.discMat.opacity = 0.18 + 0.42 * k;
        d.ringMat.opacity = 0.45 + 0.45 * Math.abs(Math.sin(d.t * (6 + 10 * k)));
        if (d.t >= K.warn) this._impact(d, live);
      } else if (d.state === 'landed') {
        if (d.t >= K.stay) {
          d.state = 'clear';
          d.t = 0;
          if (d.col) { const c = d.col; this.arena.circles = this.arena.circles.filter((o) => o !== c); d.col = null; }
          d.rig.visible = true;
        }
      } else if (d.state === 'clear') {
        const c = Math.min(1, d.t / CLEAR_TIME);
        d.g.position.y = c * c * HANG_TOP;
        if (c >= 1) { d.state = 'free'; d.g.visible = false; d.rig.visible = true; }
      }
    }
  }

  /** Load hits the floor: crush whoever is under it, knock back the near misses. */
  _impact(d, live) {
    const K = d.K, heavy = d.kind === 'pallet';
    d.state = 'landed';
    d.t = 0;
    d.g.position.y = 0;
    d.disc.visible = d.ring.visible = false;
    d.col = this.arena.addCircle(d.x, d.z, K.col);
    Audio.sfx('thud', { vol: heavy ? 1 : 0.8 });
    Audio.sfx(heavy ? 'crunch' : 'clank', { vol: heavy ? 0.6 : 0.45 });
    this.engine.shake(heavy ? 0.35 : 0.12);
    const puffs = heavy ? 5 : 3;
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + d.id;
      this.fx.smoke(new THREE.Vector3(d.x + Math.cos(ang) * K.r * 0.8, 0.2, d.z + Math.sin(ang) * K.r * 0.8),
        { color: 0x7d7566, size: heavy ? 0.6 : 0.4, rise: 0.6, life: 0.9, opacity: 0.45 });
    }
    // Rations under the load are lost.
    for (const tk of this.tokens) {
      if (tk.active && Math.hypot(tk.x - d.x, tk.z - d.z) < K.r) this._despawnToken(tk, 0.6);
    }
    if (!live) return;
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor;
      const dx = a.pos.x - d.x, dz = a.pos.z - d.z, dist = Math.hypot(dx, dz);
      if (dist < K.r + KILL_PAD) {
        this._credit(seat);
        this.kill(seat, 'crush');
        continue;
      }
      if (dist < K.r + 1.0 && dist > 1e-4) {
        const w = 1 - (dist - K.r) / 1.0;
        a.knock.x += (dx / dist) * 6 * w;
        a.knock.z += (dz / dist) * 6 * w;
        if (w > 0.5) a.stun = Math.max(a.stun, 0.2);
      }
    }
  }

  /** Feed line if a rival shoved the victim in the last moments. */
  _credit(seat) {
    const data = seat.actor.data;
    const by = data.lastShover;
    if (by && by !== seat && this.time - data.shovedAt < 1.6) {
      this.hud.feed(`${by.player.name} shoved ${seat.player.name} under the load`, by.player.color);
    }
  }

  // ----------------------------------------------------------------- tokens

  _placeToken(tk) {
    let x = 0, z = 0;
    for (let i = 0; i < 14; i++) {
      x = rand(-HALF_W + 1, HALF_W - 1);
      z = rand(-HALF_D + 1, HALF_D - 1);
      let ok = true;
      for (const s of this.seats) {
        if (s.alive && s.actor && Math.hypot(s.actor.pos.x - x, s.actor.pos.z - z) < 2.2) { ok = false; break; }
      }
      if (ok) for (const d of this.drops) {
        if ((d.state === 'landed' || d.state === 'warn') && Math.hypot(d.x - x, d.z - z) < d.K.r + 0.5) { ok = false; break; }
      }
      if (ok) for (const o of this.tokens) {
        if (o !== tk && o.active && Math.hypot(o.x - x, o.z - z) < 2.5) { ok = false; break; }
      }
      if (ok) break;
    }
    tk.x = x; tk.z = z;
    tk.active = true;
    tk.pop = 0;
    tk.g.position.set(x, 0, z);
    tk.g.scale.setScalar(0.01);
    tk.g.visible = true;
  }

  _despawnToken(tk, delay) {
    tk.active = false;
    tk.g.visible = false;
    tk.respawn = delay;
  }

  _animateTokens(dt) {
    for (const tk of this.tokens) {
      if (!tk.active) continue;
      tk.pop = Math.min(1, tk.pop + dt * 4);
      tk.g.scale.setScalar(Math.max(0.01, tk.pop));
      tk.tin.rotation.y += dt * 2.5;
      tk.tin.position.y = 0.45 + Math.sin(this.clock * 3 + tk.phase) * 0.08;
    }
  }

  _updateTokens(dt) {
    for (const tk of this.tokens) {
      if (!tk.active) {
        tk.respawn -= dt;
        if (tk.respawn <= 0) this._placeToken(tk);
        continue;
      }
      for (const seat of this.seats) {
        if (!seat.alive) continue;
        const a = seat.actor;
        if (Math.hypot(a.pos.x - tk.x, a.pos.z - tk.z) < PICKUP_R) {
          seat.score += 1;
          this._despawnToken(tk, 0.8);
          Audio.sfx('ding', { vol: 0.5 });
          this.fx.sparks(new THREE.Vector3(tk.x, 0.5, tk.z), { color: 0xffd040, count: 8, speed: 4 });
          break;
        }
      }
    }
  }

  _animateBeacon() {
    const s = Math.sin(this.clock * 7);
    this.beacon.intensity = Math.max(0, s) * 9;
    this.beaconMat.color.setHex(s > 0 ? 0xff3a14 : 0x5a0d06);
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    this._animateBeacon();
    this._animateTokens(dt);
    if (playing) this._schedule(dt);
    this._updateDrops(dt, playing);
    if (!playing) return;
    this._updateTokens(dt);

    if (this.quotaStage === 0 && this.time >= 20) { this.quotaStage = 1; this.hud.banner('QUOTA RAISED', 1200, 'danger'); }
    if (this.quotaStage === 1 && this.time >= 40) { this.quotaStage = 2; this.hud.banner('QUOTA RAISED', 1200, 'danger'); }

    this._updateHud();
    this.hud.setTimer(Math.max(0, ROUND_TIME - this.time));

    const alive = this.aliveSeats.length;
    if (alive === 0) { this.hud.banner('NO SURVIVORS', 2000, 'danger'); this.end(2.6); return; }
    if (this.time >= ROUND_TIME || (this.seats.length > 1 && alive <= 1)) {
      Audio.sfx('horn');
      this.hud.banner('SHIFT OVER', 2000);
      this.end(2.6);
    }
  }

  _updateHud() {
    let top = 0;
    for (const s of this.seats) top = Math.max(top, s.score);
    for (const seat of this.seats) {
      if (seat.alive) {
        this.hud.setStat(seat, `PTS ${seat.score}`);
        this.hud.setStatus(seat, top > 0 && seat.score === top ? 'TOP EARNER' : '');
      } else {
        this.hud.setStat(seat, `FLATTENED · PTS ${seat.score}`);
        this.hud.setStatus(seat, '');
      }
    }
  }

  /** Survivors first (by points), then the crushed (by points, later death higher). */
  placement() {
    const alive = this.seats.filter((s) => s.alive).sort((a, b) => b.score - a.score);
    const dead = this.seats.filter((s) => !s.alive)
      .sort((a, b) => (b.score - a.score) || (b.deathTime - a.deathTime));
    return [
      ...groupBy(alive, (s) => s.score),
      ...groupBy(dead, (s) => `${s.score}|${s.deathTime.toFixed(3)}`),
    ];
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    const i = seat.idx, diff = brain.difficulty, speed = a.speed;
    const look = diff >= 0.5; // look-ahead path planning around shadows
    const noticed = (d) => d.state === 'warn' && d.t >= d.notice[i];

    // 1. Pick a ration: nearest, penalised if a shadow will land on it first or a rival is closer.
    let tgt = null, best = Infinity;
    for (const tk of this.tokens) {
      if (!tk.active) continue;
      const dist = Math.hypot(tk.x - a.pos.x, tk.z - a.pos.z);
      let cost = dist;
      if (look) {
        for (const d of this.drops) {
          if (!noticed(d)) continue;
          const tti = d.K.warn - d.t;
          if (Math.hypot(tk.x - d.x, tk.z - d.z) < d.K.r + 0.4 && dist / speed < tti + 0.3) cost += 5;
        }
        for (const o of this.seats) {
          if (o === seat || !o.alive) continue;
          if (Math.hypot(tk.x - o.actor.pos.x, tk.z - o.actor.pos.z) < dist - 1.5) { cost += 1.5 * diff; break; }
        }
      }
      if (cost < best) { best = cost; tgt = tk; }
    }
    let mx = 0, mz = 0;
    {
      const gx = tgt ? tgt.x : 0, gz = tgt ? tgt.z : 0;
      const dx = gx - a.pos.x, dz = gz - a.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 0.15) { const s = Math.min(1, dd / 0.6); mx = (dx / dd) * s; mz = (dz / dd) * s; }
    }

    // 2. Shadows: get out if inside; with look-ahead, route around ones on the way.
    let fx = 0, fz = 0, inside = false;
    for (const d of this.drops) {
      if (!noticed(d)) continue;
      const tti = d.K.warn - d.t;
      const dx = a.pos.x - d.x, dz = a.pos.z - d.z, dist = Math.hypot(dx, dz);
      const safe = d.K.r + KILL_PAD + a.radius * 0.6 + 0.15 * diff;
      if (dist < safe) {
        inside = true;
        let ux, uz;
        if (dist > 0.05) { ux = dx / dist; uz = dz / dist; } else { ux = i % 2 ? 1 : -1; uz = 0; }
        const w = 2 + (safe - dist) * 2;
        fx += ux * w; fz += uz * w;
      } else if (look) {
        const reach = speed * Math.min(tti, 0.9);
        const ml = Math.hypot(mx, mz);
        if (dist < safe + reach && ml > 0.1) {
          const ex = a.pos.x + (mx / ml) * reach, ez = a.pos.z + (mz / ml) * reach;
          if (segDist(a.pos.x, a.pos.z, ex, ez, d.x, d.z) < safe) {
            let tx = -dz / dist, tz = dx / dist;
            if (tx * mx + tz * mz < 0) { tx = -tx; tz = -tz; }
            fx += tx * 1.6 + (dx / dist) * 0.6;
            fz += tz * 1.6 + (dz / dist) * 0.6;
            mx *= 0.3; mz *= 0.3;
          }
        }
      }
    }

    // 3. Landed loads: slide around them instead of pushing into them.
    for (const d of this.drops) {
      if (!d.col) continue;
      const dx = a.pos.x - d.x, dz = a.pos.z - d.z, dist = Math.hypot(dx, dz) || 0.01;
      const edge = dist - d.K.col - a.radius;
      const ml = Math.hypot(mx, mz);
      if (edge < 0.9 && ml > 0.1 && (-dx * mx - dz * mz) / (dist * ml) > 0.2) {
        let tx = -dz / dist, tz = dx / dist;
        if (tx * mx + tz * mz < 0) { tx = -tx; tz = -tz; }
        const w = (0.9 - edge) * 1.3;
        fx += tx * w; fz += tz * w;
      }
    }

    let vx, vz;
    if (inside) {
      vx = fx + mx * 0.15; vz = fz + mz * 0.15;
      // Escaping into a wall: slide along it instead.
      const m = 0.75;
      if ((a.pos.x > HALF_W - m && vx > 0) || (a.pos.x < -HALF_W + m && vx < 0)) { const s = Math.abs(vx); vx = 0; vz += (vz >= 0 ? 1 : -1) * s; }
      if ((a.pos.z > HALF_D - m && vz > 0) || (a.pos.z < -HALF_D + m && vz < 0)) { const s = Math.abs(vz); vz = 0; vx += (vx >= 0 ? 1 : -1) * s; }
    } else {
      vx = mx + fx; vz = mz + fz;
    }

    // 4. Shoves: feed a rival to a load about to land (skilled bots), or jostle over a ration.
    let wantB = false;
    if (!inside) {
      for (const o of this.seats) {
        if (o === seat || !o.alive) continue;
        const t = o.actor;
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, dist = Math.hypot(dx, dz);
        if (dist > 1.45 || dist < 0.2) continue;
        const ux = dx / dist, uz = dz / dist;
        let lethal = false;
        if (diff >= 0.55) {
          const lx = t.pos.x + ux * 1.8, lz = t.pos.z + uz * 1.8;
          for (const d of this.drops) {
            if (!noticed(d)) continue;
            const tti = d.K.warn - d.t;
            if (tti > 0.12 && tti < 0.6 && Math.hypot(lx - d.x, lz - d.z) < d.K.r) { lethal = true; break; }
          }
        }
        const contest = !!tgt && dist < 1.2 && Math.hypot(tgt.x - t.pos.x, tgt.z - t.pos.z) < 2;
        if ((lethal && random() < 0.35 * diff) || (contest && random() < 0.012 * diff)) {
          vx = ux; vz = uz; // face the victim (the arena turns us toward the stick)
          wantB = true;
          break;
        }
      }
    }
    a.ctrl.setMove(vx, vz);
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    const press = wantB && !mem.bPrev;
    a.ctrl.setButtons(false, press);
    mem.bPrev = press;
    void dt;
  }
}
