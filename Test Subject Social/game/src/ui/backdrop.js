/**
 * backdrop.js — the 3D "intake room" rendered behind every menu.
 *
 * Four pedestals under swinging lamps hold the joined test subjects. The
 * lobby rebuilds a pedestal's subject whenever its owner changes their look.
 */
import * as THREE from 'three';
import { createMoodScene, hangingLamp } from '../core/engine.js';
import { Subject } from '../core/characters.js';
import { room, stencil, pipe, wallFan, block, crate, hazardStrip } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';

export class Backdrop {
  constructor() {
    const scene = createMoodScene({ fog: 0x070707, fogNear: 8, fogFar: 32, ambientIntensity: 0.55 });
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 2.4, 9.5);
    this.camLook = new THREE.Vector3(0, 1.4, 0);
    this.camera.lookAt(this.camLook);
    this.t = 0;
    this.mode = 'title'; // 'title' | 'lobby' | 'final'

    room(scene, 18, 12, 7, { open: ['south'] });
    stencil(scene, 'INTAKE', 0, 4.6, -5.8, { w: 7, h: 2.4 });
    stencil(scene, 'NO EXIT', -6.8, 2.2, -5.8, { w: 3, h: 1.1, opacity: 0.4 });
    this.fan = wallFan(scene, 6.2, 4.4, -5.8, { r: 1.3 });
    pipe(scene, [-9, 6, -5.6], [9, 6, -5.6], 0.16);
    pipe(scene, [-9, 5.6, -5.5], [9, 5.6, -5.5], 0.09, 0x6b3a22);
    pipe(scene, [-7.5, 0, -5.6], [-7.5, 7, -5.6], 0.14);
    crate(scene, -7.2, 0, -3.5, 1.1, 0.3);
    crate(scene, -6.4, 0, -4.6, 0.9, 0.8);
    crate(scene, -7, 1.1, -3.7, 0.8, 0.1);
    block(scene, 7, 0.6, -4, 1.4, 1.2, 1.4, mat(0xffffff, Tex.rust()));
    hazardStrip(scene, 0, 3.2, 14, 0.4);

    // Pedestals + lamps
    this.slots = [];
    const xs = [-4.2, -1.4, 1.4, 4.2];
    xs.forEach((x, i) => {
      const ped = block(scene, x, 0.15, 0, 1.6, 0.3, 1.6, mat(0x55524a, Tex.plate()));
      const lamp = hangingLamp(scene, x, 5.2, 0.4, { intensity: 0, angle: 0.5, distance: 12 });
      const holder = new THREE.Group();
      holder.position.set(x, 0.3, 0);
      scene.add(holder);
      this.slots.push({ x, ped, lamp, holder, subject: null, swing: i * 1.7, on: false });
    });
    this.key = new THREE.PointLight(0xffd6a0, 6, 20);
    this.key.position.set(0, 5, 4);
    scene.add(this.key);
  }

  /** Put a subject (or nothing) on pedestal `i`. */
  setSlot(i, look, number) {
    const s = this.slots[i];
    if (s.subject) { s.holder.remove(s.subject.root); s.subject.dispose(); s.subject = null; }
    s.on = !!look;
    if (!look) return;
    s.subject = new Subject({ ...look, number: String(number).padStart(2, '0') });
    s.subject.root.rotation.y = 0;
    s.holder.add(s.subject.root);
  }

  setPose(i, pose) { const s = this.slots[i]; if (s.subject) s.subject.pose = pose; }

  update(dt) {
    this.t += dt;
    this.fan.update(dt);
    for (const s of this.slots) {
      s.swing += dt;
      const target = s.on ? 70 : 0;
      s.lamp.light.intensity += (target - s.lamp.light.intensity) * Math.min(1, dt * 6);
      s.lamp.bulb.material.color.setHex(s.on ? 0xffe2b0 : 0x222222);
      s.lamp.group.rotation.z = Math.sin(s.swing * 0.9) * 0.06;
      s.lamp.group.rotation.x = Math.cos(s.swing * 0.7) * 0.04;
      if (s.subject) {
        s.subject.animate(dt, 0);
        s.subject.root.rotation.y = Math.sin(this.t * 0.6 + s.x) * 0.25;
      }
    }
    // Slow cinematic drift
    const cx = Math.sin(this.t * 0.12) * 0.8;
    const lobby = this.mode === 'lobby';
    const targetPos = lobby ? new THREE.Vector3(cx * 0.3, 1.5, 8.6) : new THREE.Vector3(cx, 2.6 + Math.sin(this.t * 0.2) * 0.2, 9.8);
    this.camera.position.lerp(targetPos, Math.min(1, dt * 1.5));
    this.camLook.lerp(lobby ? new THREE.Vector3(0, 0.15, 0) : new THREE.Vector3(0, 1.4, 0), Math.min(1, dt * 1.5));
    this.camera.lookAt(this.camLook);
  }
}
