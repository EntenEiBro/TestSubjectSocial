/**
 * fx.js — visual effects: debris physics, blood spray, decals, smoke, sparks.
 *
 * A single {@link FX} instance lives per minigame scene. It owns short-lived
 * objects and updates them every frame. Death "styles" combine these
 * primitives into the signature lethal outcomes of each round.
 */
import * as THREE from 'three';
import { Tex } from './textures.js';
import { rand } from './util.js';

/** Global effect settings (the options menu toggles `gore` between 1 and 0.25). */
export const FXSettings = { gore: 1 };

const GRAVITY = -22;
const MAX_BODIES = 90; // oldest settled debris is culled beyond this
const bloodMat = new THREE.MeshLambertMaterial({ color: 0x6e0505 });
const dropGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);

export class FX {
  /**
   * @param {THREE.Scene} scene
   * @param {{floorAt?: (x:number, z:number) => number}} opts
   *   floorAt returns the ground height at (x, z); return -Infinity over pits.
   */
  constructor(scene, { floorAt = () => 0 } = {}) {
    this.scene = scene;
    this.floorAt = floorAt;
    this.bodies = [];   // tumbling rigid pieces
    this.drops = [];    // blood droplets
    this.decals = [];   // growing pools
    this.puffs = [];    // smoke / dust sprites
  }

  // ---------------------------------------------------------------- primitives

  /** Throw an Object3D into the physics sim with linear + angular velocity. */
  addBody(obj, vel = new THREE.Vector3(), spin = new THREE.Vector3(), { life = 12, bounce = 0.3, bleed = true, radius = 0.15 } = {}) {
    this.scene.attach(obj); // keep world transform
    this.bodies.push({ obj, vel, spin, life, bounce, bleed, radius, rest: false, trail: 0 });
  }

  /** Spray `count` blood droplets from a point. */
  spray(pos, count = 30, { dir = null, speed = 6, spread = 1 } = {}) {
    count = Math.ceil(count * FXSettings.gore);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(dropGeo, bloodMat);
      m.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1) * spread, rand(0.3, 1.2), rand(-1, 1) * spread);
      if (dir) v.add(dir.clone().multiplyScalar(1.4));
      v.normalize().multiplyScalar(speed * rand(0.4, 1.1));
      const s = rand(0.6, 1.8); m.scale.setScalar(s);
      this.scene.add(m);
      this.drops.push({ m, v, life: 3 });
    }
  }

  /** A blood pool on the floor that grows to `size`. */
  pool(x, z, size = 1.6, y = null) {
    const floor = y ?? this.floorAt(x, z);
    if (!Number.isFinite(floor)) return;
    size *= 0.4 + 0.6 * FXSettings.gore;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({
      map: Tex.blood(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rand(0, Math.PI * 2);
    m.position.set(x, floor + 0.012 + Math.random() * 0.004, z);
    m.scale.setScalar(0.1);
    this.scene.add(m);
    this.decals.push({ m, target: size, grow: 0 });
  }

  /** Grey smoke puff (cigarettes, engines, explosions). */
  smoke(pos, { color = 0x9a9a9a, size = 0.5, rise = 1.2, life = 2, opacity = 0.5, drift = null } = {}) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.position.copy(pos);
    this.scene.add(m);
    this.puffs.push({ m, life, max: life, rise, opacity, drift: drift || new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2)) });
  }

  /** Bright flash of sparks / muzzle fire. */
  sparks(pos, { color = 0xffd27a, count = 10, speed = 6 } = {}) {
    const mtl = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(dropGeo, mtl);
      m.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      this.scene.add(m);
      this.drops.push({ m, v, life: rand(0.2, 0.5), spark: true });
    }
  }

  /** Large fiery explosion + smoke column. */
  explosion(pos, scale = 1) {
    const flash = new THREE.PointLight(0xff9a3a, 80 * scale, 12 * scale);
    flash.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
    this.scene.add(flash);
    let t = 0;
    this.puffs.push({ light: flash, life: 0.35, max: 0.35 });
    for (let i = 0; i < 10; i++) {
      this.smoke(pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0, 0.8), rand(-0.6, 0.6)).multiplyScalar(scale)), {
        color: i < 4 ? 0xff7a1a : 0x2a2a2a, size: rand(0.4, 0.9) * scale, rise: rand(1.5, 3), life: rand(0.6, 1.6), opacity: 0.85,
      });
    }
    this.sparks(pos, { count: 20, speed: 10 * scale });
    void t;
  }

  // ------------------------------------------------------------- death styles

  /**
   * Kill an avatar with a named style. The subject's root is consumed.
   * @param {import('./characters.js').Subject} subject
   * @param {'gib'|'shot'|'crush'|'fall'|'snap'|'burn'|'slice'} style
   * @param {{dir?: THREE.Vector3, force?: number}} opts
   */
  kill(subject, style = 'gib', { dir = new THREE.Vector3(0, 0, 1), force = 1 } = {}) {
    const root = subject.root;
    root.updateMatrixWorld(true);
    const center = new THREE.Vector3();
    subject.parts.chest.getWorldPosition(center);
    const d = dir.clone().setY(0).normalize();

    if (style === 'gib' || style === 'slice') {
      for (const p of subject.detachable) {
        const v = new THREE.Vector3(rand(-1, 1), rand(0.6, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9) * force).add(d.clone().multiplyScalar(3 * force));
        this.addBody(p, v, new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)));
      }
      this.addBody(subject.parts.hips, new THREE.Vector3(0, 2, 0).add(d.clone().multiplyScalar(2)), new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4)));
      this.spray(center, 70, { speed: 8 * force });
      this.pool(center.x, center.z, 2.6);
    } else if (style === 'shot') {
      // Collapse backwards as one piece, with an exit spray.
      this.addBody(root, d.clone().multiplyScalar(2.5 * force).setY(1.5), new THREE.Vector3(-d.z * 5, 0, d.x * 5).multiplyScalar(-1), { radius: 0.4, bounce: 0.1 });
      this.spray(center, 40, { dir: d, speed: 7 });
      this.pool(center.x + d.x, center.z + d.z, 1.8);
    } else if (style === 'snap') {
      // Fold backwards at the spine, then drop.
      subject.parts.torso.rotation.x = -2.4;
      subject.parts.head.rotation.x = -0.8;
      this.addBody(root, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)), { radius: 0.4, bounce: 0.05 });
      this.spray(center, 25, { speed: 4 });
      this.pool(center.x, center.z, 1.4);
    } else if (style === 'crush') {
      root.scale.y = 0.08;
      root.position.y += 0.02;
      this.spray(center.setY(root.position.y + 0.2), 90, { speed: 9, spread: 1.6 });
      this.pool(root.position.x, root.position.z, 3.2);
    } else if (style === 'fall') {
      this.addBody(root, d.clone().multiplyScalar(1.2).setY(0.5), new THREE.Vector3(rand(-3, 3), rand(-1, 1), rand(-3, 3)), { radius: 0.4, bleed: false, life: 4 });
    } else if (style === 'burn') {
      root.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.15); } });
      for (let i = 0; i < 8; i++) this.smoke(center.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.5, 0.5), rand(-0.3, 0.3))), { color: i % 2 ? 0xff6a10 : 0x222222, life: 1.5, rise: 2 });
      this.addBody(root, new THREE.Vector3(0, 1, 0), new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)), { radius: 0.4, bleed: false });
    }
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    // Rigid debris
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      b.life -= dt;
      if (!b.rest) {
        b.vel.y += GRAVITY * dt;
        b.obj.position.addScaledVector(b.vel, dt);
        b.obj.rotation.x += b.spin.x * dt; b.obj.rotation.y += b.spin.y * dt; b.obj.rotation.z += b.spin.z * dt;
        const floor = this.floorAt(b.obj.position.x, b.obj.position.z);
        if (Number.isFinite(floor) && b.obj.position.y < floor + b.radius * 0.5 && b.vel.y < 0 && b.obj.position.y > floor - 1) {
          b.obj.position.y = floor + b.radius * 0.5;
          b.vel.y *= -b.bounce;
          b.vel.x *= 0.6; b.vel.z *= 0.6;
          b.spin.multiplyScalar(0.5);
          if (b.bleed && Math.abs(b.vel.y) > 1) this.pool(b.obj.position.x, b.obj.position.z, rand(0.4, 0.9));
          if (b.vel.lengthSq() < 0.3) b.rest = true;
        }
        if (b.bleed && (b.trail -= dt) <= 0 && b.vel.lengthSq() > 4) { b.trail = 0.05; this.spray(b.obj.position, 1, { speed: 1 }); }
      }
      if (b.obj.position.y < -40 || b.life <= 0 && !b.rest) {
        this.scene.remove(b.obj);
        this.bodies.splice(i, 1);
      }
    }
    // Cap settled debris so long rounds (chisel chips, junk) don't accumulate forever.
    if (this.bodies.length > MAX_BODIES) {
      for (let i = 0; i < this.bodies.length && this.bodies.length > MAX_BODIES; i++) {
        if (this.bodies[i].rest) { this.scene.remove(this.bodies[i].obj); this.bodies.splice(i, 1); i--; }
      }
    }
    // Droplets
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.v.y += GRAVITY * dt * (d.spark ? 0.3 : 1);
      d.m.position.addScaledVector(d.v, dt);
      const floor = this.floorAt(d.m.position.x, d.m.position.z);
      const landed = Number.isFinite(floor) && d.m.position.y < floor && d.m.position.y > floor - 1;
      if (landed || d.life <= 0) {
        if (landed && !d.spark && Math.random() < 0.15) this.pool(d.m.position.x, d.m.position.z, rand(0.15, 0.4));
        this.scene.remove(d.m);
        this.drops.splice(i, 1);
      }
    }
    // Decals
    for (const dc of this.decals) {
      if (dc.grow < 1) { dc.grow = Math.min(1, dc.grow + dt * 0.8); dc.m.scale.setScalar(0.1 + (dc.target - 0.1) * (1 - (1 - dc.grow) ** 3)); }
    }
    // Smoke + flashes
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      if (p.light) { p.light.intensity *= 0.85; }
      else {
        p.m.position.y += p.rise * dt;
        p.m.position.addScaledVector(p.drift, dt);
        p.m.scale.setScalar(1 + (1 - k) * 1.8);
        p.m.material.opacity = p.opacity * k;
      }
      if (p.life <= 0) { this.scene.remove(p.light || p.m); this.puffs.splice(i, 1); }
    }
  }
}
