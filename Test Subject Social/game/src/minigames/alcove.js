/**
 * ALCOVE ROULETTE — a maintenance tunnel, six one-person nooks and a train
 * that has never once braked.
 *
 * Rules
 *  - The track runs left↔right (X axis) through the tunnel. Three nooks are
 *    recessed into the far wall (-Z) and three into the near wall (+Z).
 *  - Every cycle: CALM (wander) → WARNING (~4 s: klaxon, the tunnel mouth
 *    glows, each nook lights GREEN = safe or RED = a ceiling press will drop)
 *    → TRAIN (sweeps the whole tunnel floor) → VENT (steam blasts everyone
 *    back out of the nooks).
 *  - Safe nooks per cycle = living subjects - 1 (min 1). Somebody always loses.
 *  - A nook holds exactly ONE body. An occupied nook is a wall to everyone
 *    else — but SHOVE (B) aimed at the occupant yanks them out.
 *  - Caught on the tracks: 'gib' along the train's heading. Inside a red nook:
 *    'crush'. Last subject alive wins. After 6 cycles the warnings shorten.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { steerTo } from '../core/ai.js';
import { rand, shuffle } from '../core/util.js';

const HALF = 2.6;          // tunnel half-depth: wall faces at z = ±HALF
const DEPTH = 1.15;        // nook depth beyond the wall face
const NOOK_W = 1.4;        // nook opening width (x) — fits exactly one body
const XMAX = 10;           // walkable tunnel half-length
const SAFE_DEPTH = 0.18;   // centre must be this far past the wall line to dodge the train
const NOOKS = [[-7, -1], [-1, -1], [5, -1], [-5, 1], [1, 1], [7, 1]]; // [x, side]
const CAR_LEN = 6.4, CAR_GAP = 0.5, CARS = 4;
const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;
const TRAIN_SPEED = 34;
const TRAIN_START = XMAX + 10;   // |x| where the train front appears / tail disappears
const PRESS_UP = 3.0, PRESS_DOWN = 0.45;
const LAMP = { off: 0x23231f, red: 0xff2a1a, green: 0x35ff4a };

export class AlcoveRoulette extends Minigame {
  static meta = {
    id: 'alcove',
    title: 'ALCOVE ROULETTE',
    tagline: 'Mind the gap. There is only one gap. It is taken.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'b', label: 'Shove / Evict' }],
    objective: 'Be inside a GREEN nook every time the train comes through.',
    rules: [
      'Nooks light GREEN (safe) or RED (a press drops) before each train.',
      'There is always one fewer safe nook than survivors.',
      'One body per nook. Shove an occupant to drag them out.',
      'Steam vents clear the nooks after every train.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 18, fogFar: 48, ambientIntensity: 1.0 });
    this.makeCamera([0, 13.5, 10.8], [0, 0, 0.35], 46);
    this.arena = new Arena({ bounds: { minX: -XMAX, maxX: XMAX, minZ: -HALF - DEPTH, maxZ: HALF + DEPTH }, shoveForce: 12 });

    // --- floor, ballast and track
    floor(scene, 100, 30, { tex: 'concrete', tile: 3 });
    floor(scene, 100, 3.2, { tex: 'dirt', tile: 2, y: 0.01 });
    const railMat = mat(0xa09f96, Tex.metal());
    for (const z of [-0.72, 0.72]) block(scene, 0, 0.13, z, 100, 0.14, 0.12, railMat);
    const sleeperGeo = new THREE.BoxGeometry(0.35, 0.08, 2.3);
    const n = 90;
    const sleepers = new THREE.InstancedMesh(sleeperGeo, mat(0xffffff, Tex.wood()), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m4.makeTranslation(-49.5 + i * 1.1, 0.045, 0); sleepers.setMatrixAt(i, m4); }
    sleepers.receiveShadow = true;
    scene.add(sleepers);
    hazardStrip(scene, 0, -HALF + 0.22, 100, 0.3, 0.02);
    hazardStrip(scene, 0, HALF - 0.22, 100, 0.3, 0.02);
    for (const sx of [-1, 1]) hazardStrip(scene, sx * (XMAX + 0.2), 0, 0.4, HALF * 2, 0.025);

    // --- walls with nook recesses (far wall tall, near wall cut away for the camera)
    this._buildWall(scene, -1, 3.2);
    this._buildWall(scene, 1, 0.7);
    stencil(scene, 'KEEP CLEAR', -4, 2.2, -HALF + 0.02, { w: 4, h: 1.3, opacity: 0.55 });
    stencil(scene, 'ONE PER NOOK', 2, 2.2, -HALF + 0.02, { w: 4.4, h: 1.3, opacity: 0.55 });
    stencil(scene, 'LINE 9', -10.5, 2.0, -HALF + 0.02, { w: 3, h: 1.1, opacity: 0.4 });
    pipe(scene, [-50, 2.85, -HALF + 0.15], [50, 2.85, -HALF + 0.15], 0.1, 0x3c3a34);
    pipe(scene, [-50, 2.55, -HALF + 0.12], [50, 2.55, -HALF + 0.12], 0.06, 0x5a2a20);

    hangingLamp(scene, -6, 7, 0, { intensity: 80, angle: 0.95 });
    hangingLamp(scene, 0, 7, 0, { intensity: 80, angle: 0.95 });
    hangingLamp(scene, 6, 7, 0, { intensity: 80, angle: 0.95 });

    // --- the nooks: floor lamp tile, coloured light, hydraulic press
    this.nooks = [];
    const pressMat = mat(0xffffff, Tex.plate());
    const hazMat = mat(0xffffff, Tex.hazard([1, 1]));
    const rodMat = mat(0x8a8c88, Tex.metal());
    for (const [x, side] of NOOKS) {
      const zc = side * (HALF + DEPTH / 2);
      const tileMat = glow(LAMP.off);
      const tile = mesh(new THREE.PlaneGeometry(NOOK_W - 0.12, DEPTH - 0.08), tileMat, x, 0.03, zc, { cast: false });
      tile.rotation.x = -Math.PI / 2;
      scene.add(tile);
      const light = new THREE.PointLight(LAMP.off, 0, 5.5, 1.5);
      light.position.set(x, 1.6, zc - side * 0.6);
      scene.add(light);
      const press = new THREE.Group();
      press.add(mesh(new THREE.BoxGeometry(NOOK_W - 0.16, 0.8, DEPTH - 0.14), pressMat));
      press.add(mesh(new THREE.BoxGeometry(NOOK_W - 0.12, 0.12, DEPTH - 0.1), hazMat, 0, -0.42, 0));
      press.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), rodMat, 0, 1.1, 0));
      press.position.set(x, PRESS_UP, zc);
      scene.add(press);
      this.nooks.push({ x, side, zc, tileMat, light, press, pressY: PRESS_UP, pressTarget: PRESS_UP, occupant: null, safe: false, state: 'off', slammed: false, crushed: false });
    }

    // --- tunnel mouth glow (grows during the warning)
    this.mouthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mouthGlow.position.set(-XMAX - 4, 1.5, 0);
    scene.add(this.mouthGlow);
    this.mouthLight = new THREE.PointLight(0xfff0c8, 0, 20, 1.2);
    this.mouthLight.position.set(-XMAX - 3, 1.6, 0);
    scene.add(this.mouthLight);

    this._buildTrain(scene);

    // --- avatars
    this.seats.forEach((seat, i) => {
      const x = (i - (this.seats.length - 1) / 2) * 3, z = 0; // centred line-up on the tracks
      this.spawnSubject(seat, { x, z });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
    });
    this.arena.onShove = (att, vic) => this._evict(att, vic);

    this.phase = 'calm';
    this.phaseT = 0;
    this.calmDur = 2.5;
    this.warnDur = 4;
    this.cycle = 0;
    this.trainDir = 1;
    this.trainFront = 0;
    this.previewT = 3;
    this.beepT = 0;
  }

  /**
   * One tunnel wall with three nook recesses. Solid segments become arena
   * walls; the nook back walls are enforced by the arena bounds.
   * @param {THREE.Scene} scene
   * @param {-1|1} side  -1 = far wall, +1 = near wall
   * @param {number} h   wall height
   */
  _buildWall(scene, side, h) {
    const xs = NOOKS.filter((nk) => nk[1] === side).map((nk) => nk[0]).sort((a, b) => a - b);
    const thick = DEPTH + 0.5;
    const zc = side * (HALF + thick / 2);
    const seg = (a, b) => {
      if (b - a < 0.01) return;
      block(scene, (a + b) / 2, h / 2, zc, b - a, h, thick, mat(0xffffff, Tex.wall([(b - a) / 3, h / 3])));
      const z0 = side * HALF, z1 = side * (HALF + thick + 1);
      this.arena.addWall(a, b, Math.min(z0, z1), Math.max(z0, z1));
    };
    let x0 = -50;
    const backMat = mat(0x8a8478, Tex.concrete([0.5, h / 3]));
    for (const x of xs) {
      seg(x0, x - NOOK_W / 2);
      block(scene, x, h / 2, side * (HALF + DEPTH + 0.25), NOOK_W, h, 0.5, backMat);
      x0 = x + NOOK_W / 2;
    }
    seg(x0, 50);
  }

  /** Long low-poly train; local +X is the nose, cars trail toward -X. */
  _buildTrain(scene) {
    const g = new THREE.Group();
    const w = HALF * 2 - 0.3;
    const body = mat(0x56636a, Tex.metal());
    const dark = mat(0x1d1e1c);
    const stripe = mat(0xb5741f, Tex.rust());
    const win = glow(0x9a8f62);
    for (let i = 0; i < CARS; i++) {
      const cx = -CAR_LEN / 2 - i * (CAR_LEN + CAR_GAP);
      const car = new THREE.Group();
      car.add(mesh(new THREE.BoxGeometry(CAR_LEN, 2.6, w), body, 0, 1.85, 0));
      car.add(mesh(new THREE.BoxGeometry(CAR_LEN - 0.3, 0.35, w - 0.7), body, 0, 3.3, 0));
      car.add(mesh(new THREE.BoxGeometry(CAR_LEN - 1.2, 0.55, w + 0.04), win, 0, 2.35, 0, { cast: false }));
      car.add(mesh(new THREE.BoxGeometry(CAR_LEN + 0.02, 0.22, w + 0.04), stripe, 0, 1.15, 0));
      car.add(mesh(new THREE.BoxGeometry(CAR_LEN - 0.8, 0.5, w - 1.2), dark, 0, 0.35, 0));
      for (const wx of [-CAR_LEN / 2 + 1, CAR_LEN / 2 - 1]) {
        for (const wz of [-0.72, 0.72]) {
          const wheel = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.15, 8), dark, wx, 0.32, wz);
          wheel.rotation.x = Math.PI / 2;
          car.add(wheel);
        }
      }
      car.position.x = cx;
      g.add(car);
    }
    // Nose details: headlamps + a travelling light so the train lights the tunnel.
    const lamp = glow(0xfff4c8);
    for (const z of [-1.5, 1.5]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.35, 0.5), lamp, 0.02, 1.25, z, { cast: false }));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.5, w * 0.7), glow(0x2a2a24), 0.03, 2.4, 0, { cast: false }));
    const head = new THREE.PointLight(0xfff0c8, 50, 16, 1.2);
    head.position.set(2, 1.5, 0);
    g.add(head);
    g.visible = false;
    scene.add(g);
    this.train = g;
  }

  start() {
    this.phase = 'calm';
    this.phaseT = 0;
    this.calmDur = 2.5;
    this._setLamps('off');
    this.train.visible = false;
    this.hud.banner('FIND YOUR NOOK', 1300);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // Demo trains roll through while the briefing is up.
    this.previewT -= dt;
    if (this.previewT <= 0 && !this.train.visible) {
      this.previewT = 6;
      shuffle(this.nooks).forEach((nk, i) => this._lamp(nk, i < 3 ? 'green' : 'red'));
      this._launchTrain(Math.random() < 0.5 ? 1 : -1, false);
    }
    this._animate(dt);
  }

  // ------------------------------------------------------------------ phases

  _startWarning() {
    this.cycle++;
    const safeCount = Math.max(1, this.aliveSeats.length - 1);
    shuffle(this.nooks).forEach((nk, i) => { nk.safe = i < safeCount; nk.slammed = false; nk.crushed = false; this._lamp(nk, nk.safe ? 'green' : 'red'); });
    this.trainDir = Math.random() < 0.5 ? 1 : -1;
    this.warnDur = warnFor(this.cycle);
    this.phase = 'warn';
    this.phaseT = 0;
    this.beepT = 0;
    this.hornDone = false;
    this.mouthGlow.position.x = -this.trainDir * (XMAX + 4);
    this.mouthLight.position.x = -this.trainDir * (XMAX + 3);
    Audio.sfx('horn');
    this.hud.banner('TRAIN INCOMING', 1400, 'danger');
    this.hud.prompt(`<b>${safeCount}</b> GREEN NOOK${safeCount > 1 ? 'S' : ''} — GET IN`);
  }

  /**
   * Send the train through.
   * @param {1|-1} dir travel direction along X
   * @param {boolean} sound play the roar
   */
  _launchTrain(dir, sound = true) {
    this.trainDir = dir;
    for (const nk of this.nooks) { nk.slammed = false; nk.crushed = false; }
    this.trainFront = -dir * TRAIN_START;
    this.train.rotation.y = dir > 0 ? 0 : Math.PI;
    this.train.position.set(this.trainFront, 0, 0);
    this.train.visible = true;
    if (sound) { Audio.sfx('train'); Audio.sfx('trainHorn'); }
  }

  _startVent() {
    this.phase = 'vent';
    this.phaseT = 0;
    this.calmDur = this.cycle < 6 ? 2.6 : 1.6;
    this.mouthGlow.material.opacity = 0;
    this.mouthLight.intensity = 0;
    Audio.sfx('puff');
    for (const nk of this.nooks) {
      nk.pressTarget = PRESS_UP;
      this._lamp(nk, 'off');
      for (let i = 0; i < 3; i++) this.fx.smoke(new THREE.Vector3(nk.x + rand(-0.3, 0.3), 0.3, nk.zc), { color: 0xd8d8d0, size: 0.35, rise: 1.6, life: 1.2, opacity: 0.45, drift: new THREE.Vector3(0, 0, -nk.side * 1.5) });
      const occ = nk.occupant;
      if (occ && occ.alive) { occ.knock.set(rand(-1.5, 1.5), 0, -nk.side * 9); occ.stun = 0.3; }
    }
  }

  // --------------------------------------------------------------- nook logic

  /** Nook whose opening column contains the actor and whose wall line it has crossed. */
  nookOf(a, minDepth = -0.05) {
    for (const nk of this.nooks) {
      if (Math.abs(a.pos.x - nk.x) < NOOK_W / 2 && a.pos.z * nk.side - HALF > minDepth) return nk;
    }
    return null;
  }

  /** Maintain one-occupant-per-nook: occupied nooks act as walls for everyone else. */
  _nookRules() {
    const actors = this.arena.actors.filter((a) => a.alive && !a.falling);
    for (const nk of this.nooks) {
      const inCol = (a) => Math.abs(a.pos.x - nk.x) < NOOK_W / 2;
      const depth = (a) => a.pos.z * nk.side - HALF;
      const o = nk.occupant;
      if (o && (!o.alive || !inCol(o) || depth(o) < -0.05)) nk.occupant = null;
      if (!nk.occupant) {
        let best = null;
        for (const a of actors) if (inCol(a) && depth(a) > -0.05 && (!best || depth(a) > depth(best))) best = a;
        nk.occupant = best;
      }
      if (!nk.occupant) continue;
      for (const a of actors) {
        if (a === nk.occupant || !inCol(a) || depth(a) <= -a.radius) continue;
        a.pos.z = nk.side * (HALF - a.radius);
        a.subject.root.position.z = a.pos.z;
      }
    }
  }

  /** Shoving a nook occupant drags them OUT toward the tracks instead of deeper in. */
  _evict(att, vic) {
    vic.data.lastShover = att.seat;
    const nk = this.nookOf(vic);
    if (!nk) return;
    const sx = Math.sign(vic.pos.x - att.pos.x) || (Math.random() < 0.5 ? -1 : 1);
    vic.knock.set(sx * 3.5, 0, -nk.side * 11);
    vic.stun = 0.55;
    Audio.sfx('clank', { vol: 0.6 });
    this.hud.feed(`${att.player.name} evicted ${vic.player.name}`, att.player.color);
  }

  _lamp(nk, state) {
    nk.state = state;
    nk.tileMat.color.setHex(LAMP[state]);
    nk.light.color.setHex(LAMP[state]);
    nk.light.intensity = state === 'off' ? 0 : 9;
  }

  _setLamps(state) { for (const nk of this.nooks) this._lamp(nk, state); }

  // ------------------------------------------------------------------- update

  /** Train motion, presses, lamp pulse. Runs in every state (kills only while playing). */
  _animate(dt) {
    const playing = this.state === 'play';
    if (this.train.visible) {
      this.trainFront += this.trainDir * TRAIN_SPEED * dt;
      this.train.position.x = this.trainFront;
      if (Math.abs(this.trainFront) < TRAIN_START + TRAIN_LEN) this.engine.shake(0.03);
      // Red presses slam as the nose passes them.
      for (const nk of this.nooks) {
        if (nk.state === 'red' && !nk.slammed && (this.trainFront - nk.x) * this.trainDir >= 0) {
          nk.slammed = true;
          nk.pressTarget = PRESS_DOWN;
        }
      }
      if (playing && this.phase === 'train') this._trainKills();
      const tail = this.trainFront - this.trainDir * TRAIN_LEN;
      if (tail * this.trainDir > TRAIN_START) {
        this.train.visible = false;
        if (playing && this.phase === 'train') this._startVent();
        else if (this.state !== 'play') this._setLamps('off');
        for (const nk of this.nooks) nk.pressTarget = PRESS_UP;
      }
    }
    for (const nk of this.nooks) {
      const down = nk.pressTarget < nk.pressY;
      const speed = down ? 28 : 3;
      nk.pressY = down ? Math.max(nk.pressTarget, nk.pressY - speed * dt) : Math.min(nk.pressTarget, nk.pressY + speed * dt);
      nk.press.position.y = nk.pressY;
      // Near-wall presses would hang in the camera's line of sight over the
      // tracks, so they only appear while slamming.
      if (nk.side > 0) nk.press.visible = nk.pressY < PRESS_UP - 0.05;
      if (nk.slammed && !nk.crushed && nk.pressY <= 1.4) {
        nk.crushed = true;
        this.engine.shake(0.3);
        this.fx.sparks(new THREE.Vector3(nk.x, 0.2, nk.zc), { count: 12 });
        if (playing) {
          let hit = false;
          for (const seat of this.aliveSeats) {
            if (this.nookOf(seat.actor) === nk) { this.kill(seat, 'crush'); hit = true; }
          }
          Audio.sfx(hit ? 'metal' : 'clank');
        }
      }
      if (nk.state !== 'off') nk.light.intensity = 7 + Math.sin(this.time * 12 + nk.x) * 2;
    }
  }

  _trainKills() {
    const dir = this.trainDir;
    const lo = Math.min(this.trainFront, this.trainFront - dir * TRAIN_LEN);
    const hi = Math.max(this.trainFront, this.trainFront - dir * TRAIN_LEN);
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      if (a.pos.x + a.radius < lo || a.pos.x - a.radius > hi) continue;
      if (this.nookOf(a, SAFE_DEPTH)) continue;
      this.kill(seat, 'gib', { dir: new THREE.Vector3(dir, 0, rand(-0.2, 0.2)), force: 1.5 });
    }
  }

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    this._nookRules();
    this._animate(dt);
    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'FLATTENED'); continue; }
      const nk = this.nookOf(seat.actor);
      this.hud.setStat(seat, !nk ? 'EXPOSED' : nk.state === 'green' ? 'SAFE' : nk.state === 'red' ? 'DOOMED' : 'IN NOOK');
    }
    if (!playing) return;

    this.phaseT += dt;
    if (this.phase === 'calm') {
      this.hud.setTimer(this.calmDur - this.phaseT + warnFor(this.cycle + 1));
      if (this.phaseT >= this.calmDur) this._startWarning();
    } else if (this.phase === 'warn') {
      const k = this.phaseT / this.warnDur;
      this.hud.setTimer(this.warnDur - this.phaseT);
      this.mouthGlow.material.opacity = Math.min(1, k * 1.2);
      this.mouthGlow.scale.setScalar(0.5 + k * k * 6);
      this.mouthLight.intensity = k * k * 80;
      this.beepT -= dt;
      if (this.beepT <= 0) { this.beepT = k > 0.7 ? 0.25 : 0.5; Audio.sfx('beep', { vol: 0.6 }); }
      if (!this.hornDone && this.warnDur - this.phaseT < 1.2) { this.hornDone = true; Audio.sfx('trainHorn'); }
      if (this.phaseT >= this.warnDur) {
        this.phase = 'train';
        this.phaseT = 0;
        this.hud.prompt(null);
        this.hud.setTimer(null);
        this._launchTrain(this.trainDir);
      }
    } else if (this.phase === 'train') {
      this.hud.setTimer(null);
      if (this.phaseT > 6 && this.train.visible === false) this._startVent(); // safety net
    } else if (this.phase === 'vent') {
      if (this.phaseT >= 0.7) { this.phase = 'calm'; this.phaseT = 0; }
    }

    if (this.aliveSeats.length <= 1) {
      const w = this.aliveSeats[0];
      if (w) {
        this.hud.banner('LAST NOOK TAKEN', 2200, 'good');
        this.hud.feed(`${w.player.name} took the last nook`, w.player.color);
        // Commendation: rode out the deciding train inside the last green nook.
        const nk = this.nookOf(w.actor, SAFE_DEPTH);
        if (this.phase === 'train' && nk && nk.safe) this.award(w, 'lastNook');
      }
      this.hud.prompt(null);
      this.end(2.6);
    }
  }

  /** Ties (same train) share a tier. */
  placement() {
    return tieredPlacement(this);
  }

  // ---------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    a.ctrl.setButtons(false, false);
    const mine = this.nookOf(a);
    if (mem.cycle !== this.cycle) { mem.cycle = this.cycle; mem.sloppy = Math.random() < brain.error; mem.target = null; }

    if (this.phase === 'warn' || this.phase === 'train') {
      if (this.phase === 'warn' && this.phaseT < brain.reaction * 2.2) return; // still processing the lights
      if (mine && mine.occupant === a) {
        if (mine.safe) { steerTo(a, mine.x, mine.side * (HALF + DEPTH * 0.62), { arrive: 0.06, slow: 0.4 }); return; }
        steerTo(a, mine.x + rand(-0.2, 0.2), mine.side * (HALF - 1.5)); // red: get out
        return;
      }
      const cost = (nk) => Math.abs(nk.x - a.pos.x) + Math.abs(nk.side * HALF - a.pos.z);
      const greens = this.nooks.filter((nk) => nk.safe);
      const free = greens.filter((nk) => !nk.occupant || nk.occupant === a).sort((p, q) => cost(p) - cost(q));
      if (free.length) {
        let t = mem.target && free.includes(mem.target) ? mem.target : null;
        if (!t || cost(t) > cost(free[0]) + 2.5) t = mem.sloppy ? free[free.length - 1] : free[0];
        mem.target = t;
        this._approach(a, t);
      } else if (greens.length) {
        // Every green is taken: go evict the nearest occupant.
        const t = greens.sort((p, q) => cost(p) - cost(q))[0];
        const occ = t.occupant;
        const ex = t.x, ez = t.side * (HALF - 0.5);
        const d = Math.hypot(occ.pos.x - a.pos.x, occ.pos.z - a.pos.z);
        if (d < 1.4) {
          a.ctrl.setMove((occ.pos.x - a.pos.x) / d * 0.3, (occ.pos.z - a.pos.z) / d * 0.3);
          if (Math.random() < 0.12 + brain.difficulty * 0.15) a.ctrl.setButtons(false, true);
        } else steerTo(a, ex, ez, { arrive: 0.1 });
      }
      return;
    }

    // Calm / vent: loiter on the tracks, drifting between spots.
    if (mine) { steerTo(a, mine.x, mine.side * (HALF - 1.5)); return; }
    mem.spotT = (mem.spotT ?? 0) - dt;
    if (!mem.spot || mem.spotT <= 0) { mem.spot = { x: rand(-7.5, 7.5), z: rand(-1.3, 1.3) }; mem.spotT = rand(1.5, 3.5); }
    steerTo(a, mem.spot.x, mem.spot.z, { arrive: 0.4 });
  }

  /** Walk to a nook's entrance, line up with it, then step inside. */
  _approach(a, nk) {
    const depth = a.pos.z * nk.side - HALF;
    if (Math.abs(a.pos.x - nk.x) > 0.16 && depth < -0.25) steerTo(a, nk.x, nk.side * (HALF - 0.55), { arrive: 0.05, slow: 0.5 });
    else steerTo(a, nk.x, nk.side * (HALF + DEPTH * 0.62), { arrive: 0.06, slow: 0.4 });
  }
}

/** Warning length for a cycle: 4 s, shrinking after the sixth train. */
function warnFor(cycle) {
  return cycle <= 6 ? 4 : Math.max(2.2, 4 - (cycle - 6) * 0.35);
}

/** Survivors first, then the dead latest-first; simultaneous deaths share a tier. */
function tieredPlacement(game) {
  const tiers = [];
  const alive = game.aliveSeats;
  if (alive.length) tiers.push(alive);
  for (const s of game.deaths.slice().reverse()) {
    const last = tiers[tiers.length - 1];
    if (last && !last[0].alive && Math.abs(last[0].deathTime - s.deathTime) < 0.05) last.push(s);
    else tiers.push([s]);
  }
  return tiers;
}

/** Soft radial glow sprite texture (headlight bloom). */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
