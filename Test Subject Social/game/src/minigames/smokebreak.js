/**
 * SMOKE BREAK — mandatory relaxation, strictly measured.
 *
 * Rules
 *  - Subjects sit on stools in a grim break room, each with a cigarette.
 *  - HOLD A to inhale: your lung meter fills (faster the fuller it gets).
 *  - RELEASE inside the green sweet zone for a good puff (+1) and a fat cloud.
 *    Release below it: weak puff, nothing gained. Release above it: too
 *    harsh, nothing gained. Hit the top of the meter: coughing fit, locked
 *    out for 2 s.
 *  - The sweet zone moves after every puff. Six good puffs finish a
 *    cigarette; a new one is lit automatically.
 *  - 40 s break. Most puffs wins. The subject(s) with the fewest puffs are
 *    dealt with by the ceiling turret — unless everyone tied.
 */
import * as THREE from 'three';
import { Minigame, rankByScore } from './base.js';
import { Audio } from '../core/audio.js';
import { floor, block, stencil, mesh, wallFan } from '../core/environment.js';
import { Tex, mat, glow, canvasTexture } from '../core/textures.js';
import { rand, clamp, lerp, damp } from '../core/util.js';

const DURATION = 40;
const PUFFS_PER_CIG = 6;
const COUGH_LOCK = 2.0;
const CIG_LEN = 0.34;           // full paper length (exaggerated for low-res readability)
const STOOL_Y = 0.82;           // seat height: pelvis rests here when root sits at y = 0
const RAIL_Y = 4.3, RAIL_Z = 1.6;

export class SmokeBreak extends Minigame {
  static meta = {
    id: 'smokebreak',
    title: 'SMOKE BREAK',
    tagline: 'Fifteen minutes of relaxation. Mandatory. Graded.',
    category: 'Timing',
    controls: [{ input: 'a', label: 'Hold to inhale, release to puff' }],
    objective: 'Take the most good puffs before the break ends.',
    rules: [
      'Hold {A} to fill your lungs. Release inside the green zone for a good puff.',
      'Too early does nothing. Fill to the top and you cough for 2 seconds.',
      'The zone moves after every puff.',
      'Fewest puffs when the break ends is shown the exit. By the turret.',
    ],
  };

  build() {
    const n = this.seats.length;
    this.spacing = n <= 2 ? 3.2 : n === 3 ? 2.8 : 2.5;
    const width = n * this.spacing;
    const scene = this.makeScene({ fogNear: 14, fogFar: 40, ambientIntensity: 1.0 });
    const camZ = 6.2 + width * 0.45;
    this.makeCamera([0, 2.6, camZ], [0, 1.55, 0], 45);
    const fill = new THREE.DirectionalLight(0xe0d8c8, 0.75);
    fill.position.set(1, 5, 10);
    scene.add(fill);

    this._buildRoom(width);
    this._buildTurret(width);
    this.meterRoot = document.createElement('div');
    this.meterRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.hud.root.appendChild(this.meterRoot);

    this.seats.forEach((seat, i) => this._buildSeat(seat, (i - (n - 1) / 2) * this.spacing));
    // Ashtray stands between neighbours.
    for (let i = 0; i < n - 1; i++) this._ashtray((i + 0.5 - (n - 1) / 2) * this.spacing, -0.2);

    this.phase = 'play';     // 'play' | 'reckoning'
    this.losers = [];
    this.flickerT = 0;
  }

  // ------------------------------------------------------------------ stage

  _buildRoom(width) {
    const scene = this.scene;
    const W = width + 12;
    floor(scene, W, 16, { tex: 'tiles', tile: 1.5, z: 2 });
    block(scene, 0, 3, -2.6, W, 6, 0.3, mat(0xb8b8a8, Tex.wall([W / 4, 1.5])));
    block(scene, 0, 0.5, -2.42, W, 1.0, 0.06, mat(0x4d5a4a, Tex.wall([W / 4, 0.4]))); // dado band
    stencil(scene, 'BREAK ROOM', -width / 4 - 0.5, 3.85, -2.42, { w: 5, h: 1.7, opacity: 0.5 });
    stencil(scene, 'LUNGS ARE COMPANY PROPERTY', -width / 4 - 0.5, 3.0, -2.42, { w: 5, h: 0.75, opacity: 0.75, color: '#c0402c' });

    // Vending machine.
    const vx = -width / 2 - 1.4;
    block(scene, vx, 1.25, -1.8, 1.3, 2.5, 0.9, mat(0x6e2a22, Tex.metal()));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.9), new THREE.MeshBasicMaterial({ map: vendingTex(), color: 0xcfcfcf }));
    front.position.set(vx - 0.05, 1.4, -1.34); scene.add(front);
    const vLight = new THREE.PointLight(0x9fd8ff, 3, 4, 1.5);
    vLight.position.set(vx, 1.5, -0.8); scene.add(vLight);

    // Big wall fan.
    this.fan = wallFan(scene, width / 2 + 1.3, 3.2, -2.4, { r: 1.1 });
    this.fanPos = new THREE.Vector3(width / 2 + 1.3, 3.2, -2.2);

    // Wall clock (minute hand counts down the break).
    const clock = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), mat(0xe8e2d0), 0.2, 4.3, -2.4);
    clock.rotation.x = Math.PI / 2; scene.add(clock);
    scene.add(mesh(new THREE.TorusGeometry(0.43, 0.04, 4, 16), mat(0x222222), 0.2, 4.3, -2.38));
    this.clockHand = new THREE.Group();
    this.clockHand.position.set(0.2, 4.3, -2.33);
    this.clockHand.add(mesh(new THREE.BoxGeometry(0.03, 0.34, 0.02), glow(0x111111), 0, 0.15, 0));
    scene.add(this.clockHand);

    // Flickering fluorescent tube.
    const tube = new THREE.Group();
    tube.add(mesh(new THREE.BoxGeometry(Math.min(6, width), 0.08, 0.3), mat(0x2c2c2a)));
    this.tubeMat = glow(0xe8fff0);
    tube.add(mesh(new THREE.BoxGeometry(Math.min(6, width) - 0.3, 0.06, 0.12), this.tubeMat, 0, -0.06, 0, { cast: false }));
    tube.position.set(0, 4.6, 0.6);
    scene.add(tube);
    this.tubeLight = new THREE.PointLight(0xdcf5e4, 22, 14, 1.2);
    this.tubeLight.position.set(0, 4.2, 0.9);
    this.tubeLight.castShadow = true;
    this.tubeLight.shadow.mapSize.set(512, 512);
    scene.add(this.tubeLight);
  }

  _ashtray(x, z) {
    const m = mat(0x4a4c48, Tex.metal());
    this.scene.add(mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 10), m, x, 0.02, z));
    this.scene.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), m, x, 0.47, z));
    this.scene.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.1, 10), m, x, 0.95, z));
    for (let k = 0; k < 3; k++) {
      const butt = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 4), mat(0xd8c8a0), x + rand(-0.1, 0.1), 1.02, z + rand(-0.1, 0.1));
      butt.rotation.z = Math.PI / 2; butt.rotation.y = rand(0, 3);
      this.scene.add(butt);
    }
  }

  /** Rail-mounted ceiling turret that tracks the lowest scorer. */
  _buildTurret(width) {
    const scene = this.scene;
    block(scene, 0, RAIL_Y + 0.25, RAIL_Z, width + 4, 0.12, 0.2, mat(0x2a2a28, Tex.metal()));
    const t = new THREE.Group();
    t.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat(0x3d3f3a, Tex.plate()), 0, 0.05, 0));
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.y = -0.2;
    const barrelMat = mat(0x222321, Tex.metal());
    const barrel = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 8), barrelMat, 0, 0, 0.35);
    barrel.rotation.x = Math.PI / 2;
    this.turretPivot.add(mesh(new THREE.SphereGeometry(0.17, 8, 6), barrelMat), barrel);
    this.turretEye = mesh(new THREE.SphereGeometry(0.05, 6, 4), glow(0x550000), 0.1, 0.08, 0.15, { cast: false });
    this.turretPivot.add(this.turretEye);
    // Laser sight: unit-length box along +Z, scaled to the target distance.
    const laserGeo = new THREE.BoxGeometry(0.02, 0.02, 1); laserGeo.translate(0, 0, 0.5);
    this.laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.7 }));
    this.laser.visible = false;
    this.turretPivot.add(this.laser);
    t.add(this.turretPivot);
    t.position.set(width / 2 + 1.2, RAIL_Y, RAIL_Z);
    scene.add(t);
    this.turret = t;
    this.turretTargetX = t.position.x;
  }

  /** Stool, subject, cigarette and DOM lung meter for one seat. */
  _buildSeat(seat, x) {
    const scene = this.scene;
    const metal = mat(0x6a6c68, Tex.metal());
    scene.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12), mat(0x6a1c18, Tex.fabric()), x, STOOL_Y - 0.04, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, STOOL_Y - 0.08, 6), metal, x, (STOOL_Y - 0.08) / 2, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.04, 10), metal, x, 0.02, 0));
    const foot = mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 12), metal, x, 0.32, 0);
    foot.rotation.x = Math.PI / 2; scene.add(foot);

    const s = this.spawnSubject(seat, { x, y: 0, z: 0, facing: 0 });
    s.pose = 'sit';
    seat.hand = s.parts.armR.children[2]; // [upper, fore, hand] — see characters.js mkArm
    Object.assign(seat, {
      lung: 0, mode: 'idle', modeT: 0, zone: rollZone(0), onCig: 0, cigNo: 1, inhaleK: 0,
      statusText: '', statusT: 0, wispT: rand(0, 0.5), exhaleLeft: 0,
    });

    // Cigarette: filter at the group origin, paper + ember along +Z.
    const cig = new THREE.Group();
    const filterGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.08, 6); filterGeo.rotateX(Math.PI / 2); filterGeo.translate(0, 0, 0.04);
    const paperGeo = new THREE.CylinderGeometry(0.034, 0.034, 1, 6); paperGeo.rotateX(Math.PI / 2); paperGeo.translate(0, 0, 0.5);
    cig.add(mesh(filterGeo, mat(0xc98a3a), 0, 0, 0, { cast: false }));
    seat.paper = mesh(paperGeo, mat(0xf2efe6), 0, 0, 0.08, { cast: false });
    seat.emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
    seat.ember = mesh(new THREE.SphereGeometry(0.045, 6, 4), seat.emberMat, 0, 0, 0, { cast: false });
    seat.emberLight = new THREE.PointLight(0xff6a20, 0.6, 1.8, 1.5);
    seat.ember.add(seat.emberLight);
    cig.add(seat.paper, seat.ember);
    scene.add(cig);
    seat.cig = cig;
    this._setCigLength(seat);

    // DOM meter.
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;transform:translate(0,-50%);display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*0.4);';
    el.innerHTML = `
      <div class="sb-bar" style="position:relative;width:calc(var(--u)*1.9);height:calc(var(--u)*14);background:rgba(8,8,6,0.75);border:calc(var(--u)*0.3) solid ${seat.player.color};box-shadow:0 0 0 calc(var(--u)*0.2) #000;">
        <div class="sb-top" style="position:absolute;left:0;right:0;top:0;height:5%;background:#7a1010;"></div>
        <div class="sb-zone" style="position:absolute;left:-30%;right:-30%;background:rgba(71,255,106,0.35);border-top:2px solid #47ff6a;border-bottom:2px solid #47ff6a;"></div>
        <div class="sb-fill" style="position:absolute;left:15%;right:15%;bottom:0;height:0;background:${seat.player.color};"></div>
      </div>
      <div class="sb-label" style="font-family:'VT323',monospace;font-size:calc(var(--u)*2.4);color:var(--bone);text-shadow:0 0 calc(var(--u)*0.4) #000;"></div>`;
    this.meterRoot.appendChild(el);
    seat.meter = { el, bar: el.querySelector('.sb-bar'), zone: el.querySelector('.sb-zone'), fill: el.querySelector('.sb-fill'), label: el.querySelector('.sb-label') };
  }

  _setCigLength(seat) {
    const len = CIG_LEN * (1 - 0.75 * (seat.onCig / PUFFS_PER_CIG));
    seat.paper.scale.z = len;
    seat.ember.position.z = 0.08 + len;
  }

  // -------------------------------------------------------------- per frame

  preview(dt) {
    this._ambience(dt);
    for (const seat of this.seats) this._animateSeat(seat, dt);
    this._placeMeters();
  }

  update(dt) {
    this._ambience(dt);
    const playing = this.state === 'play' && this.phase === 'play';
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      this._stepSeat(seat, dt, playing);
      this._animateSeat(seat, dt);
    }
    this._placeMeters();
    for (const seat of this.seats) {
      seat.statusT = Math.max(0, seat.statusT - dt);
      this.hud.setStat(seat, seat.alive ? `PUFFS ${seat.score} · CIG ${seat.cigNo}` : 'BREAK TERMINATED');
      this.hud.setStatus(seat, seat.alive && seat.statusT > 0 ? seat.statusText : '');
    }
    if (this.state !== 'play') return;
    if (this.phase === 'play') {
      this.hud.setTimer(DURATION - this.time);
      this._trackLowest(dt);
      if (this.time >= DURATION) this._beginReckoning();
    } else this._updateReckoning(dt);
  }

  /** Lung mechanics for one seat. */
  _stepSeat(seat, dt, playing) {
    const a = playing && seat.ctrl.a;
    seat.modeT = Math.max(0, seat.modeT - dt);
    switch (seat.mode) {
      case 'idle':
        seat.lung = Math.max(0, seat.lung - dt * 1.5);
        if (a) { seat.mode = 'inhale'; seat.lung = 0; Audio.sfx('inhale', { vol: 0.8 }); }
        break;
      case 'inhale': {
        const speed = 1 + Math.min(this.time, DURATION) / DURATION * 0.5;
        seat.lung += (0.32 + 0.75 * seat.lung) * speed * dt;
        if (seat.lung >= 1) { seat.lung = 1; this._cough(seat); break; }
        if (!a) this._release(seat);
        break;
      }
      case 'exhale':
        seat.lung = Math.max(0, seat.lung - dt * 2.2);
        if (seat.exhaleLeft > 0 && Math.random() < dt * 9) {
          seat.exhaleLeft--;
          this.fx.smoke(this._mouthPos(seat), { size: rand(0.16, 0.28), rise: 0.7, life: 2.2, opacity: 0.55, color: 0xb8b8b0, drift: this._drift(seat, 0.9) });
        }
        if (seat.modeT <= 0) seat.mode = seat.onCig >= PUFFS_PER_CIG ? this._light(seat) : 'idle';
        break;
      case 'cough':
        seat.lung = Math.max(0, seat.lung - dt);
        if (Math.random() < dt * 4) this.fx.smoke(this._mouthPos(seat), { size: 0.1, rise: 0.4, life: 1, opacity: 0.4 });
        if (seat.modeT <= 0) seat.mode = 'idle';
        break;
      case 'light':
        if (seat.modeT <= 0.35 && !seat.lit) {
          seat.lit = true;
          seat.onCig = 0; seat.cigNo++;
          this._setCigLength(seat);
          seat.cig.visible = true;
          this.fx.sparks(seat.ember.getWorldPosition(new THREE.Vector3()), { count: 6, color: 0xffc040, speed: 2 });
          Audio.sfx('click'); Audio.sfx('burn', { vol: 0.25 });
        }
        if (seat.modeT <= 0) seat.mode = 'idle';
        break;
      default: break;
    }
  }

  _release(seat) {
    const { lo, w } = seat.zone;
    if (seat.lung >= lo && seat.lung <= lo + w) {
      seat.score++; seat.onCig++;
      this._setCigLength(seat);
      this.progress(seat, 'chainSmoker', 1);
      seat.mode = 'exhale'; seat.modeT = 0.75; seat.exhaleLeft = 6;
      Audio.sfx('puff');
      this._status(seat, 'GOOD PUFF +1');
    } else if (seat.lung < lo) {
      seat.mode = 'exhale'; seat.modeT = 0.35; seat.exhaleLeft = 1;
      this._status(seat, 'WEAK');
    } else {
      seat.mode = 'exhale'; seat.modeT = 0.55; seat.exhaleLeft = 2;
      Audio.sfx('wrong', { vol: 0.35 });
      this._status(seat, 'TOO HARSH');
    }
    seat.zone = rollZone(this.time);
  }

  _cough(seat) {
    seat.mode = 'cough'; seat.modeT = COUGH_LOCK;
    seat.zone = rollZone(this.time);
    Audio.sfx('cough');
    this._status(seat, 'COUGHING FIT');
    for (let i = 0; i < 4; i++) this.fx.smoke(this._mouthPos(seat), { size: 0.12, rise: 0.6, life: 1.2, opacity: 0.5, drift: this._drift(seat, 0.5) });
  }

  /** Finish the stub and light a fresh one. Returns the new mode. */
  _light(seat) {
    seat.modeT = 0.9; seat.lit = false;
    seat.cig.visible = false;
    this._status(seat, 'LIGHTING UP');
    return 'light';
  }

  _status(seat, text) { seat.statusText = text; seat.statusT = 0.9; }

  _mouthPos(seat) { return seat.subject.parts.head.localToWorld(new THREE.Vector3(0, -0.09, 0.3)); }

  /** Smoke drift: forward from the face, bent toward the wall fan. */
  _drift(seat, fwd) {
    const p = seat.subject.root.position;
    const toFan = this.fanPos.clone().sub(p).normalize().multiplyScalar(0.35);
    return new THREE.Vector3(0, 0, fwd).add(toFan);
  }

  /** Posing: sitting, arm to mouth while inhaling, cough shakes. */
  _animateSeat(seat, dt) {
    if (!seat.alive) return;
    const s = seat.subject, p = s.parts, t = this.engine.time;
    s.animate(dt, 0);
    p.legL.rotation.x = p.legR.rotation.x = -1.35;
    const wantUp = seat.mode === 'inhale' ? 1 : seat.mode === 'exhale' ? 0.35 : 0;
    seat.inhaleK = lerp(seat.inhaleK, wantUp, damp(10, dt));
    const k = seat.inhaleK;
    p.armR.rotation.x = lerp(-1.0, -2.05, k);
    p.armR.rotation.z = lerp(-0.12, -0.42, k);
    if (seat.mode === 'cough') {
      p.torso.rotation.x = 0.35 + Math.sin(t * 32) * 0.15;
      p.head.rotation.x = 0.2 + Math.sin(t * 32 + 1) * 0.2;
      p.armL.rotation.x = -1.6;
    } else if (seat.mode === 'light') {
      p.armL.rotation.x = -1.9; p.armL.rotation.z = 0.35; // cupping the lighter
    }

    // Cigarette transform: in hand at rest, in the mouth while inhaling.
    s.root.updateMatrixWorld(true);
    const handPos = seat.hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0.06));
    const mouthPos = p.head.localToWorld(new THREE.Vector3(0, -0.1, 0.2));
    const restDir = new THREE.Vector3(0.15, 0.55, 1).normalize();
    const mouthDir = p.head.getWorldDirection(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, 0)).normalize();
    const pos = handPos.lerp(mouthPos, k);
    const dir = restDir.lerp(mouthDir, k).normalize();
    seat.cig.position.copy(pos);
    seat.cig.lookAt(pos.clone().add(dir));

    // Ember glow + idle wisps.
    const hot = seat.mode === 'inhale' ? 1 : 0.4 + Math.sin(t * 7 + seat.player.slot) * 0.08;
    seat.emberMat.color.setRGB(1, 0.25 + hot * 0.45, 0.05 + hot * 0.15);
    seat.emberLight.intensity = 0.4 + hot * 2.2;
    seat.wispT -= dt;
    if (seat.wispT <= 0 && seat.cig.visible) {
      seat.wispT = rand(0.35, 0.7);
      this.fx.smoke(seat.ember.getWorldPosition(new THREE.Vector3()), { size: 0.05, rise: 0.7, life: 1.6, opacity: 0.3, color: 0xc8c8c0, drift: this._drift(seat, 0.05) });
    }
  }

  _ambience(dt) {
    this.fan.update(dt);
    // Fluorescent flicker: mostly steady, occasional stutters.
    this.flickerT -= dt;
    if (this.flickerT <= 0) {
      if (this.flickerOff) { this.flickerOff = false; this.flickerT = rand(0.8, 3); }
      else if (Math.random() < 0.35) { this.flickerOff = true; this.flickerT = rand(0.04, 0.14); }
      else this.flickerT = rand(0.3, 1.5);
    }
    const level = this.flickerOff ? 0.15 : 1;
    this.tubeLight.intensity = 22 * level;
    this.tubeMat.color.setScalar(level > 0.5 ? 0.92 : 0.25);
    const left = this.state === 'play' && this.phase === 'play' ? Math.max(0, DURATION - this.time) : this.phase === 'reckoning' ? 0 : DURATION;
    this.clockHand.rotation.z = -(left / 60) * Math.PI * 2;
    // Turret glides toward its target X.
    const tx = this.turret.position.x;
    this.turret.position.x = tx + clamp(this.turretTargetX - tx, -dt * 7, dt * 7);
  }

  /** During play the turret idly aims at whoever is currently last. */
  _trackLowest() {
    const alive = this.seats.filter((s) => s.alive);
    const min = Math.min(...alive.map((s) => s.score));
    const max = Math.max(...alive.map((s) => s.score));
    if (min === max) { this.turretTargetX = this.turret.position.x; this._aimAt(null); return; }
    const low = alive.find((s) => s.score === min);
    this.turretTargetX = low.subject.root.position.x;
    this._aimAt(low);
  }

  _aimAt(seat) {
    const target = seat ? seat.subject.parts.head.getWorldPosition(new THREE.Vector3()) : this.turret.position.clone().add(new THREE.Vector3(0, -2, 1.2));
    this.turretPivot.lookAt(target);
    return target;
  }

  /** Project each meter next to its subject's head. */
  _placeMeters() {
    const v = new THREE.Vector3();
    for (const seat of this.seats) {
      const m = seat.meter;
      if (!seat.alive || !this.camera) { m.el.style.display = 'none'; continue; }
      seat.subject.parts.head.getWorldPosition(v);
      v.x += 0.62; v.y -= 0.45;
      v.project(this.camera);
      m.el.style.display = '';
      m.el.style.left = `${((v.x + 1) / 2) * 100}%`;
      m.el.style.top = `${((1 - v.y) / 2) * 100}%`;
      m.zone.style.bottom = `${seat.zone.lo * 100}%`;
      m.zone.style.height = `${seat.zone.w * 100}%`;
      m.fill.style.height = `${clamp(seat.lung, 0, 1) * 100}%`;
      const inZone = seat.lung >= seat.zone.lo && seat.lung <= seat.zone.lo + seat.zone.w;
      m.fill.style.background = seat.mode === 'cough' ? '#7a1010' : inZone && seat.mode === 'inhale' ? '#47ff6a' : seat.player.color;
      m.bar.style.transform = seat.mode === 'cough' ? `translateX(${Math.sin(this.engine.time * 50) * 3}px)` : '';
      const txt = `${seat.score} PUFFS`;
      if (m.label.textContent !== txt) m.label.textContent = txt;
    }
  }

  // ---------------------------------------------------------------- ending

  _beginReckoning() {
    this.phase = 'reckoning';
    this.reckonT = 0;
    this.verdict = false;
    this.hud.setTimer(0);
    this.hud.banner("BREAK'S OVER", 1400);
    Audio.sfx('horn');
  }

  _updateReckoning(dt) {
    this.reckonT += dt;
    if (!this.verdict && this.reckonT >= 0.8) {
      this.verdict = true;
      const scores = this.seats.map((s) => s.score);
      const min = Math.min(...scores), max = Math.max(...scores);
      this.losers = min === max ? [] : this.seats.filter((s) => s.score === min);
      this.execIndex = 0; this.execT = 0;
      if (this.losers.length) {
        this.hud.banner('UNDER-INHALED', 1600, 'danger');
        Audio.sfx('sting');
      } else {
        this.hud.banner('ALL SPARED', 1600, 'good');
        this.end(2.4);
      }
    }
    if (!this.verdict || !this.losers.length) return;
    const seat = this.losers[this.execIndex];
    if (!seat) { this.end(2.4); return; }
    // Glide over, paint with the laser, fire.
    this.turretTargetX = seat.subject.root.position.x;
    const target = this._aimAt(seat);
    const arrived = Math.abs(this.turret.position.x - this.turretTargetX) < 0.05;
    this.laser.visible = arrived;
    this.turretEye.material.color.set(arrived ? 0xff2020 : 0x550000);
    if (arrived) {
      const muzzle = this.turretPivot.getWorldPosition(new THREE.Vector3());
      this.laser.scale.z = muzzle.distanceTo(target);
      if (this.execT === 0) Audio.sfx('beep');
      this.execT += dt;
      if (this.execT >= 0.7) {
        this.laser.visible = false;
        this.fx.sparks(muzzle.clone().add(target.clone().sub(muzzle).normalize().multiplyScalar(0.7)), { count: 12, color: 0xffe08a, speed: 5 });
        // Drop the cigarette, then the subject.
        seat.cig.visible = true;
        this.fx.addBody(seat.cig, new THREE.Vector3(rand(-1, 1), 2, 1.5), new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8)), { bleed: false, radius: 0.05, life: 8 });
        this.kill(seat, 'shot', { dir: new THREE.Vector3(0, 0, -1), force: 1 });
        this.execIndex++; this.execT = 0;
      }
    }
  }

  placement() { return rankByScore(this.seats); }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const b = seat.brain, m = b.memory;
    void dt;
    if (this.phase !== 'play') { seat.ctrl.setButtons(false); return; }
    if (seat.mode === 'idle') {
      if (m.wait === undefined) m.wait = this.time + b.reaction + rand(0, 0.4);
      if (this.time >= m.wait) {
        const { lo, w } = seat.zone;
        const jitter = (Math.random() + Math.random() - 1) * w * (1.25 - b.difficulty) * 0.9;
        m.target = Math.random() < b.error * 0.35 ? 1.1 : lo + w * rand(0.3, 0.7) + jitter;
        seat.ctrl.setButtons(true);
      } else seat.ctrl.setButtons(false);
    } else if (seat.mode === 'inhale') {
      // Release a hair early: the release lands one frame later.
      seat.ctrl.setButtons(seat.lung < (m.target ?? 0.5) - 0.02);
      m.wait = undefined;
    } else {
      seat.ctrl.setButtons(false);
      m.wait = undefined;
    }
  }

  dispose() {
    if (this.meterRoot) this.meterRoot.remove();
    super.dispose();
  }
}

// ======================================================================
// Helpers & procedural assets
// ======================================================================

/** New sweet zone; it narrows slightly as the break drags on. */
function rollZone(t) {
  const w = rand(0.12, 0.2) * (1 - Math.min(t, DURATION) / DURATION * 0.3);
  return { lo: rand(0.28, 0.93 - w), w };
}

/** Front panel of the vending machine: rows of mystery rations (cached). */
function vendingTex() {
  return canvasTexture('smoke-vending', 64, (c, s) => {
    c.fillStyle = '#10161a'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#c9a227'; c.fillRect(2, 2, s - 4, 8);
    c.fillStyle = '#1a1208'; c.font = 'bold 7px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('RATIONS', s / 2, 6.5);
    const cols = ['#b5402a', '#3f7d74', '#c9a227', '#6b4a8f', '#8a8a80'];
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < 4; k++) {
        if (Math.random() < 0.15) continue; // sold out
        c.fillStyle = cols[(r + k * 2) % cols.length];
        c.fillRect(5 + k * 11, 14 + r * 9, 8, 6);
      }
      c.fillStyle = '#3a4448'; c.fillRect(4, 20 + r * 9, 44, 1);
    }
    c.fillStyle = '#222'; c.fillRect(52, 14, 9, 30);
    c.fillStyle = '#47ff6a'; c.fillRect(54, 17, 5, 3);
    c.fillStyle = '#05080a'; c.fillRect(6, 58, 40, 5);
  });
}
