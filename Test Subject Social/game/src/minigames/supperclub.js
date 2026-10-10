/**
 * SUPPER CLUB — a long dinner table, one dim chandelier and a plate of peas
 * per guest. At the head of the table THE HOST reads his evening paper. He
 * does not tolerate eating while he is watching.
 *
 * Rules:
 *   - A loads one pea onto your fork (up to 3). B eats the forkful.
 *   - The host periodically lowers his newspaper. A rustle and a creak warn you
 *     (~0.6s) before his eyes light up red. Sometimes he only pretends.
 *   - Pressing A or B at all while he watches gets you shot.
 *   - First to clean the plate wins; the finishing order is recorded.
 *   - 60s cap: whoever has the most peas left is shot. When only one diner is
 *     still eating, the cap shrinks to 8 seconds.
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Audio } from '../core/audio.js';
import { block, mesh, stencil, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { Subject } from '../core/characters.js';
import { rand, lerp, clamp, damp } from '../core/util.js';

const PEAS = 22;          // peas per plate
const FORK_MAX = 3;
const CAP = 60;           // round length (seconds)
const LAST_PLATE = 8;     // seconds granted to the final unfinished diner
const TABLE_TOP = 0.76;
const SEAT_X = 1.22;      // distance of a diner from the table's centre line
const SIT_DROP = 0.4;     // how far a seated subject's root is lowered
const SCOOP_TIME = 0.3;
const EAT_TIME = 0.9;
const WARN_TIME = 0.6;

/** Paint the host's newspaper front page (original, procedurally scribbled). */
function newsTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 176;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cdc6ae'; ctx.fillRect(0, 0, 256, 176);
  const img = ctx.getImageData(0, 0, 256, 176);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#1d1b17';
  ctx.font = 'bold 22px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('THE EVENING LEDGER', 128, 26);
  ctx.fillRect(10, 33, 236, 2);
  ctx.font = 'bold 15px Georgia, serif';
  ctx.fillText('GUESTS URGED TO CHEW QUIETLY', 128, 52);
  // Columns of fake copy + a murky photo.
  ctx.fillStyle = 'rgba(30,28,24,0.55)';
  for (let col = 0; col < 4; col++) {
    for (let y = 62; y < 168; y += 5) {
      if (col === 1 && y < 110) continue;
      ctx.fillRect(12 + col * 59, y, rand(40, 54), 2);
    }
  }
  ctx.fillStyle = '#4a463d'; ctx.fillRect(71, 62, 54, 44);
  ctx.fillStyle = '#2a2722'; ctx.beginPath(); ctx.arc(98, 80, 10, 0, 7); ctx.fill(); ctx.fillRect(86, 90, 24, 16);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SupperClub extends Minigame {
  static meta = {
    id: 'supperclub',
    title: 'SUPPER CLUB',
    tagline: 'Dinner is served. Manners are enforced.',
    category: 'Stealth',
    controls: [{ input: 'a', label: 'Load fork' }, { input: 'b', label: 'Eat forkful' }],
    objective: 'Clean your plate first — without being seen eating.',
    rules: [
      '{A} loads a pea onto your fork (three max). {B} eats the forkful.',
      'When the host lowers his paper and his eyes glow red, touch nothing.',
      'A rustle and a creak come first. Sometimes he is only bluffing.',
      'At the 60 second gong, the guest with the most peas left is excused. Permanently.',
    ],
  };

  build() {
    const scene = this.makeScene({ fog: 0x0a0807, fogNear: 10, fogFar: 30, ambient: 0x4a3a30, ambientIntensity: 0.8 });
    const n = this.seats.length;
    this.perSide = Math.ceil(n / 2);
    this.tableLen = Math.max(3.4, this.perSide * 1.6 + 1.2);
    this.hostZ = -this.tableLen / 2 - 0.85;
    this.makeCamera([0, 3.7, this.tableLen / 2 + 3.1], [0, 1.15, -0.95], 52);

    this._buildRoom(scene);
    this._buildTable(scene);
    this._buildHost(scene);

    // Diners: alternate sides, front-to-back.
    this.peaGeo = new THREE.SphereGeometry(0.034, 6, 4);
    this.peaMat = mat(0x6aa632);
    this.seats.forEach((seat, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const j = Math.floor(i / 2);
      const k = side < 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
      const z = (j - (k - 1) / 2) * 1.6 + 0.2;
      this._seatDiner(seat, side, z);
    });

    this.capAt = CAP;
    this.finishOrder = [];
    this.shotQueue = [];
    this._gongDone = false;
  }

  // ------------------------------------------------------------------ set

  _buildRoom(scene) {
    const W = 11, D = this.tableLen + 7;
    const carpet = mesh(new THREE.PlaneGeometry(W, D + 6), mat(0x5a1f1d, Tex.fabric([10, 10])), 0, 0, 0, { cast: false });
    carpet.rotation.x = -Math.PI / 2;
    scene.add(carpet);
    const panel = mat(0xb39a80, Tex.wood([4, 2]));
    const backZ = this.hostZ - 1.6;
    block(scene, 0, 2.5, backZ, W, 5, 0.3, panel);
    block(scene, -W / 2, 2.5, 0, 0.3, 5, D + 6, mat(0xa89078, Tex.wood([6, 2])));
    block(scene, W / 2, 2.5, 0, 0.3, 5, D + 6, mat(0xa89078, Tex.wood([6, 2])));
    // Wainscot rail + grim portraits behind the host.
    block(scene, 0, 1.1, backZ + 0.18, W, 0.08, 0.06, mat(0x3a2414, Tex.wood()));
    const frameMat = mat(0x8a6a2a, Tex.metal());
    for (const x of [-3, 3]) {
      block(scene, x, 2.9, backZ + 0.2, 1.3, 1.6, 0.08, frameMat);
      const canvas = mesh(new THREE.PlaneGeometry(1.1, 1.4), mat(0x2a2620, Tex.concrete()), x, 2.9, backZ + 0.25, { cast: false });
      scene.add(canvas);
      scene.add(mesh(new THREE.CircleGeometry(0.22, 10), mat(0x6a5a48), x, 3.15, backZ + 0.26, { cast: false }));
      scene.add(mesh(new THREE.PlaneGeometry(0.6, 0.55), mat(0x1b1814), x, 2.6, backZ + 0.26, { cast: false }));
    }
    stencil(scene, 'NO SECOND HELPINGS', 0, 4.25, backZ + 0.17, { w: 5.5, h: 1.2, opacity: 0.35, color: '#e8d9b0' });
    pipe(scene, [-W / 2 + 0.3, 4.7, backZ + 0.3], [W / 2 - 0.3, 4.7, backZ + 0.3], 0.1);
  }

  _buildTable(scene) {
    const L = this.tableLen;
    const wood = mat(0x7a5232, Tex.wood([2, 4]));
    block(scene, 0, TABLE_TOP - 0.04, 0, 1.75, 0.08, L, wood);
    const cloth = mesh(new THREE.BoxGeometry(0.6, 0.01, L - 0.2), mat(0x6e6352, Tex.fabric()), 0, TABLE_TOP + 0.005, 0, { cast: false });
    scene.add(cloth); // runner down the centre
    const legMat = mat(0x4a2e1a, Tex.wood());
    for (const x of [-0.75, 0.75]) for (const z of [-L / 2 + 0.2, L / 2 - 0.2]) block(scene, x, (TABLE_TOP - 0.08) / 2, z, 0.12, TABLE_TOP - 0.08, 0.12, legMat);

    // Candles (one shared warm light) + a tureen of something grey.
    const wax = mat(0xe8e0c8);
    const flame = glow(0xffc46a);
    for (const z of [-L / 2 + 0.6, L / 2 - 0.6]) {
      block(scene, 0, TABLE_TOP + 0.04, z, 0.18, 0.06, 0.18, mat(0x8a7a40, Tex.metal()));
      scene.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), wax, 0, TABLE_TOP + 0.23, z));
      scene.add(mesh(new THREE.ConeGeometry(0.03, 0.08, 5), flame, 0, TABLE_TOP + 0.43, z, { cast: false }));
    }
    const candleLight = new THREE.PointLight(0xffb060, 3, 5, 1.5);
    candleLight.position.set(0, TABLE_TOP + 0.6, 0);
    scene.add(candleLight);
    this.candleLight = candleLight;
    scene.add(mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.2, 10), mat(0xa0a39a, Tex.metal()), 0, TABLE_TOP + 0.1, 0));

    // The single dim chandelier.
    const ch = new THREE.Group();
    const brass = mat(0x8a7238, Tex.metal());
    ch.add(mesh(new THREE.TorusGeometry(0.55, 0.04, 5, 14), brass));
    ch.children[0].rotation.x = Math.PI / 2;
    ch.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 2, 4), mat(0x111111), 0, 1.0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ch.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 5), wax, Math.cos(a) * 0.55, 0.09, Math.sin(a) * 0.55));
      ch.add(mesh(new THREE.ConeGeometry(0.025, 0.07, 5), flame, Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55, { cast: false }));
    }
    ch.position.set(0, 3.95, -0.3);
    scene.add(ch);
    this.chandelier = ch;
    const key = new THREE.SpotLight(0xffd8a0, 55, 20, 0.95, 0.7, 1.3);
    key.position.set(0, 3.8, -0.3);
    key.target.position.set(0, 0, -0.3);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.bias = -0.002;
    scene.add(key, key.target);
    this.keyLight = key;
  }

  /** The host: an oversized Subject in a dark suit with a top hat and a newspaper. */
  _buildHost(scene) {
    const host = new Subject({ suit: 0x1c1a1f, skin: 0xd8cbb4, hat: 'Top Hat', face: 'Monocle', number: '--' });
    const S = 1.4;
    host.root.scale.setScalar(S);
    host.root.position.set(0, -SIT_DROP * S, this.hostZ);
    host.pose = 'sit';
    // Shirt front + bow tie over the jumpsuit patch.
    const chest = host.parts.torso;
    chest.add(mesh(new THREE.BoxGeometry(0.2, 0.42, 0.02), mat(0xe2dccb, Tex.fabric()), 0, 0.38, 0.156));
    chest.add(mesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), mat(0x7a1414), 0, 0.6, 0.17));
    // Eyes that glow when he is watching.
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a0606 });
    for (const x of [-0.1, 0.1]) host.parts.head.add(mesh(new THREE.BoxGeometry(0.11, 0.07, 0.01), this.eyeMat, x, 0.05, 0.236, { cast: false }));
    this.eyeLight = new THREE.PointLight(0xff2010, 0, 4, 1.5);
    this.eyeLight.position.set(0, 0.05, 1.2);
    host.parts.head.add(this.eyeLight);
    // Revolver in the right hand, hidden until needed.
    const gun = new THREE.Group();
    const steel = mat(0x2c2d2e, Tex.metal());
    gun.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.05), mat(0x4a2c18, Tex.wood()), 0, 0, 0));
    gun.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 6), steel, 0, -0.08, 0.02));
    const barrel = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), steel, 0, -0.2, 0.03);
    gun.add(barrel);
    gun.position.set(0, -0.78, 0.05);
    gun.visible = false;
    host.parts.armR.add(gun);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.32, 0.03);
    gun.add(this.muzzle);
    this.flash = new THREE.PointLight(0xffc070, 0, 8, 1.5);
    this.muzzle.add(this.flash);
    this.gun = gun;
    scene.add(host.root);

    // A dim spot so the host (and his eyes) read from across the table.
    const hostLight = new THREE.SpotLight(0xffe2b8, 11, 12, 0.55, 0.6, 1.2);
    hostLight.position.set(0, 3.6, this.hostZ + 2.2);
    hostLight.target.position.set(0, 1.6, this.hostZ);
    scene.add(hostLight, hostLight.target);

    // Throne-like chair.
    const chairMat = mat(0x3a1c14, Tex.wood());
    block(scene, 0, 0.27, this.hostZ, 0.95, 0.54, 0.85, chairMat);
    block(scene, 0, 1.3, this.hostZ - 0.45, 1.0, 2.2, 0.12, mat(0x5a1414, Tex.fabric()));

    // Newspaper on a pivot at its bottom edge, held in front of his face.
    this.paperTex = newsTexture();
    const paperMat = new THREE.MeshLambertMaterial({ map: this.paperTex, color: 0xa89f88, side: THREE.DoubleSide });
    const pivot = new THREE.Group();
    const sheetL = mesh(new THREE.PlaneGeometry(0.72, 0.95), paperMat, -0.35, 0.47, 0.03);
    const sheetR = mesh(new THREE.PlaneGeometry(0.72, 0.95), paperMat, 0.35, 0.47, 0.03);
    sheetL.rotation.y = 0.18; sheetR.rotation.y = -0.18; // slight fold
    pivot.add(sheetL, sheetR);
    pivot.position.set(0, 1.55, this.hostZ + 0.75);
    scene.add(pivot);
    this.paper = pivot;

    this.host = {
      subject: host,
      state: 'reading',     // 'reading' | 'warning' | 'fakeHold' | 'watching' | 'raising'
      t: rand(2.5, 4),
      age: 0,               // seconds in the current state
      event: 0,             // increments each time a warning begins
      fake: false,
      lower: 0,             // 0 = paper up, 1 = fully lowered
      aim: null,            // seat being aimed at
      aimT: 0,
      gunHold: 0,
      facing: 0,
    };
  }

  /** Seat a diner: chair, plate, peas (InstancedMesh) and a fork in the right hand. */
  _seatDiner(seat, side, z) {
    const scene = this.scene;
    const x = side * SEAT_X;
    const s = this.spawnSubject(seat, { x, y: -SIT_DROP, z, facing: side < 0 ? Math.PI / 2 : -Math.PI / 2, ring: false });
    s.pose = 'sit';
    // Chair
    const chairMat = mat(0x4a2a18, Tex.wood());
    block(scene, x, 0.2, z, 0.5, 0.4, 0.5, chairMat);
    block(scene, x + side * 0.27, 0.75, z, 0.06, 1.1, 0.5, chairMat);
    // Player-coloured place card so everyone finds their plate.
    const card = mesh(new THREE.BoxGeometry(0.04, 0.08, 0.22), new THREE.MeshBasicMaterial({ color: seat.player.color }), side * 0.18, TABLE_TOP + 0.04, z + 0.32, { cast: false });
    scene.add(card);
    // Plate + peas
    const px = side * 0.52;
    scene.add(mesh(new THREE.CylinderGeometry(0.27, 0.22, 0.03, 14), mat(0xe0dccd), px, TABLE_TOP + 0.015, z));
    const peas = new THREE.InstancedMesh(this.peaGeo, this.peaMat, PEAS);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < PEAS; i++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.17;
      m4.makeTranslation(px + Math.cos(a) * r, TABLE_TOP + 0.064 + (i > 14 ? 0.03 : 0), z + Math.sin(a) * r);
      peas.setMatrixAt(i, m4);
    }
    peas.castShadow = true;
    scene.add(peas);
    // Fork: handle + head with three tines, angled forward-down from the hand.
    const fork = new THREE.Group();
    const silver = mat(0xc8c8c0, Tex.metal());
    fork.add(mesh(new THREE.BoxGeometry(0.025, 0.015, 0.2), silver, 0, 0, 0.08));
    for (const tx of [-0.022, 0, 0.022]) fork.add(mesh(new THREE.BoxGeometry(0.008, 0.008, 0.08), silver, tx, 0, 0.22));
    const load = [];
    for (let i = 0; i < FORK_MAX; i++) {
      const p = mesh(this.peaGeo, this.peaMat, (i - 1) * 0.026, 0.025, 0.21);
      p.visible = false;
      fork.add(p);
      load.push(p);
    }
    fork.position.set(0, -0.76, 0.03);
    fork.rotation.x = Math.PI / 4;
    s.parts.armR.add(fork);

    seat.diner = {
      side, z, peas: PEAS, fork: 0, peasMesh: peas, load,
      anim: null, animT: 0, finished: null, condemned: false, armX: -1.1, armZ: 0, chew: 0,
    };
  }

  // ------------------------------------------------------------- lifecycle

  start() { Audio.sfx('ding'); this.hud.banner('BON APPÉTIT', 1200, 'good'); }

  preview(dt) {
    this._animateHost(dt);
    for (const seat of this.seats) this._animateDiner(seat, dt);
  }

  /** 0 → 1 tension ramp across the round. */
  get ramp() { return clamp(this.time / 45, 0, 1); }

  update(dt) {
    const playing = this.state === 'play';
    if (playing) {
      this._runHost(dt);
      for (const seat of this.aliveSeats) this._handleInput(seat);
      this._runShots(dt);
      this._checkEnd();
    } else {
      this._runShots(dt);
    }
    this._animateHost(dt);
    for (const seat of this.seats) if (seat.alive) this._animateDiner(seat, dt);

    if (!playing) return;
    this.hud.setTimer(Math.max(0, this.capAt - this.time));
    for (const seat of this.seats) {
      const d = seat.diner;
      if (!seat.alive) { this.hud.setStat(seat, 'EXCUSED'); this.hud.setStatus(seat, ''); continue; }
      this.hud.setStat(seat, d.finished ? 'PLATE CLEAN' : `PEAS ${d.peas}${d.fork ? `  FORK ${d.fork}` : ''}`);
      this.hud.setStatus(seat, d.finished ? `FINISHED #${d.finished}` : d.condemned ? 'CAUGHT' : '');
    }
  }

  /** Host behaviour: read → warn (rustle, creak) → watch / bluff → raise paper. */
  _runHost(dt) {
    const h = this.host;
    h.t -= dt;
    h.age += dt;
    const go = (state, t) => { h.state = state; h.t = t; h.age = 0; };
    switch (h.state) {
      case 'reading':
        if (Math.random() < dt * 0.6) Audio.sfx('search', { vol: 0.25 }); // idle page rustle
        if (h.t <= 0) {
          h.event++;
          h.fake = Math.random() < 0.28;
          go('warning', WARN_TIME);
          Audio.sfx('puff', { vol: 0.9 });          // paper rustle
          Audio.sfx('grind', { vol: 0.25 });        // chair creak
        }
        break;
      case 'warning':
        if (h.t <= 0) {
          if (h.fake) go('fakeHold', rand(0.25, 0.45));
          else {
            go('watching', rand(1.4, 2.6) + this.ramp * 0.6);
            Audio.sfx('sting', { vol: 0.35 });
          }
        }
        break;
      case 'fakeHold':
        if (h.t <= 0) { go('raising', 0.35); Audio.sfx('puff', { vol: 0.5 }); }
        break;
      case 'watching':
        if (h.t <= 0 && !h.aim && !this.shotQueue.length && !this._gongDone) { go('raising', 0.4); Audio.sfx('puff', { vol: 0.6 }); }
        break;
      case 'raising':
        if (h.t <= 0) go('reading', rand(lerp(2.0, 1.2, this.ramp), lerp(4.8, 3.0, this.ramp)));
        break;
      default: break;
    }
  }

  get watching() { return this.host.state === 'watching'; }

  /** Read one diner's buttons. Any press while the host watches is fatal. */
  _handleInput(seat) {
    const d = seat.diner, c = seat.ctrl;
    if (d.finished || d.condemned) return;
    if (!c.aPressed && !c.bPressed) return;
    if (this.watching) { this._condemn(seat); return; }
    if (d.anim) return; // still mid-motion
    if (c.aPressed && d.fork < FORK_MAX && d.peas - d.fork > 0) {
      d.fork++;
      d.anim = 'scoop'; d.animT = SCOOP_TIME;
      Audio.sfx('fork', { vol: 1.4 });
    } else if (c.bPressed && d.fork > 0) {
      d.anim = 'eat'; d.animT = EAT_TIME; d.ate = false;
    }
  }

  /** Mark a diner as caught; the host will turn and fire. */
  _condemn(seat, reason = 'CAUGHT EATING') {
    const d = seat.diner;
    if (d.condemned || !seat.alive) return;
    d.condemned = true;
    this.shotQueue.push(seat);
    this.host.t = Math.max(this.host.t, 0.8);
    this.hud.feed(`${seat.player.name} — ${reason}`, seat.player.color);
  }

  /** Aim at queued victims one by one, then fire. */
  _runShots(dt) {
    const h = this.host;
    h.gunHold = Math.max(0, h.gunHold - dt);
    if (!h.aim) {
      while (this.shotQueue.length && !this.shotQueue[0].alive) this.shotQueue.shift();
      if (this.shotQueue.length) {
        h.aim = this.shotQueue.shift();
        h.aimT = 0.4;
        this.gun.visible = true;
        Audio.sfx('reload', { vol: 0.8 });
      }
    }
    if (h.aim) {
      h.aimT -= dt;
      h.gunHold = 0.8;
      if (h.aimT <= 0) {
        const seat = h.aim;
        h.aim = null;
        const from = new THREE.Vector3();
        this.muzzle.getWorldPosition(from);
        const to = new THREE.Vector3();
        seat.subject.parts.chest.getWorldPosition(to);
        this.flash.intensity = 60;
        this.fx.sparks(from, { count: 12, speed: 5 });
        this.fx.smoke(from, { size: 0.15, life: 1.2, opacity: 0.4 });
        this.kill(seat, 'shot', { dir: to.sub(from) });
      }
    }
    if (h.gunHold <= 0 && !h.aim) this.gun.visible = false;
  }

  /** Round end: plates cleaned, executions resolved, or the gong. */
  _checkEnd() {
    if (this.host.aim || this.shotQueue.length) return;
    const alive = this.aliveSeats;
    const eating = alive.filter((s) => !s.diner.finished);
    if (alive.length <= 1 || !eating.length) { this.end(); return; }
    // Only one guest still eating: hurry them along.
    if (eating.length === 1 && this.finishOrder.length && this.capAt > this.time + LAST_PLATE) {
      this.capAt = this.time + LAST_PLATE;
      this.hud.banner('LAST PLATE', 1400, 'danger');
      Audio.sfx('beep');
    }
    if (this.time >= this.capAt) {
      if (this._gongDone) { this.end(); return; }
      this._gongDone = true;
      Audio.sfx('horn');
      // Exactly one guest is excused: most peas left; ties go to whoever has
      // the emptiest fork, then to chance.
      const victim = eating.slice().sort((a, b) => (b.diner.peas - a.diner.peas) || (a.diner.fork - b.diner.fork) || (Math.random() - 0.5))[0];
      this.hud.banner('DINNER IS OVER', 1600, 'danger');
      // The host lowers his paper for the occasion.
      Object.assign(this.host, { state: 'watching', t: 2, age: 0 });
      this._condemn(victim, 'SLOWEST EATER');
    }
  }

  // ------------------------------------------------------------- animation

  _animateHost(dt) {
    const h = this.host, s = h.subject, p = s.parts;
    const target = { reading: 0, warning: 0.45 * clamp(h.age / WARN_TIME, 0, 1), fakeHold: 0.45, watching: 1, raising: 0 }[h.state] ?? 0;
    const rate = h.state === 'warning' ? 30 : h.state === 'watching' ? 14 : 8;
    h.lower += (target - h.lower) * damp(rate, dt);
    // Paper: upright in front of the face → tipped forward and down.
    const rustle = h.state === 'reading' ? Math.sin(performance.now() * 0.011) * 0.015 : 0;
    this.paper.rotation.x = h.lower * 0.6 + rustle;
    this.paper.position.y = 1.55 - h.lower * 0.62;
    // Eyes
    const lit = h.state === 'watching' ? 1 : h.state === 'warning' || h.state === 'fakeHold' ? 0.25 : 0;
    this.eyeMat.color.setRGB(0.16 + lit * 0.84, 0.03 + lit * 0.12, 0.03 + lit * 0.05);
    this.eyeLight.intensity = lit * 3;
    this.flash.intensity *= Math.exp(-dt * 25);

    // Body: turn toward the current target when shooting.
    let face = 0;
    if (h.aim) {
      const q = h.aim.subject.root.position;
      face = Math.atan2(q.x - 0, q.z - this.hostZ);
    }
    h.facing += (face - h.facing) * damp(10, dt);
    s.root.rotation.y = h.facing;
    s.animate(dt, 0);
    const holdX = lerp(-1.35, -0.95, h.lower);
    p.armL.rotation.x = holdX; p.armL.rotation.z = 0.25;
    p.armR.rotation.x = this.gun.visible ? -1.5 : holdX;
    p.armR.rotation.z = this.gun.visible ? 0 : -0.25;
    p.head.rotation.x = h.state === 'reading' ? 0.18 : -0.05;
  }

  _animateDiner(seat, dt) {
    const d = seat.diner, s = seat.subject, p = s.parts;
    s.animate(dt, 0);
    let ax = -1.1, az = 0;
    if (d.anim) {
      d.animT -= dt;
      if (d.anim === 'scoop') {
        const k = 1 - d.animT / SCOOP_TIME;
        ax = -1.1 + Math.sin(k * Math.PI) * 0.28;
      } else {
        const k = 1 - d.animT / EAT_TIME;
        ax = k < 0.75 ? -2.5 : -1.1;
        az = k < 0.75 ? -0.5 : 0;
        if (k > 0.4 && !d.ate) this._swallow(seat);
      }
      if (d.animT <= 0) d.anim = null;
    }
    d.armX += (ax - d.armX) * damp(18, dt);
    d.armZ += (az - d.armZ) * damp(18, dt);
    p.armR.rotation.x = d.armX;
    p.armR.rotation.z = d.armZ;
    p.armL.rotation.x = -0.9;
    // Chewing nod
    if (d.chew > 0) { d.chew -= dt; p.head.rotation.x = Math.sin(d.chew * 30) * 0.08; }
    else p.head.rotation.x = 0.15;
    // Fork load + plate contents
    d.load.forEach((pea, i) => { pea.visible = i < d.fork; });
    d.peasMesh.count = Math.max(0, d.peas - d.fork);
  }

  /** Forkful reaches the mouth: peas leave the world. */
  _swallow(seat) {
    const d = seat.diner;
    d.ate = true;
    d.peas -= d.fork;
    d.fork = 0;
    d.chew = 0.5;
    for (let i = 0; i < 3; i++) setTimeout(() => Audio.sfx('chew', { vol: 1.3 }), i * 120);
    if (d.peas <= 0 && !d.finished && this.state === 'play') {
      d.finished = this.finishOrder.length + 1;
      d.finishTime = this.time;
      this.finishOrder.push(seat);
      Audio.sfx(d.finished === 1 ? 'win' : 'ding');
      this.hud.banner(`${seat.player.name} — PLATE CLEAN`, 1400, 'good');
      if (this.time < 20) this.award(seat, 'speedEater');
    }
  }

  // ------------------------------------------------------------- placement

  /** Finishers in order, then the unfinished by fewest peas, then the dead (latest first). */
  placement() {
    const fin = this.finishOrder.filter((s) => s.alive).map((s) => [s]);
    const rest = this.aliveSeats.filter((s) => !s.diner.finished).sort((a, b) => a.diner.peas - b.diner.peas);
    const dead = this.deaths.slice().reverse();
    return [...fin, ...groupBy(rest, (s) => s.diner.peas), ...groupBy(dead, (s) => s.deathTime.toFixed(3))];
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const d = seat.diner, c = seat.ctrl, b = seat.brain, m = b.memory, h = this.host;
    c.setButtons(false, false);
    c.setMove(0, 0);
    if (d.finished || d.condemned) return;
    // New warning? Decide how long this bot keeps eating before it notices
    // (clumsy bots sometimes get greedy and don't stop in time).
    if (m.event !== h.event) {
      m.event = h.event;
      m.stopAfter = b.reaction + (Math.random() < b.error * 0.9 ? rand(0.5, 1.1) : 0);
      m.resume = b.reaction + rand(0.1, 0.45);
    }
    let safe = false;
    if (h.state === 'reading') safe = h.age > (m.resume ?? 0.3);
    else if (h.state === 'warning') safe = h.age < (m.stopAfter ?? 0);
    else if (h.state === 'watching') safe = h.age < (m.stopAfter ?? 0) - WARN_TIME; // still "reacting"
    // With the gong close, desperate bots start eating while the paper is still rising.
    else if (h.state === 'raising') safe = this.capAt - this.time < 8;
    m.pace = m.pace ?? rand(0.0, 0.14) * (1.3 - b.difficulty); // per-bot table manners
    m.cd = (m.cd ?? 0) - dt;
    if (!safe || d.anim || m.pressed) { m.pressed = false; return; }
    if (m.cd > 0) return;
    if (d.fork < FORK_MAX && d.peas - d.fork > 0) { c.setButtons(true, false); m.cd = SCOOP_TIME + m.pace + rand(0.02, 0.1); }
    else if (d.fork > 0) { c.setButtons(false, true); m.cd = EAT_TIME + m.pace + rand(0.05, 0.2); }
    m.pressed = true; // release on the next think so presses register as taps
  }

  dispose() {
    super.dispose();
    if (this.paperTex) this.paperTex.dispose();
  }
}
