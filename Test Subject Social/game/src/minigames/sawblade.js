/**
 * SAWBLADE RICOCHET — dodge bouncing circular saws in a pen lined with
 * reciprocating hacksaws. Shove rivals into the blades. Last one standing.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { steerTo, nearest, wander } from '../core/ai.js';
import { Timer } from '../core/util.js';
import { rand, random } from '../core/rng.js';

const HALF_W = 8, HALF_D = 5.5;     // inner pen half-extents
const EDGE = 0.55;                   // hacksaw kill depth from wall
const BLADE_R = 0.75;

export class SawbladeRicochet extends Minigame {
  static meta = {
    id: 'sawblade',
    title: 'SAWBLADE RICOCHET',
    tagline: 'The walls bite. The blades bounce.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove' }],
    objective: 'Be the last subject standing.',
    rules: ['Circular saws ricochet around the pen — more join over time.', 'The walls are lined with hacksaws. Touching them is fatal.', 'Shove rivals into the blades.'],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 50 });
    this.makeCamera([0, 15.5, 11.5], [0, 0, 0.6], 48);

    floor(scene, 40, 30, { tex: 'plate', tile: 2 });
    floor(scene, HALF_W * 2, HALF_D * 2, { tex: 'tiles', tile: 2, y: 0.005 });
    stencil(scene, 'KEEP MOVING', 0, 0.02, -2.5, { w: 7, h: 2, rotY: 0, opacity: 0.25 }).rotation.x = -Math.PI / 2;

    // Pen walls with hacksaw strips facing inward.
    const wallMat = mat(0xffffff, Tex.rust([4, 1]));
    block(scene, 0, 0.6, -HALF_D - 0.3, HALF_W * 2 + 1.2, 1.2, 0.6, wallMat);
    block(scene, 0, 0.6, HALF_D + 0.3, HALF_W * 2 + 1.2, 1.2, 0.6, wallMat);
    block(scene, -HALF_W - 0.3, 0.6, 0, 0.6, 1.2, HALF_D * 2, wallMat);
    block(scene, HALF_W + 0.3, 0.6, 0, 0.6, 1.2, HALF_D * 2, wallMat);
    this.hacksaws = [];
    const bladeMat = mat(0xb7b9b4, Tex.metal());
    const addSaw = (x, z, len, rotY) => {
      const g = new THREE.Group();
      const strip = mesh(new THREE.BoxGeometry(len, 0.18, 0.06), bladeMat);
      // Saw teeth: thin wedges along the strip.
      for (let i = -len / 2; i < len / 2; i += 0.25) {
        const tooth = mesh(new THREE.ConeGeometry(0.07, 0.16, 3), bladeMat, i, 0, 0.08);
        tooth.rotation.x = Math.PI / 2;
        strip.add(tooth);
      }
      g.add(strip);
      g.position.set(x, 0.55, z);
      g.rotation.y = rotY;
      scene.add(g);
      this.hacksaws.push({ g, strip, phase: rand(0, 6) });
    };
    addSaw(0, -HALF_D + 0.05, HALF_W * 2, 0);
    addSaw(0, HALF_D - 0.05, HALF_W * 2, Math.PI);
    addSaw(-HALF_W + 0.05, 0, HALF_D * 2, Math.PI / 2);
    addSaw(HALF_W - 0.05, 0, HALF_D * 2, -Math.PI / 2);
    hazardStrip(scene, 0, -HALF_D + 0.4, HALF_W * 2, 0.4, 0.01);
    hazardStrip(scene, 0, HALF_D - 0.4, HALF_W * 2, 0.4, 0.01);

    hangingLamp(scene, -4, 7, 0, { intensity: 90, angle: 0.9 });
    hangingLamp(scene, 4, 7, 0, { intensity: 90, angle: 0.9 });

    // Arena + avatars
    this.arena = new Arena({ bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, shoveForce: 13 });
    const spots = [[-3, -2], [3, -2], [-3, 2], [3, 2]];
    this.seats.forEach((seat, i) => {
      const [x, z] = spots[i];
      this.spawnSubject(seat, { x, z });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
    });
    this.arena.onShove = (a, b) => { b.data.lastShover = a.seat; b.data.shovedAt = this.time; };

    this.blades = [];
    this.spawnTimer = new Timer(7, { repeat: true });
  }

  /** Add a spinning saw blade entering from a random edge. */
  spawnBlade() {
    const g = new THREE.Group();
    const disc = mesh(new THREE.CylinderGeometry(BLADE_R, BLADE_R, 0.06, 16), mat(0xc8cac4, Tex.metal()));
    for (let i = 0; i < 16; i++) {
      const t = mesh(new THREE.ConeGeometry(0.1, 0.22, 3), mat(0xa8aaa4), Math.cos((i / 16) * Math.PI * 2) * BLADE_R, 0, Math.sin((i / 16) * Math.PI * 2) * BLADE_R);
      t.rotation.z = -Math.PI / 2; t.rotation.y = -(i / 16) * Math.PI * 2;
      disc.add(t);
    }
    const hub = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8), mat(0x333333));
    g.add(disc, hub);
    const angle = rand(0, Math.PI * 2);
    const speed = 6 + this.blades.length * 0.6;
    const b = { g, x: rand(-HALF_W + 2, HALF_W - 2), z: random() < 0.5 ? -HALF_D + 1.2 : HALF_D - 1.2, vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, warm: 1.0 };
    g.position.set(b.x, 0.7, b.z);
    g.scale.setScalar(0.01);
    this.scene.add(g);
    this.blades.push(b);
    Audio.sfx('saw');
    this.hud.banner(this.blades.length === 1 ? 'BLADE RELEASED' : `BLADE ${this.blades.length}`, 1000, 'danger');
  }

  start() { this.spawnBlade(); }

  preview(dt) { this._animateSaws(dt); for (const s of this.seats) s.subject.animate(dt, 0); }

  _animateSaws(dt) {
    for (const h of this.hacksaws) { h.phase += dt * 14; h.strip.position.x = Math.sin(h.phase) * 0.2; }
  }

  update(dt) {
    this._animateSaws(dt);
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    if (!playing) return;

    if (this.spawnTimer.tick(dt) && this.blades.length < 6) this.spawnBlade();

    // Blades bounce and speed up slowly
    for (const b of this.blades) {
      b.warm = Math.max(0, b.warm - dt);
      b.g.scale.setScalar(Math.min(1, b.g.scale.x + dt * 3));
      const accel = 1 + dt * 0.02;
      b.vx *= accel; b.vz *= accel;
      b.x += b.vx * dt; b.z += b.vz * dt;
      const lim = (v, lo, hi, vel) => (v < lo ? [lo, Math.abs(vel)] : v > hi ? [hi, -Math.abs(vel)] : [v, vel]);
      const before = [b.vx, b.vz];
      [b.x, b.vx] = lim(b.x, -HALF_W + BLADE_R, HALF_W - BLADE_R, b.vx);
      [b.z, b.vz] = lim(b.z, -HALF_D + BLADE_R, HALF_D - BLADE_R, b.vz);
      if (before[0] !== b.vx || before[1] !== b.vz) { Audio.sfx('clank', { vol: 0.4 }); this.fx.sparks(new THREE.Vector3(b.x, 0.7, b.z), { count: 6 }); }
      b.g.position.set(b.x, 0.7, b.z);
      b.g.rotation.y += dt * 25;
    }

    // Lethal contacts
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      for (const b of this.blades) {
        if (b.warm > 0.7) continue;
        if (Math.hypot(a.pos.x - b.x, a.pos.z - b.z) < BLADE_R + a.radius * 0.8) {
          this._credit(a);
          this.kill(seat, 'slice', { dir: new THREE.Vector3(b.vx, 0, b.vz) });
          break;
        }
      }
      if (!seat.alive) continue;
      const nearWall = a.pos.x < -HALF_W + EDGE || a.pos.x > HALF_W - EDGE || a.pos.z < -HALF_D + EDGE || a.pos.z > HALF_D - EDGE;
      if (nearWall) {
        const dir = new THREE.Vector3(-a.pos.x, 0, -a.pos.z);
        this._credit(a);
        this.kill(seat, 'slice', { dir, force: 0.8 });
      }
    }
    for (const seat of this.seats) this.hud.setStat(seat, seat.alive ? 'ALIVE' : 'SHREDDED');
    this.hud.setTimer(null);
    this.checkLastStanding();
  }

  /** Credit a recent shover (within 1.5s) with a kill for the "Saw Feeder" commendation. */
  _credit(victim) {
    const by = victim.data.lastShover;
    if (by && this.time - victim.data.shovedAt < 1.5) {
      this.progress(by, 'sawFeeder');
      this.hud.feed(`${by.player.name} fed the saws`, by.player.color);
    }
  }

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain;
    a.ctrl.setButtons(false, false);
    // Danger vector: sum of repulsion from blades (with look-ahead) and walls.
    let fx = 0, fz = 0;
    for (const b of this.blades) {
      const px = b.x + b.vx * brain.reaction, pz = b.z + b.vz * brain.reaction;
      const dx = a.pos.x - px, dz = a.pos.z - pz, d = Math.hypot(dx, dz);
      if (d < 4.2) { const w = (4.2 - d) / 4.2; fx += (dx / (d || 1)) * w * 3; fz += (dz / (d || 1)) * w * 3; }
    }
    const wallPush = (v, lo, hi) => (v < lo + 2.2 ? (lo + 2.2 - v) : v > hi - 2.2 ? -(v - (hi - 2.2)) : 0);
    fx += wallPush(a.pos.x, -HALF_W, HALF_W) * 1.5;
    fz += wallPush(a.pos.z, -HALF_D, HALF_D) * 1.5;
    if (Math.hypot(fx, fz) > 0.3) {
      a.ctrl.setMove(fx, fz);
    } else {
      // Hunt: approach a rival who is near a wall and shove them outward.
      const n = nearest(a, this.arena.actors);
      if (n && n.dist < 4 && random() < brain.difficulty) {
        const t = n.actor;
        // Approach from the inside so the shove sends them toward the wall.
        const out = new THREE.Vector3(t.pos.x, 0, t.pos.z).normalize();
        steerTo(a, t.pos.x - out.x * 0.9, t.pos.z - out.z * 0.9, { arrive: 0.3 });
        if (n.dist < 1.3 && random() < 0.15) { a.facing = Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z); a.ctrl.setButtons(false, true); }
      } else wander(a, brain, dt, { minX: -HALF_W + 2, maxX: HALF_W - 2, minZ: -HALF_D + 2, maxZ: HALF_D - 2 });
    }
  }
}
