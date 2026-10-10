/**
 * PISTON PRESS — every subject gets a private island under a private
 * hydraulic press. Junk rains down. Hoarders get flattened.
 *
 * Rules
 *  - Each subject stands on their own raised square platform, separated by a
 *    bottomless pit. A massive piston hangs over each platform.
 *  - Junk (crates, tyres, barrels) drops onto random living platforms about
 *    every 1.2 s. A picks junk up (carry pose), A again throws it in the
 *    facing direction in an arc — it lands on whatever platform it reaches,
 *    or falls into the pit.
 *  - Thrown junk that hits a subject knocks them back hard — possibly off
 *    their platform and into the pit ('fall').
 *  - Every 10 s: SLAM. 3 s of sirens, then every piston drops. The platform(s)
 *    holding the MOST junk (carried junk counts!) are pressed flat ('crush')
 *    and their junk is cleared; the others' pistons stop at the safety catch.
 *    If nobody holds any junk, nobody dies.
 *  - From 70 s on, a slam comes every 5 s and always flattens exactly one
 *    subject (the biggest hoarder, or a random one if all are clean).
 *  - You cannot walk off your platform — only get knocked off. Last alive wins.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, mesh, pipe, stencil, hazardStrip } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { rand, pick, clamp, angleDiff } from '../core/util.js';

const PH = 1.6;                  // platform half-size (3.2 x 3.2)
const SPACING = 5.0;             // centre-to-centre distance between neighbours
const GRAVITY = 20;
const CARRY_Y = 1.3, CARRY_FWD = 0.55;
const THROW_H = 7.5, THROW_UP = 6.0;
const HIT_KNOCK = 9;             // lethal when hit near an edge, survivable mid-platform
const PISTON_REST = 6.6, PISTON_WARN = 5.6, PISTON_CATCH = 2.4, PISTON_CRUSH = 0.15;
const SLAM_EVERY = 10, CAP = 70, CAP_EVERY = 5;
const DROP_EVERY = 1.2, MAX_JUNK = 28;
/** Horizontal distance a throw covers before touching down on a platform. */
const THROW_RANGE = (() => {
  const h0 = CARRY_Y - 0.35;
  const t = (THROW_UP + Math.sqrt(THROW_UP * THROW_UP + 2 * GRAVITY * h0)) / GRAVITY;
  return CARRY_FWD + THROW_H * t;
})();

/**
 * Platforms stand in one row across the screen: a 2x2 grid would put the
 * near pistons squarely in front of the far platforms from this camera.
 */
const LAYOUTS = {
  1: [[0, 0]],
  2: [[-SPACING / 2, 0], [SPACING / 2, 0]],
  3: [[-SPACING, 0], [0, 0], [SPACING, 0]],
  4: [[-SPACING * 1.5, 0], [-SPACING / 2, 0], [SPACING / 2, 0], [SPACING * 1.5, 0]],
};

export class PistonPress extends Minigame {
  static meta = {
    id: 'piston',
    title: 'PISTON PRESS',
    tagline: 'Tidy desk, long life. Messy desk, flat life.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Grab / Throw junk' }],
    objective: 'Never hold the most junk when the pistons slam.',
    rules: [
      'Junk rains onto the platforms. Grab it (A) and throw it at rivals (A).',
      'Every 10 s the pistons slam: the biggest junk pile gets pressed flat.',
      'Junk in your hands counts toward your pile.',
      'A direct hit knocks a subject back — maybe into the pit.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 20, fogFar: 46, fog: 0x080808 });
    this.makeCamera([0, 12.5, 14.5], [0, 1.2, 0.2], 50);

    const layout = LAYOUTS[this.seats.length] || LAYOUTS[4];
    floor(scene, 80, 60, { tex: 'concrete', tile: 4, y: -18, color: 0x555555 });
    const back = mesh(new THREE.PlaneGeometry(50, 26), mat(0xffffff, Tex.wall([12, 6])), 0, 0, -10, { cast: false });
    scene.add(back);
    stencil(scene, 'MIND YOUR PILE', 0, 6, -9.9, { w: 9, h: 2.6, opacity: 0.45 });
    pipe(scene, [-25, 9.5, -9.6], [25, 9.5, -9.6], 0.35);
    pipe(scene, [-25, 4, -9.7], [25, 4, -9.7], 0.15, 0x5b2c1e);
    const glowPit = new THREE.PointLight(0xa02010, 18, 22, 1.2);
    glowPit.position.set(0, -12, 0);
    scene.add(glowPit);

    hangingLamp(scene, -7.5, 9.5, 4, { intensity: 110, angle: 0.75, target: { x: -1, y: 0, z: 0 } });
    hangingLamp(scene, 7.5, 9.5, 4, { intensity: 110, angle: 0.75, target: { x: 1, y: 0, z: 0 }, shadow: false });
    hangingLamp(scene, 0, 10, -6.5, { intensity: 70, angle: 0.8, target: { x: 0, y: 0, z: 0 }, shadow: false });
    this.siren = new THREE.PointLight(0xff2010, 0, 30, 1);
    this.siren.position.set(0, 6, 0);
    scene.add(this.siren);

    // --- platforms + pistons
    this.plats = [];
    const pillarMat = mat(0xffffff, Tex.plate([1, 3]));
    const topMat = mat(0xffffff, Tex.plate([2, 2]));
    const headMat = mat(0x8a8d88, Tex.metal());
    const rodMat = mat(0xb9bbb5, Tex.metal());
    const hazMat = mat(0xffffff, Tex.hazard([4, 0.5]));
    this.seats.forEach((seat, i) => {
      const [x, z] = layout[i];
      const pillar = mesh(new THREE.BoxGeometry(PH * 2, 12, PH * 2), pillarMat, x, -6.01, z);
      scene.add(pillar);
      const top = mesh(new THREE.PlaneGeometry(PH * 2, PH * 2), topMat, x, 0.001, z, { cast: false });
      top.rotation.x = -Math.PI / 2;
      scene.add(top);
      // Player-coloured border so everyone knows whose island is whose.
      const edge = new THREE.MeshBasicMaterial({ color: seat.player.color });
      for (const [ex, ez, w, d] of [[0, -PH + 0.06, PH * 2, 0.12], [0, PH - 0.06, PH * 2, 0.12], [-PH + 0.06, 0, 0.12, PH * 2], [PH - 0.06, 0, 0.12, PH * 2]]) {
        const s = mesh(new THREE.PlaneGeometry(w, d), edge, x + ex, 0.02, z + ez, { cast: false });
        s.rotation.x = -Math.PI / 2;
        scene.add(s);
      }
      hazardStrip(scene, x, z + PH - 0.3, PH * 2 - 0.3, 0.25, 0.015);

      const piston = new THREE.Group();
      piston.add(mesh(new THREE.BoxGeometry(PH * 2 - 0.2, 1.0, PH * 2 - 0.2), headMat, 0, 0.5, 0));
      piston.add(mesh(new THREE.BoxGeometry(PH * 2 - 0.1, 0.25, PH * 2 - 0.1), hazMat, 0, 0.12, 0));
      piston.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 14, 8), rodMat, 0, 8, 0));
      piston.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), mat(0x3a3b38, Tex.plate()), 0, 1.2, 0));
      const beaconMat = glow(0x3a0a06);
      piston.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), beaconMat, PH - 0.35, 1.1, PH - 0.35, { cast: false }));
      piston.position.set(x, PISTON_REST, z);
      scene.add(piston);
      this.plats.push({ x, z, seat, piston, beaconMat, y: PISTON_REST, target: PISTON_REST, crushing: false, crushedDone: false });
      seat.plat = i;
    });

    // --- arena + avatars (each avatar is fenced to its own platform in update())
    this.arena = new Arena({ bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, shove: false });
    this.seats.forEach((seat, i) => {
      const P = this.plats[i];
      this.spawnSubject(seat, { x: P.x, z: P.z + 0.4 });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x: P.x, z: P.z + 0.4, speed: 4.6 }));
      seat.actor.seat = seat;
    });

    this.junk = [];
    this.dropT = 0.6;
    this.slam = { phase: 'idle', t: 0, next: SLAM_EVERY, forced: false };
  }

  start() {
    this.hud.banner('KEEP IT TIDY', 1200);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    for (const P of this.plats) P.piston.position.y = PISTON_REST + Math.sin(this.engine.time * 1.3 + P.x) * 0.15;
  }

  // -------------------------------------------------------------------- junk

  /** Create a junk mesh of a random kind. */
  _makeJunk() {
    const kind = pick(['crate', 'crate', 'barrel', 'tire']);
    let m, half, r;
    if (kind === 'crate') { const s = rand(0.6, 0.8); m = mesh(new THREE.BoxGeometry(s, s, s), mat(0xffffff, Tex.crate())); half = s / 2; r = s * 0.6; }
    else if (kind === 'barrel') {
      m = new THREE.Group();
      m.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.85, 8), mat(pick([0x2f5c8a, 0x8a2f22, 0x4c6a2a]), Tex.metal())));
      for (const y of [-0.25, 0.25]) m.add(mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.05, 8), mat(0x2a2a28), 0, y, 0));
      half = 0.425; r = 0.36;
    } else {
      m = mesh(new THREE.TorusGeometry(0.3, 0.14, 6, 10), mat(0x1e1d1b, Tex.fabric()));
      m.rotation.x = Math.PI / 2;
      half = 0.14; r = 0.44;
    }
    const j = { mesh: m, kind, half, r, state: 'flying', plat: -1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), holder: null, thrower: null, power: 0, spin: new THREE.Vector3(), hit: false };
    this.scene.add(m);
    this.junk.push(j);
    return j;
  }

  /** Index of the platform under (x, z), or -1 over the pit. */
  platAt(x, z) {
    for (let i = 0; i < this.plats.length; i++) {
      const P = this.plats[i];
      if (Math.abs(x - P.x) <= PH && Math.abs(z - P.z) <= PH) return i;
    }
    return -1;
  }

  /** Height at which junk `j` would rest at (x, z) on platform `p` (simple stacking). */
  _restY(p, x, z, j, among = null) {
    let top = 0;
    for (const o of among || this.junk) {
      if (o === j || o.state !== 'rest' || o.plat !== p) continue;
      if (Math.hypot(o.pos.x - x, o.pos.z - z) < (o.r + j.r) * 0.75) top = Math.max(top, o.pos.y + o.half);
    }
    return top + j.half;
  }

  /** Re-stack a platform's pile after something was removed from it. */
  _settle(p) {
    const pile = this.junk.filter((o) => o.state === 'rest' && o.plat === p).sort((a, b) => a.pos.y - b.pos.y);
    const done = [];
    for (const o of pile) {
      o.pos.y = this._restY(p, o.pos.x, o.pos.z, o, done);
      o.mesh.position.y = o.pos.y;
      done.push(o);
    }
  }

  /** Junk currently counted against platform p (pile + whatever its owner carries). */
  count(p) {
    return this.junk.filter((o) => (o.state === 'rest' && o.plat === p) || (o.state === 'carried' && o.holder && o.holder.plat === p)).length;
  }

  carried(seat) { return this.junk.find((o) => o.state === 'carried' && o.holder === seat) || null; }

  _removeJunk(j) {
    this.scene.remove(j.mesh);
    j.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.junk.splice(this.junk.indexOf(j), 1);
  }

  /** Drop a fresh piece of junk from the ceiling onto a random living platform. */
  _dropJunk() {
    const living = this.plats.filter((P) => P.seat.alive);
    if (!living.length || this.junk.length >= MAX_JUNK) return;
    const P = pick(living);
    const j = this._makeJunk();
    j.pos.set(P.x + rand(-PH + 0.45, PH - 0.45), 11, P.z + rand(-PH + 0.45, PH - 0.45));
    j.vel.set(0, -2, 0);
    j.power = 2.5;
    j.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
  }

  _pickUp(seat) {
    const a = seat.actor;
    let best = null, bd = 1.15;
    for (const j of this.junk) {
      if (j.state !== 'rest' || j.plat !== seat.plat) continue;
      const d = Math.hypot(j.pos.x - a.pos.x, j.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = j; }
    }
    if (!best) return false;
    const p = best.plat;
    best.state = 'carried';
    best.holder = seat;
    best.plat = -1;
    this._settle(p);
    a.subject.pose = 'carry';
    Audio.sfx('clank', { vol: 0.35 });
    return true;
  }

  _throw(seat, j) {
    const a = seat.actor, f = a.forward;
    j.state = 'flying';
    j.holder = null;
    j.thrower = seat;
    j.power = HIT_KNOCK;
    j.hit = false;
    j.vel.set(f.x * THROW_H, THROW_UP, f.z * THROW_H);
    j.spin.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    a.subject.pose = 'idle';
    a.subject.push();
    Audio.sfx('whoosh', { vol: 0.6 });
  }

  /** Let go of carried junk (holder died / got knocked off). */
  _drop(seat) {
    const j = this.carried(seat);
    if (!j) return;
    j.state = 'flying';
    j.holder = null;
    j.thrower = null;
    j.power = 0;
    j.vel.set(rand(-1, 1), 1, rand(-1, 1));
    if (seat.subject) seat.subject.pose = 'idle';
  }

  _updateJunk(dt) {
    for (const j of this.junk.slice()) {
      if (j.state === 'carried') {
        const a = j.holder.actor;
        const yaw = a.subject.root.rotation.y;
        j.pos.set(a.pos.x + Math.sin(yaw) * CARRY_FWD, a.y + CARRY_Y + j.half * 0.3, a.pos.z + Math.cos(yaw) * CARRY_FWD);
        j.mesh.position.copy(j.pos);
        j.mesh.rotation.y = yaw;
        continue;
      }
      if (j.state === 'rest') continue;
      // flying / falling into the pit
      j.vel.y -= GRAVITY * dt;
      j.pos.addScaledVector(j.vel, dt);
      j.mesh.rotation.x += j.spin.x * dt; j.mesh.rotation.y += j.spin.y * dt; j.mesh.rotation.z += j.spin.z * dt;
      j.mesh.position.copy(j.pos);
      if (j.state === 'pit') { if (j.pos.y < -25) this._removeJunk(j); continue; }
      // Hit a subject?
      if (!j.hit && j.power > 0 && j.pos.y > 0.1 && j.pos.y < 2.4) {
        for (const seat of this.aliveSeats) {
          const a = seat.actor;
          if (seat === j.thrower || a.falling) continue;
          if (Math.hypot(a.pos.x - j.pos.x, a.pos.z - j.pos.z) > 0.45 + j.r) continue;
          j.hit = true;
          const h = new THREE.Vector3(j.vel.x, 0, j.vel.z);
          if (h.lengthSq() < 0.01) h.set(a.pos.x - j.pos.x, 0, a.pos.z - j.pos.z);
          if (h.lengthSq() < 0.0001) h.set(rand(-1, 1), 0, rand(-1, 1));
          h.normalize();
          a.knock.addScaledVector(h, j.power);
          a.stun = j.power > 6 ? 0.6 : 0.25;
          if (j.thrower) { a.data.hitBy = j.thrower; a.data.hitAt = this.time; }
          j.vel.x *= -0.2; j.vel.z *= -0.2;
          Audio.sfx('thud');
          if (j.power > 6) { Audio.sfx('clank', { vol: 0.5 }); this.engine.shake(0.15); }
          this.fx.sparks(j.pos.clone(), { count: 6, color: 0xffe0a0 });
          break;
        }
      }
      // Landing
      if (j.vel.y < 0 && j.pos.y > -0.25) {
        const p = this.platAt(j.pos.x, j.pos.z);
        if (p >= 0) {
          const ry = this._restY(p, j.pos.x, j.pos.z, j);
          if (j.pos.y <= ry) {
            j.pos.y = ry;
            j.state = 'rest';
            j.plat = p;
            j.mesh.position.copy(j.pos);
            j.mesh.rotation.set(j.kind === 'tire' ? Math.PI / 2 : 0, rand(0, Math.PI), 0);
            Audio.sfx('thud', { vol: 0.5 });
          }
        }
      } else if (j.pos.y <= -0.25) {
        j.state = 'pit';
      }
    }
  }

  // ------------------------------------------------------------------ pistons

  _updateSlam(dt) {
    const S = this.slam;
    const warnDur = S.next >= CAP ? 1.5 : 3;
    S.t += dt;
    if (S.phase === 'idle') {
      if (this.time >= S.next - warnDur) {
        S.phase = 'warn'; S.t = 0; S.forced = S.next >= CAP;
        for (const P of this.plats) P.target = PISTON_WARN;
        Audio.sfx('horn');
        this.hud.banner(S.forced ? 'PURGE!' : 'BRACE!', 1200, 'danger');
      }
    } else if (S.phase === 'warn') {
      const on = Math.floor(S.t * 6) % 2 === 0;
      this.siren.intensity = on ? 40 : 4;
      for (const P of this.plats) P.beaconMat.color.setHex(on ? 0xff2010 : 0x3a0a06);
      if (Math.floor(S.t * 2) !== Math.floor((S.t - dt) * 2)) Audio.sfx('buzz', { vol: 0.5 });
      if (this.time >= S.next) this._decideSlam();
    } else if (S.phase === 'down') {
      let settled = true;
      for (const P of this.plats) {
        P.y = Math.max(P.target, P.y - 32 * dt);
        if (P.y > P.target) settled = false;
        if (P.crushing && !P.crushedDone && P.y <= 1.95) {
          P.crushedDone = true;
          const seat = P.seat;
          if (seat.alive && !seat.actor.falling) {
            const held = this.carried(seat);
            if (held) this._removeJunk(held);
            this.kill(seat, 'crush');
          }
        }
      }
      if (settled) {
        S.phase = 'hold'; S.t = 0;
        this.engine.shake(0.5);
        Audio.sfx('crunch');
        for (const P of this.plats) {
          const i = this.plats.indexOf(P);
          if (P.crushing) {
            for (const j of this.junk.filter((o) => (o.state === 'rest' && o.plat === i) || (o.state === 'carried' && o.holder === P.seat))) this._removeJunk(j);
            for (let k = 0; k < 4; k++) this.fx.smoke(new THREE.Vector3(P.x + rand(-1.4, 1.4), 0.3, P.z + rand(-1.4, 1.4)), { color: 0x6a6660, size: 0.4, life: 1.2 });
          } else {
            Audio.sfx('clank', { vol: 0.5 });
          }
          this.fx.sparks(new THREE.Vector3(P.x + PH - 0.2, P.target, P.z + PH - 0.2), { count: 8 });
        }
      }
    } else if (S.phase === 'hold') {
      if (S.t >= 0.5) { S.phase = 'rise'; S.t = 0; for (const P of this.plats) P.target = PISTON_REST; }
    } else if (S.phase === 'rise') {
      let done = true;
      for (const P of this.plats) { P.y = Math.min(PISTON_REST, P.y + 6 * dt); if (P.y < PISTON_REST) done = false; }
      if (done) {
        S.phase = 'idle'; S.t = 0;
        S.next += S.next >= CAP ? CAP_EVERY : SLAM_EVERY;
      }
    }
    // Easing toward warning height (down/rise phases move pistons explicitly).
    if (S.phase === 'warn' || S.phase === 'idle') {
      for (const P of this.plats) {
        P.y += (P.target - P.y) * Math.min(1, dt * 4);
      }
    }
    if (S.phase !== 'warn') {
      this.siren.intensity = 0;
      for (const P of this.plats) P.beaconMat.color.setHex(0x3a0a06);
    }
    for (const P of this.plats) {
      const jitter = S.phase === 'warn' ? rand(-0.03, 0.03) : 0;
      P.piston.position.set(P.x + jitter, P.y, P.z + jitter);
    }
  }

  /** Pick which platforms get flattened and send every piston down. */
  _decideSlam() {
    const S = this.slam;
    S.phase = 'down'; S.t = 0;
    const living = this.plats.filter((P) => P.seat.alive);
    const counts = living.map((P) => this.count(this.plats.indexOf(P)));
    const max = Math.max(0, ...counts);
    let victims = [];
    if (S.forced) victims = max > 0 ? [pick(living.filter((_, k) => counts[k] === max))] : [pick(living)];
    else if (max > 0) victims = living.filter((_, k) => counts[k] === max);
    for (const P of this.plats) {
      const crush = victims.includes(P) || !P.seat.alive; // empty platforms always get squashed clean
      P.crushing = crush;
      P.crushedDone = false;
      P.target = crush ? PISTON_CRUSH : PISTON_CATCH;
    }
    Audio.sfx('grind');
    this.hud.banner(victims.length ? 'SLAM!' : 'ALL CLEAN', 1000, victims.length ? 'danger' : 'good');
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);

    // Keep everyone on their own island; a hard knock carries them over the edge.
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const a = seat.actor, P = this.plats[seat.plat];
      if (a.falling) {
        if (a.y < -2.5 && playing) this._fallKill(seat);
        continue;
      }
      const dx = a.pos.x - P.x, dz = a.pos.z - P.z;
      if (Math.abs(dx) > PH || Math.abs(dz) > PH) {
        a.falling = true;
        a.vy = 2;
        this._drop(seat);
        a.subject.pose = 'armsUp';
        Audio.sfx('whoosh');
      } else if (a.knock.length() < 3) {
        const lim = PH - 0.3;
        a.pos.x = P.x + clamp(dx, -lim, lim);
        a.pos.z = P.z + clamp(dz, -lim, lim);
        a.subject.root.position.x = a.pos.x;
        a.subject.root.position.z = a.pos.z;
      }
    }

    // Grab / throw (A).
    if (playing) {
      for (const seat of this.aliveSeats) {
        if (seat.actor.falling || !seat.ctrl.aPressed) continue;
        const held = this.carried(seat);
        if (held) this._throw(seat, held);
        else this._pickUp(seat);
      }
    }

    this._updateJunk(dt);
    if (!playing) {
      // Round over: let the presses wind back up, no more verdicts.
      this._overT = (this._overT || 0) + dt;
      this.siren.intensity = 0;
      for (const P of this.plats) {
        if (this._overT > 0.8) P.y = Math.min(PISTON_REST, P.y + 6 * dt);
        P.piston.position.set(P.x, P.y, P.z);
      }
      return;
    }
    this._updateSlam(dt);

    if (this.slam.phase !== 'down' && this.slam.phase !== 'hold') {
      this.dropT -= dt;
      if (this.dropT <= 0) { this.dropT = DROP_EVERY * rand(0.75, 1.25); this._dropJunk(); }
    }

    // HUD
    const S = this.slam;
    this.hud.setTimer(S.phase === 'idle' || S.phase === 'warn' ? Math.max(0, S.next - this.time) : 0);
    const counts = this.plats.map((_, i) => (this.plats[i].seat.alive ? this.count(i) : -1));
    const max = Math.max(...counts);
    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'PRESSED'); this.hud.setStatus(seat, ''); continue; }
      const c = counts[seat.plat];
      this.hud.setStat(seat, `JUNK ${c}`);
      this.hud.setStatus(seat, c > 0 && c === max ? 'BIGGEST PILE' : '');
    }
    // Wait for anyone mid-fall to actually hit the bottom before judging.
    if (!this.aliveSeats.some((s) => s.actor.falling)) this.checkLastStanding();
  }

  /** Finish off a subject who fell into the pit, crediting the thrower. */
  _fallKill(seat) {
    const a = seat.actor;
    const by = a.data.hitBy;
    if (by && by !== seat && this.time - (a.data.hitAt ?? -9) < 3) {
      this.award(by, 'specialDelivery');
      this.hud.feed(`${by.player.name} made a special delivery`, by.player.color);
    }
    this.kill(seat, 'fall', { dir: a.knock.clone().setY(0).lengthSq() > 0.01 ? a.knock.clone() : new THREE.Vector3(0, 0, 1) });
  }

  /** Simultaneous deaths (same slam) share a tier. */
  placement() {
    const tiers = [];
    if (this.aliveSeats.length) tiers.push(this.aliveSeats);
    for (const s of this.deaths.slice().reverse()) {
      const last = tiers[tiers.length - 1];
      if (last && !last[0].alive && Math.abs(last[0].deathTime - s.deathTime) < 0.05) last.push(s);
      else tiers.push([s]);
    }
    return tiers;
  }

  // ---------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    const P = this.plats[seat.plat];
    let wantA = false;
    if (a.falling) { a.ctrl.setMove(0, 0); a.ctrl.setButtons(false, false); return; }

    // Dodge incoming thrown junk (skill-dependent).
    let dodge = null;
    for (const j of this.junk) {
      if (j.state !== 'flying' || j.power < 6 || j.thrower === seat) continue;
      const tLand = (j.vel.y + Math.sqrt(Math.max(0, j.vel.y * j.vel.y + 2 * GRAVITY * Math.max(0, j.pos.y - 1)))) / GRAVITY;
      const lx = j.pos.x + j.vel.x * tLand, lz = j.pos.z + j.vel.z * tLand;
      if (Math.hypot(lx - a.pos.x, lz - a.pos.z) < 1.1) { dodge = { x: a.pos.x - lx, z: a.pos.z - lz, vx: j.vel.x, vz: j.vel.z }; break; }
    }
    if (dodge && (mem.dodging || Math.random() < brain.difficulty * 0.25)) {
      mem.dodging = true;
      // Sidestep perpendicular to the incoming path, toward the platform centre.
      let px = -dodge.vz, pz = dodge.vx;
      const toC = (P.x - a.pos.x) * px + (P.z - a.pos.z) * pz;
      if (toC < 0) { px = -px; pz = -pz; }
      a.ctrl.setMove(px, pz);
      a.ctrl.setButtons(false, false);
      mem.aPrev = false;
      return;
    }
    mem.dodging = false;

    const held = this.carried(seat);
    if (held) {
      if (!mem.target || !mem.target.alive) {
        // Only rivals a throw can actually reach (standing at our front edge).
        const reach = THROW_RANGE + (PH - 0.35) + (PH - 0.4);
        const rivals = this.aliveSeats.filter((s) => s !== seat && Math.hypot(this.plats[s.plat].x - P.x, this.plats[s.plat].z - P.z) <= reach);
        mem.target = rivals.length ? pick(rivals) : null;
        mem.holdT = 0;
        mem.aim = rand(-1, 1) * (0.06 + brain.error * 0.5);
      }
      mem.holdT = (mem.holdT || 0) + dt;
      const T = mem.target ? this.plats[mem.target.plat] : null;
      let dirX, dirZ;
      if (T) {
        // Aim at the rival — slightly toward where they stand, not just their platform.
        const tx = (T.x + mem.target.actor.pos.x) / 2, tz = (T.z + mem.target.actor.pos.z) / 2;
        const dist = Math.hypot(tx - P.x, tz - P.z) || 1;
        dirX = (tx - P.x) / dist; dirZ = (tz - P.z) / dist;
        const off = clamp(dist - THROW_RANGE, -(PH - 0.35), PH - 0.35);
        const sx = P.x + dirX * off, sz = P.z + dirZ * off;
        const d = steerTo(a, sx, sz, { arrive: 0.15, slow: 0.6 });
        const urgent = this.slam.phase === 'warn' || mem.holdT > 2.6;
        if (d < 0.3 || urgent) {
          const aim = Math.atan2(dirX, dirZ) + mem.aim;
          a.ctrl.setMove(Math.sin(aim) * 0.3, Math.cos(aim) * 0.3);
          if (Math.abs(angleDiff(a.facing, aim)) < 0.12 && mem.holdT > 0.35 + brain.reaction) wantA = true;
        }
      } else {
        // Nobody in range: dump it into the pit in front of the platform.
        a.ctrl.setMove(0, 0.3);
        wantA = mem.holdT > 0.5 && Math.abs(angleDiff(a.facing, 0)) < 0.2;
      }
    } else {
      mem.target = null;
      let best = null, bd = Infinity;
      for (const j of this.junk) {
        if (j.state !== 'rest' || j.plat !== seat.plat) continue;
        const d = Math.hypot(j.pos.x - a.pos.x, j.pos.z - a.pos.z);
        if (d < bd) { bd = d; best = j; }
      }
      if (best) {
        steerTo(a, best.pos.x, best.pos.z, { arrive: 0.5, slow: 0.6 });
        if (bd < 0.95) wantA = true;
      } else {
        mem.idle = mem.idle || { x: rand(-0.6, 0.6), z: rand(-0.6, 0.6) };
        steerTo(a, P.x + mem.idle.x, P.z + mem.idle.z, { arrive: 0.3 });
      }
    }
    a.ctrl.setButtons(wantA && !mem.aPrev, false);
    mem.aPrev = wantA && !mem.aPrev;
  }
}
