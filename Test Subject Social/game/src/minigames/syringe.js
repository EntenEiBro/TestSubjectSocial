/**
 * SYRINGE HUNT — a dim storage office, twelve containers, one loaded syringe.
 *
 * Rules:
 *  - One random locker / cabinet / desk drawer secretly holds the syringe.
 *    Stand at a container's front and HOLD A for 1.2 s to search it (a ring
 *    fills above your head). Searched containers stay open.
 *  - The finder becomes the INFECTED carrier, syringe visible in hand.
 *    Infected subjects press A next to a clean subject to stab them: the
 *    victim convulses, turns green and joins the hunt a little faster than
 *    clean subjects (+5 %; the carrier +4 %).
 *  - Clean subjects can B-shove infected ones to stun them for 2.6 s
 *    (infected subjects cannot shove).
 *  - The hunt lasts 60 s after the syringe is found (75 s total cap).
 *  - Everyone infected → the original carrier wins, the rest rank by
 *    infection order (later = better). Time out → survivors share first
 *    place, the infected are purged (killed) and ranked carrier first, then
 *    later-infected above earlier-infected.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { room, stencil, hazardStrip, mesh, pipe, crate } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { dist2D, clamp } from '../core/util.js';
import { rand, pick, random } from '../core/rng.js';

const HALF_W = 9, MIN_Z = -6.1, MAX_Z = 5.5;
const SEARCH_TIME = 1.2;
const SEARCH_REACH = 1.0;
const HUNT_TIME = 40, TOTAL_CAP = 70;
const STAB_RANGE = 1.2, STAB_CD = 1.6;
const CONVULSE = 4.0;            // fresh victims writhe before joining the hunt
// The infected are slightly faster than clean subjects; the longer daze and
// convulsion keep survival possible (bot tests: survivors in ~1 of 5 rounds).
const INFECTED_SPEED = 1.05;     // stab victims who join the hunt
const CARRIER_SPEED = 1.04;      // the original carrier
const PRIME_TIME = 2.5;          // finder uncaps the needle (survivors' head start)
const STUN_TIME = 2.6;           // a survivor's shove leaves a hunter dazed this long
const HINT_AFTER = 25;           // the hiding place starts rattling if nobody found it
const GREEN = new THREE.Color(0x5cff4a);

/** Container footprints in local space (front = +Z). */
const KINDS = {
  locker: { w: 0.9, h: 2.0, d: 0.6, color: 0x56645a },
  cabinet: { w: 1.0, h: 1.2, d: 0.6, color: 0x7a7466 },
  desk: { w: 1.5, h: 0.85, d: 0.8, color: 0xffffff },
};

/** [x, z, kind, rotY] — rotY 0 faces +Z (camera), π/2 faces +X, -π/2 faces -X. */
const LAYOUT = [
  [-6.3, -5.65, 'locker', 0], [-2.4, -5.65, 'locker', 0], [2.4, -5.65, 'locker', 0], [6.3, -5.65, 'locker', 0],
  [-8.65, -2.2, 'cabinet', Math.PI / 2], [-8.65, 2.2, 'cabinet', Math.PI / 2],
  [8.65, -2.2, 'cabinet', -Math.PI / 2], [8.65, 2.2, 'cabinet', -Math.PI / 2],
  [-4.2, 0.2, 'desk', 0], [4.2, 0.2, 'desk', 0], [0, -2.6, 'cabinet', 0], [0, 2.2, 'desk', 0],
];

/** Low-poly syringe along +Z (needle forward), roughly 0.6 units long. */
function syringeModel() {
  const g = new THREE.Group();
  const barrel = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), new THREE.MeshBasicMaterial({ color: 0x6cff5a, transparent: true, opacity: 0.85 }), 0, 0, 0, { cast: false });
  barrel.rotation.x = Math.PI / 2;
  const rod = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4), mat(0xdddddd), 0, 0, -0.24);
  rod.rotation.x = Math.PI / 2;
  const thumb = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), mat(0xdddddd), 0, 0, -0.32);
  thumb.rotation.x = Math.PI / 2;
  const flange = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), mat(0xdddddd), 0, 0, -0.16);
  const needle = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4), mat(0xeeeeee), 0, 0, 0.27);
  needle.rotation.x = Math.PI / 2;
  g.add(barrel, rod, thumb, flange, needle);
  return g;
}

export class SyringeHunt extends Minigame {
  static meta = {
    id: 'syringe',
    title: 'SYRINGE HUNT',
    tagline: 'One dose. Plenty of volunteers.',
    category: 'Deception',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Hold: search · Tap: stab' }, { input: 'b', label: 'Shove (stuns infected)' }],
    objective: 'Find the syringe and infect everyone — or stay clean until the clock runs out.',
    rules: [
      'Hold {A} at a locker, cabinet or desk to search it. One of them hides the syringe.',
      'The finder is infected. Infected subjects are slightly faster and stab others with {A} to convert them.',
      'Clean subjects shove the infected to stun them. At time-out the infected are purged.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 46, ambient: 0x34363c });
    this.makeCamera([0, 15, 11], [0, 0, -0.4], 50);

    // Room: north wall inner face sits at z = MIN_Z, open toward the camera.
    room(scene, HALF_W * 2 + 0.6, 12.6, 4.5, { floorTex: 'tiles', tile: 1.5, open: ['south'] }).position.z = MIN_Z + 6.15;
    stencil(scene, 'HIDE', 0, 3.2, MIN_Z + 0.03, { w: 4.6, h: 1.7, opacity: 0.6 });
    pipe(scene, [-HALF_W, 4.1, MIN_Z + 0.1], [HALF_W, 4.1, MIN_Z + 0.1], 0.12);
    hazardStrip(scene, 0, MAX_Z - 0.15, HALF_W * 2, 0.3, 0.012);
    crate(scene, -HALF_W + 0.6, 0, MAX_Z - 0.8, 0.8, 0.3);
    crate(scene, HALF_W - 0.7, 0, -4.4, 0.9, -0.2);

    hangingLamp(scene, -4.8, 7, -0.5, { intensity: 85, angle: 1.0 });
    hangingLamp(scene, 4.8, 7, -0.5, { intensity: 85, angle: 1.0 });
    hangingLamp(scene, 0, 6.5, -4.6, { intensity: 40, angle: 0.9, shadow: false, target: { x: 0, y: 0, z: 0 } });

    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: MIN_Z, maxZ: MAX_Z }, shoveForce: 11 });
    this.arena.addWall(-HALF_W + 0.2, -HALF_W + 1.0, MAX_Z - 1.2, MAX_Z - 0.4); // crate by the door
    this.arena.addWall(HALF_W - 1.15, HALF_W - 0.25, -4.85, -3.95);

    this.containers = LAYOUT.map(([x, z, kind, rotY]) => this._buildContainer(scene, x, z, kind, rotY));
    pick(this.containers).hasSyringe = true;

    // Avatars along the doorway, plus a per-seat search ring.
    const n = this.seats.length;
    this.seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * 2.4, z = 3.9;
      this.spawnSubject(seat, { x, z, facing: Math.PI });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.facing = Math.PI;
      seat.actor.seat = seat;
      Object.assign(seat, { infected: false, carrier: false, convulse: 0, prime: 0, stabCd: 0, jabs: 0, opened: 0, search: { c: null, t: 0 }, syringe: null });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 24, 1), new THREE.MeshBasicMaterial({ color: seat.player.color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      ring.renderOrder = 10;
      ring.visible = false;
      scene.add(ring);
      seat.ring = ring;
    });
    this.arena.onShove = (a, b) => {
      if (b.seat && b.seat.infected && a.seat && !a.seat.infected) {
        b.stun = STUN_TIME;
        Audio.sfx('thud');
        this.fx.sparks(b.pos.clone().setY(1.9), { count: 6, speed: 2, color: 0xffffff });
      }
    };

    this.found = false;
    this.foundAt = 0;
    this.endAt = TOTAL_CAP;
    this.infectOrder = [];
    this.outcome = null;
    this.purge = [];
    this.purgeT = 0;
    this.hintT = 0;
  }

  // ------------------------------------------------------------------ stage

  /** Build a searchable container (locker, filing cabinet or desk) and its collider. */
  _buildContainer(scene, x, z, kind, rotY) {
    const K = KINDS[kind];
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const body = kind === 'desk' ? mat(0xffffff, Tex.wood()) : mat(K.color, Tex.metal());
    const dark = mat(0x161616);
    const c = { kind, x, z, rotY, w: K.w, d: K.d, group: g, searched: false, open: 0, hasSyringe: false, door: null, drawer: null };
    if (kind === 'desk') {
      g.add(mesh(new THREE.BoxGeometry(K.w, 0.08, K.d), body, 0, K.h - 0.04, 0));
      g.add(mesh(new THREE.BoxGeometry(0.62, K.h - 0.08, K.d - 0.04), body, 0.4, (K.h - 0.08) / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(0.08, K.h - 0.08, K.d - 0.04), body, -0.7, (K.h - 0.08) / 2, 0));
      const drawer = new THREE.Group();
      drawer.position.set(0.4, K.h - 0.28, 0);
      drawer.add(mesh(new THREE.BoxGeometry(0.56, 0.24, 0.05), mat(0x8a6a42, Tex.wood()), 0, 0, K.d / 2));
      drawer.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), mat(0xb0a070), 0, 0, K.d / 2 + 0.04));
      drawer.add(mesh(new THREE.BoxGeometry(0.5, 0.18, K.d - 0.1), dark, 0, -0.02, 0));
      g.add(drawer);
      c.drawer = drawer;
      // Clutter on the desk top
      g.add(mesh(new THREE.BoxGeometry(0.4, 0.04, 0.3), mat(0xd8d2c0, Tex.fabric()), -0.35, K.h + 0.02, 0.05));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6), mat(0x7a2323), 0.1, K.h + 0.05, -0.15));
    } else {
      g.add(mesh(new THREE.BoxGeometry(K.w, K.h, K.d - 0.04), body, 0, K.h / 2, -0.02));
      g.add(mesh(new THREE.BoxGeometry(K.w - 0.1, K.h - 0.12, 0.02), dark, 0, K.h / 2, K.d / 2 - 0.03));
      const pivot = new THREE.Group();
      pivot.position.set(-K.w / 2 + 0.03, 0, K.d / 2);
      const doorMat = mat(new THREE.Color(K.color).multiplyScalar(1.15), Tex.metal());
      pivot.add(mesh(new THREE.BoxGeometry(K.w - 0.06, K.h - 0.08, 0.04), doorMat, (K.w - 0.06) / 2, K.h / 2, 0.02));
      pivot.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), mat(0xa0a0a0), K.w - 0.16, K.h * 0.55, 0.06));
      if (kind === 'locker') for (let i = 0; i < 3; i++) pivot.add(mesh(new THREE.BoxGeometry(0.4, 0.03, 0.01), dark, (K.w - 0.06) / 2, K.h - 0.25 - i * 0.07, 0.045));
      else pivot.add(mesh(new THREE.BoxGeometry(0.5, 0.03, 0.01), dark, (K.w - 0.06) / 2, K.h * 0.5, 0.045));
      g.add(pivot);
      c.door = pivot;
    }
    scene.add(g);
    // Collider (footprint rotated by 0 or ±90°)
    const side = Math.abs(Math.sin(rotY)) > 0.5;
    const hw = (side ? K.d : K.w) / 2, hd = (side ? K.w : K.d) / 2;
    this.arena.addWall(x - hw, x + hw, z - hd, z + hd);
    const reach = K.d / 2 + 0.55;
    c.front = { x: x + Math.sin(rotY) * reach, z: z + Math.cos(rotY) * reach };
    return c;
  }

  // -------------------------------------------------------------- mechanics

  /** Finish searching a container. */
  _openContainer(c, seat) {
    c.searched = true;
    seat.opened++;
    Audio.sfx('search');
    if (!c.hasSyringe) { Audio.sfx('clank', { vol: 0.3 }); return; }
    this.found = true;
    this.foundAt = this.time;
    this.endAt = Math.min(this.foundAt + HUNT_TIME, TOTAL_CAP);
    this._infect(seat, true);
    this.hud.banner('SOMEONE HAS THE SYRINGE', 2000, 'danger');
    this.hud.feed(`${seat.player.name} FOUND THE SYRINGE`, seat.player.color);
    Audio.sfx('sting', { vol: 0.7 });
    for (const s of this.seats) { s.actor.frozen = s.convulse > 0; s.search.c = null; s.search.t = 0; s.ring.visible = false; }
    // The finder needs a moment to uncap the needle: everyone else gets a head start.
    seat.prime = PRIME_TIME;
    seat.actor.frozen = true;
  }

  /** Mark a seat infected. Carriers get the syringe at once; stab victims after convulsing. */
  _infect(seat, carrier = false) {
    seat.infected = true;
    seat.carrier = carrier;
    seat.infectedAt = this.time;
    this.infectOrder.push(seat);
    // Green tint + faint glow on every body mesh.
    seat.subject.root.traverse((o) => {
      if (!o.isMesh || o === seat.subject.ring || !o.material || !o.material.color) return;
      o.material = o.material.clone();
      o.material.color.lerp(GREEN, 0.4);
      if (o.material.emissive) o.material.emissive.setHex(0x0c2a0a);
    });
    if (carrier) this._armSyringe(seat);
    else { seat.convulse = CONVULSE; seat.actor.frozen = true; }
  }

  /** Put a syringe in the seat's right hand and switch it to hunter stats. */
  _armSyringe(seat) {
    const holder = new THREE.Group();
    holder.position.set(0, -0.78, 0.05);
    holder.rotation.x = Math.PI / 2;
    const s = syringeModel();
    s.scale.setScalar(1.3);
    holder.add(s);
    seat.subject.parts.armR.add(holder);
    seat.syringe = holder;
    seat.actor.speedMul = seat.carrier ? CARRIER_SPEED : INFECTED_SPEED;
    seat.actor.shoveCd = 1e9; // infected cannot shove
  }

  _tryStab(seat) {
    const a = seat.actor;
    seat.stabCd = 0.5;
    const f = a.forward;
    let best = null, bd = Infinity;
    for (const s of this.aliveSeats) {
      if (s.infected) continue;
      const dx = s.actor.pos.x - a.pos.x, dz = s.actor.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > STAB_RANGE || d < 1e-3) continue;
      if ((dx * f.x + dz * f.z) / d < -0.2) continue;
      if (d < bd) { bd = d; best = s; }
    }
    a.subject.push();
    if (!best) { Audio.sfx('whoosh', { vol: 0.4 }); return; }
    seat.stabCd = STAB_CD;
    seat.jabs++;
    if (seat.carrier && this.time - this.foundAt <= 3) this.award(seat, 'quickJab');
    this._infect(best, false);
    best.actor.knock.addScaledVector(new THREE.Vector3(best.actor.pos.x - a.pos.x, 0, best.actor.pos.z - a.pos.z).normalize(), 4);
    Audio.sfx('inject');
    this.fx.sparks(best.actor.pos.clone().setY(1.3), { count: 10, speed: 3, color: 0x6cff5a });
    this.hud.feed(`${seat.player.name} ▸ ${best.player.name} INFECTED`, seat.player.color);
  }

  // -------------------------------------------------------------- lifecycle

  start() {
    this.hud.prompt('Hold {A} at a container to search it');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
  }

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    this._animate(dt);
    if (!playing) { this._runPurge(dt); return; }

    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      seat.stabCd = Math.max(0, seat.stabCd - dt);
      if (seat.convulse > 0) {
        seat.convulse -= dt;
        if (seat.convulse <= 0) { a.frozen = false; seat.subject.root.rotation.set(0, seat.subject.root.rotation.y, 0); this._armSyringe(seat); }
        continue;
      }
      if (seat.prime > 0) { seat.prime -= dt; if (seat.prime <= 0) a.frozen = false; continue; }
      if (!this.found) this._searchStep(seat, dt);
      else if (seat.infected && seat.ctrl.aPressed && seat.stabCd <= 0 && a.stun <= 0) this._tryStab(seat);
    }

    // The hiding place starts to rattle if nobody has found it for a while.
    if (!this.found && this.time > HINT_AFTER) {
      this.hintT -= dt;
      if (this.hintT <= 0) { this.hintT = 1.5; Audio.sfx('clank', { vol: 0.35 }); }
    }

    // HUD
    const survivors = this.seats.filter((s) => s.alive && !s.infected);
    for (const s of this.seats) {
      this.hud.setStatus(s, s.carrier ? 'CARRIER' : s.infected ? 'INFECTED' : this.found ? 'CLEAN' : 'SEARCHING');
      this.hud.setStat(s, s.infected ? `JABS ${s.jabs}` : `OPENED ${s.opened}`);
    }
    this.hud.setTimer(this.endAt - this.time);

    if (this.found && survivors.length === 0) {
      this.outcome = 'infected';
      this.hud.banner('TOTAL INFECTION', 2200, 'danger');
      Audio.sfx('sting');
      // The carrier is spared; everyone they turned is purged.
      const doomed = this.infectOrder.slice(1).filter((s) => s.alive);
      this.purge = doomed.map((s, i) => ({ seat: s, at: 1.0 + i * 0.6 }));
      this.purgeT = 0;
      this.end(2.2 + doomed.length * 0.6);
    } else if (this.time >= this.endAt) {
      this._timeout();
    }
  }

  /** Hold-A container search for one seat. */
  _searchStep(seat, dt) {
    const a = seat.actor, srch = seat.search;
    let target = null;
    if (seat.ctrl.a && a.stun <= 0) {
      let bd = SEARCH_REACH;
      for (const c of this.containers) {
        if (c.searched) continue;
        const d = dist2D(a.pos, c.front);
        if (d < bd) { bd = d; target = c; }
      }
    }
    if (!target) { srch.c = null; srch.t = 0; a.frozen = false; seat.ring.visible = false; return; }
    if (srch.c !== target) { srch.c = target; srch.t = 0; Audio.sfx('search', { vol: 0.4 }); }
    srch.t += dt;
    a.frozen = true;
    a.facing = target.rotY + Math.PI;
    seat.ring.visible = true;
    const k = clamp(srch.t / SEARCH_TIME, 0, 1);
    seat.ring.geometry.setDrawRange(0, Math.max(1, Math.floor(k * 24)) * 6);
    if (srch.t >= SEARCH_TIME) {
      srch.c = null; srch.t = 0; a.frozen = false; seat.ring.visible = false;
      this._openContainer(target, seat);
    }
  }

  /** Doors, rings, convulsions and poses. */
  _animate(dt) {
    for (const c of this.containers) {
      if (c.searched && c.open < 1) c.open = Math.min(1, c.open + dt * 3);
      let jiggle = 0;
      if (!this.found && c.hasSyringe && this.time > HINT_AFTER && this.state === 'play') jiggle = Math.abs(Math.sin(this.time * 30)) * 0.06;
      if (c.door) c.door.rotation.y = -(c.open * 1.9 + jiggle);
      if (c.drawer) c.drawer.position.z = c.open * 0.45 + jiggle;
    }
    const v = new THREE.Vector3();
    for (const s of this.seats) {
      if (!s.alive) { s.ring.visible = false; continue; }
      if (s.ring.visible) {
        s.subject.parts.head.getWorldPosition(v);
        s.ring.position.set(v.x, v.y + 0.75, v.z);
        s.ring.quaternion.copy(this.camera.quaternion);
      }
      const root = s.subject.root;
      if (s.convulse > 0) {
        root.rotation.z = Math.sin(this.time * 45) * 0.2;
        root.rotation.x = Math.sin(this.time * 31) * 0.1;
        s.subject.pose = 'armsUp';
      } else {
        s.subject.pose = s.prime > 0 ? 'armsUp' : s.actor.stun > 0.3 ? 'cower' : s.syringe ? 'hold' : 'idle';
      }
    }
  }

  /** Time ran out: survivors win, the infected are purged one by one. */
  _timeout() {
    this.outcome = 'timeout';
    const doomed = this.infectOrder.filter((s) => s.alive);
    this.hud.banner(doomed.length ? 'TIME UP — PURGING THE INFECTED' : 'TIME UP', 2200, doomed.length ? 'danger' : 'good');
    Audio.sfx('buzz');
    this.purge = doomed.map((s, i) => ({ seat: s, at: 0.8 + i * 0.6 }));
    this.purgeT = 0;
    this.end(1.8 + doomed.length * 0.6);
  }

  _runPurge(dt) {
    if (!this.purge.length) return;
    this.purgeT += dt;
    for (const p of this.purge) {
      if (!p.seat.alive) continue;
      if (this.purgeT > p.at - 0.5) { // brief convulsion before the end
        p.seat.subject.root.rotation.z = Math.sin(this.time * 45) * 0.2;
        p.seat.subject.pose = 'armsUp';
      }
      if (this.purgeT >= p.at) this.kill(p.seat, random() < 0.5 ? 'gib' : 'burn');
    }
  }

  /**
   * Tiers: everyone infected → carrier, then later-infected first.
   * Time-out → survivors (one tier), then the infected in that same order.
   */
  placement() {
    const [carrier, ...rest] = this.infectOrder;
    const infTiers = [carrier, ...rest.reverse()].filter(Boolean).map((s) => [s]);
    if (this.outcome === 'infected') return infTiers;
    const survivors = this.seats.filter((s) => !s.infected);
    return survivors.length ? [survivors, ...infTiers] : infTiers;
  }

  // -------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, c = a.ctrl, brain = seat.brain, m = brain.memory;
    const wasA = m.lastA;
    m.lastA = false;
    c.setButtons(false, false);
    if (seat.convulse > 0 || seat.prime > 0) { c.setMove(0, 0); return; }

    if (!this.found) {
      if (!m.claim || m.claim.searched) m.claim = this._claimContainer(seat);
      const t = m.claim;
      if (!t) { c.setMove(0, 0); return; }
      // Occasionally shove a rival who is mid-search.
      for (const r of this.aliveSeats) {
        if (r === seat || !r.search.c) continue;
        if (dist2D(a.pos, r.actor.pos) < 1.2 && random() < brain.difficulty * dt * 1.2) {
          a.facing = Math.atan2(r.actor.pos.x - a.pos.x, r.actor.pos.z - a.pos.z);
          c.setButtons(false, true);
          return;
        }
      }
      if (dist2D(a.pos, t.front) < SEARCH_REACH * 0.75) { c.setMove(0, 0); c.setButtons(true, false); m.lastA = true; return; }
      this._goTo(a, m, t.front.x, t.front.z, dt);
      return;
    }

    if (seat.infected) {
      if (a.stun > 0) { c.setMove(0, 0); return; }
      let target = null, bd = Infinity;
      for (const s of this.aliveSeats) {
        if (s.infected) continue;
        const d = dist2D(a.pos, s.actor.pos);
        if (d < bd) { bd = d; target = s; }
      }
      if (!target) { c.setMove(0, 0); return; }
      if (bd < STAB_RANGE * 0.85) {
        m.inRangeT = (m.inRangeT || 0) + dt;
        a.facing = Math.atan2(target.actor.pos.x - a.pos.x, target.actor.pos.z - a.pos.z);
        // React like a human would: a short delay before the jab.
        if (m.inRangeT > brain.reaction + 0.1 && !wasA && seat.stabCd <= 0) { c.setMove(0, 0); c.setButtons(true, false); m.lastA = true; m.inRangeT = 0; return; }
        const t = target.actor;
        c.setMove((t.pos.x - a.pos.x) * 0.5, (t.pos.z - a.pos.z) * 0.5);
        return;
      }
      m.inRangeT = 0;
      // Lead the target a little.
      const t = target.actor;
      this._goTo(a, m, t.pos.x + t.vel.x * 0.25, t.pos.z + t.vel.z * 0.25, dt);
      return;
    }

    this._flee(seat, dt);
  }

  /** Pick the nearest unsearched container, avoiding ones other bots already claimed. */
  _claimContainer(seat) {
    const a = seat.actor;
    const claimed = new Set(this.seats.filter((s) => s !== seat).map((s) => s.brain.memory.claim));
    let best = null, bc = Infinity;
    for (const c of this.containers) {
      if (c.searched) continue;
      let cost = dist2D(a.pos, c.front) + (claimed.has(c) ? 6 : 0) + rand(0, 1.5);
      if (c.hasSyringe && this.time > HINT_AFTER) cost -= 100; // they hear the rattle
      if (cost < bc) { bc = cost; best = c; }
    }
    return best;
  }

  /** Survivor bot: sample escape directions away from active hunters; shove when cornered. */
  _flee(seat, dt) {
    const a = seat.actor, c = a.ctrl, brain = seat.brain, m = brain.memory;
    const hunters = this.aliveSeats.filter((s) => s.infected && s.convulse <= 0);
    if (!hunters.length) { c.setMove(0, 0); return; }
    let closest = null, cd = Infinity;
    for (const h of hunters) { const d = dist2D(a.pos, h.actor.pos); if (d < cd) { cd = d; closest = h; } }
    if (closest && cd < 1.45 && closest.actor.stun <= 0 && a.shoveCd <= 0 && random() < brain.difficulty * dt * 12) {
      a.facing = Math.atan2(closest.actor.pos.x - a.pos.x, closest.actor.pos.z - a.pos.z);
      c.setMove(0, 0);
      c.setButtons(false, true);
      return;
    }
    const B = this.arena.bounds;
    let bestDir = null, bs = -Infinity;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const dx = Math.sin(ang), dz = Math.cos(ang);
      const p = { x: a.pos.x + dx * 2.2, z: a.pos.z + dz * 2.2 };
      if (p.x < B.minX + 0.6 || p.x > B.maxX - 0.6 || p.z < B.minZ + 0.6 || p.z > B.maxZ - 0.6) continue;
      if (!this.arena.clearLine(a.pos, p, 0.2)) continue;
      let score = Infinity;
      for (const h of hunters) score = Math.min(score, dist2D(p, h.actor.pos) * (h.actor.stun > 0 ? 1.6 : 1));
      if (m.fleeDir !== undefined) score += 0.5 * Math.cos(ang - m.fleeDir);
      // Avoid hugging walls (corners are death traps).
      score -= 1.5 / Math.max(0.3, Math.min(p.x - B.minX, B.maxX - p.x, p.z - B.minZ, B.maxZ - p.z));
      if (score > bs) { bs = score; bestDir = ang; }
    }
    if (bestDir === null) { c.setMove(-Math.sin(a.facing), -Math.cos(a.facing)); return; }
    m.fleeDir = bestDir;
    const urgency = cd < 6 ? 1 : 0.45;
    c.setMove(Math.sin(bestDir) * urgency, Math.cos(bestDir) * urgency);
  }

  /** Steer to a point, routing around the first blocking collider via its corners. */
  _goTo(a, m, x, z, dt) {
    let tx = x, tz = z;
    const goal = { x, z };
    if (!this.arena.clearLine(a.pos, goal, 0.2)) {
      const w = this._firstBlock(a.pos, goal);
      if (w) {
        const r = 0.65;
        let best = null, bc = Infinity;
        for (const [cx, cz] of [[w.minX - r, w.minZ - r], [w.maxX + r, w.minZ - r], [w.minX - r, w.maxZ + r], [w.maxX + r, w.maxZ + r]]) {
          const pt = { x: cx, z: cz };
          const near = Math.hypot(cx - a.pos.x, cz - a.pos.z);
          if (near < 0.3) continue;
          const cost = near + Math.hypot(x - cx, z - cz) + (this.arena.clearLine(a.pos, pt, 0.2) ? 0 : 50);
          if (cost < bc) { bc = cost; best = pt; }
        }
        if (best) { tx = best.x; tz = best.z; }
      }
    }
    m.stuckT = (m.stuckT || 0) + dt;
    if (m.detourT > 0) { m.detourT -= dt; a.ctrl.setMove(m.dx, m.dz); return; }
    steerTo(a, tx, tz, { arrive: 0.1, slow: 0.4 });
    if (m.stuckT > 0.7) {
      const moved = m.lastPos ? Math.hypot(a.pos.x - m.lastPos.x, a.pos.z - m.lastPos.z) : 1;
      if (moved < 0.3 && a.stun <= 0 && Math.hypot(x - a.pos.x, z - a.pos.z) > 0.8) { const ang = rand(0, Math.PI * 2); m.dx = Math.sin(ang); m.dz = Math.cos(ang); m.detourT = 0.4; }
      m.lastPos = { x: a.pos.x, z: a.pos.z };
      m.stuckT = 0;
    }
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
