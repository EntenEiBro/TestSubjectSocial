/**
 * QUICK DRAW — a reaction audit. Subjects stand in a row, each behind a big
 * red button on a pedestal, under a rail of ceiling guns.
 *
 * Rules
 *  - Every heat the wall screen shows WAIT (red lamps), then after a random
 *    1.5–4.5 s it turns green and shows DRAW!. Press A as fast as possible.
 *  - Pressing during WAIT is a FALSE START: the heat is aborted and every
 *    subject who jumped that tick is zapped and loses a life.
 *  - Otherwise the heat ends when everyone has pressed or 1.2 s after DRAW.
 *    Anyone who did not press in time loses a life ("TOO SLOW"); if everyone
 *    pressed, the slowest subject (ties included) loses a life. If every
 *    remaining subject pressed on the very same tick it is a DEAD HEAT and
 *    nobody is punished.
 *  - Each subject has 2 lives (bulbs on the pedestal + HUD). At 0 lives the
 *    ceiling gun paints them with a laser and shoots them.
 *  - Heats repeat until one subject is left. No new heat starts after 62 s
 *    (timer shows 70 s); then survivors rank by lives left, then by total
 *    reaction time (false starts / no-press count as 1.2 s). The dead rank
 *    by the heat they died in (later = better), then total reaction time.
 *  - Each heat's reaction times are listed in the kill feed (fastest on top).
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, pipe } from '../core/environment.js';
import { Tex, mat } from '../core/textures.js';
import { lerp, damp } from '../core/util.js';
import { rand, random } from '../core/rng.js';
import { Haptics } from '../core/haptics.js';

const LIVES = 2;
const PAUSE = 1.3;                    // between heats ("HEAT n")
const WAIT_MIN = 1.5, WAIT_MAX = 4.5; // random WAIT before DRAW
const DRAW_WINDOW = 1.2;              // no press within this → life lost
const RESULT_TIME = 1.7;              // minimum time the heat result is shown
const CAP = 70;                       // displayed round length
const LAST_HEAT = 62;                 // no new heat starts after this
const AIM_TIME = 0.7;                 // laser on the doomed before the shot
const EXEC_GAP = 0.4;
const PED_Z = 0.56;                   // pedestal (button) distance in front of the subject
const BTN_X = 0.12, BTN_Y = 1.08;     // button position inside the pedestal group
const GUN_Y = 4.1, GUN_Z = 0.7;       // ceiling gun rail
const LIT = 0x47ff6a, UNLIT = 0x2a0806;
// Right-arm pitch (rotation.x) targets: hanging, poised over the button, slamming it.
const ARM_REST = -0.25, ARM_POISED = -1.32, ARM_SLAM = -1.05;

export class QuickDraw extends Minigame {
  static meta = {
    id: 'quickdraw',
    title: 'QUICK DRAW',
    tagline: 'Slow hands are a liability. Liabilities are removed.',
    category: 'Reflex',
    controls: [{ input: 'a', label: 'Press the button' }],
    objective: 'Press faster than everyone else. Be the last subject with lives left.',
    rules: [
      'When the screen turns green and says DRAW, press {A} as fast as you can.',
      'The slowest subject of each heat loses one of two lives. Not pressing within 1.2 s also costs a life.',
      'Press before the screen turns green and you are zapped for a false start. That costs a life too.',
      'Out of lives? The ceiling gun handles the paperwork.',
      'After 70 s the most lives left wins, then the lowest total reaction time.',
    ],
  };

  build() {
    const n = this.seats.length;
    this.spacing = n <= 2 ? 3.0 : n === 3 ? 2.7 : 2.4;
    const width = n * this.spacing;
    const scene = this.makeScene({ fogNear: 14, fogFar: 40, ambientIntensity: 0.85 });
    this.makeCamera([0, 2.9, 5.2 + width * 0.35], [0, 1.75, 0], 45);
    const fill = new THREE.DirectionalLight(0xe0d8c8, 0.6);
    fill.position.set(1, 5, 10);
    scene.add(fill);

    // Shared geometries / materials (reused by every seat).
    const laserGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    laserGeo.translate(0, 0, 0.5);
    this.G = {
      pedBase: new THREE.BoxGeometry(0.6, 0.06, 0.52),
      pedCol: new THREE.BoxGeometry(0.46, 0.9, 0.4),
      pedTop: new THREE.BoxGeometry(0.52, 0.05, 0.46),
      housing: new THREE.CylinderGeometry(0.19, 0.21, 0.05, 14),
      button: new THREE.CylinderGeometry(0.15, 0.15, 0.1, 14),
      plate: new THREE.PlaneGeometry(0.4, 0.14),
      bulbRim: new THREE.BoxGeometry(0.11, 0.11, 0.03),
      bulb: new THREE.SphereGeometry(0.045, 8, 6),
      gunMount: new THREE.BoxGeometry(0.1, 0.5, 0.1),
      gunBody: new THREE.BoxGeometry(0.28, 0.22, 0.4),
      barrel: new THREE.CylinderGeometry(0.05, 0.06, 0.42, 8),
      eye: new THREE.SphereGeometry(0.04, 6, 4),
      laser: laserGeo,
    };
    this.M = {
      ped: mat(0x5c605a, Tex.plate()),
      dark: mat(0x232421, Tex.metal()),
      housing: mat(0xc9a227, Tex.metal()),
      button: mat(0xc8201a),
      hazard: mat(0xffffff, Tex.hazard()),
      gun: mat(0x3a3c38, Tex.metal()),
      barrel: mat(0x1f201e, Tex.metal()),
      laser: new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.75 }),
    };

    this._buildRoom(width);
    this.seats.forEach((seat, i) => this._buildSeat(seat, (i - (n - 1) / 2) * this.spacing));

    this.phase = 'intro';    // 'intro' | 'pause' | 'wait' | 'draw' | 'result' | 'done'
    this.phaseT = 0;          // seconds in the current phase (in 'draw': time since DRAW)
    this.playT = 0;           // seconds of play since GO
    this.heat = 0;
    this.waitDur = 3;
    this.drawAt = 0;
    this.tickT = 0;
    this.execQueue = [];
    this.resultEnd = 0;
    this.signalMode = 'off';
    this.signalT = 0;
    this._v = new THREE.Vector3();
    this._screenKey = '';
    this._drawScreen('QUICK DRAW', '#d8d2c0', '#141410', 'REACTION AUDIT');
  }

  // ------------------------------------------------------------------ stage

  _buildRoom(width) {
    const scene = this.scene;
    const W = width + 12;
    floor(scene, W, 14, { tex: 'plate', tile: 2, z: 2 });
    block(scene, 0, 3, -2.2, W, 6, 0.3, mat(0xffffff, Tex.wall([W / 4, 1.5])));
    block(scene, 0, 0.5, -2.03, W, 1.0, 0.06, mat(0x4a3a30, Tex.rust([W / 4, 0.4]))); // grimy dado band
    pipe(scene, [-W / 2, 5.1, -1.95], [W / 2, 5.1, -1.95], 0.14);
    pipe(scene, [-W / 2, 4.75, -1.98], [W / 2, 4.75, -1.98], 0.07, 0x5a3022);
    hazardStrip(scene, 0, PED_Z + 0.5, width + 1.2, 0.3, 0.012);
    stencil(scene, 'NO FLINCHING', 4.4, 3.3, -2.04, { w: 3.2, h: 1.1, opacity: 0.6 });
    stencil(scene, 'SLOWEST HAND IS REVIEWED', -4.4, 3.3, -2.04, { w: 3.2, h: 0.7, opacity: 0.75, color: '#c0402c' });

    // Wall screen + signal lamps.
    block(scene, 0, 3.2, -1.98, 3.7, 1.75, 0.2, mat(0x2e2f2b, Tex.plate()));
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.screenCanvas = canvas;
    this.screenTex = tex;
    scene.add(mesh(new THREE.PlaneGeometry(3.4, 1.49), new THREE.MeshBasicMaterial({ map: tex }), 0, 3.2, -1.87, { cast: false }));
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x1c1c1a });
    const lampGeo = new THREE.SphereGeometry(0.26, 12, 8);
    const rimGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 14);
    for (const sx of [-1, 1]) {
      const rim = mesh(rimGeo, this.M.dark, sx * 2.25, 3.2, -1.98);
      rim.rotation.x = Math.PI / 2;
      scene.add(rim, mesh(lampGeo, this.lampMat, sx * 2.25, 3.2, -1.9, { cast: false }));
    }
    this.signal = new THREE.PointLight(0xff2010, 0, 14, 1.3);
    this.signal.position.set(0, 3.0, -1.1);
    scene.add(this.signal);

    // Ceiling rail for the guns + one shadow-casting work lamp.
    block(scene, 0, GUN_Y + 0.62, GUN_Z, width + 2, 0.12, 0.2, this.M.gun);
    hangingLamp(scene, 0, 6.4, 1.6, { intensity: 85, angle: 1.05, target: { x: 0, y: 0, z: 0.3 } });
  }

  /** Pedestal, button, life bulbs, ceiling gun and per-seat state. */
  _buildSeat(seat, x) {
    const { G, M } = this;
    this.spawnSubject(seat, { x, z: 0, facing: 0 });
    // Pedestal sits slightly right so the button lands under the right hand.
    const ped = new THREE.Group();
    ped.position.set(x + 0.2, 0, PED_Z);
    ped.add(mesh(G.pedBase, M.dark, 0, 0.03, 0));
    ped.add(mesh(G.pedCol, M.ped, 0, 0.5, 0));
    ped.add(mesh(G.pedTop, M.dark, 0, 0.975, 0));
    ped.add(mesh(G.housing, M.housing, BTN_X, 1.02, 0));
    const button = mesh(G.button, M.button, BTN_X, BTN_Y, 0);
    ped.add(button);
    ped.add(mesh(G.plate, M.hazard, 0, 0.16, 0.201, { cast: false }));
    const bulbs = [];
    for (let k = 0; k < LIVES; k++) {
      const bx = (k - (LIVES - 1) / 2) * 0.16;
      const bm = new THREE.MeshBasicMaterial({ color: LIT });
      ped.add(mesh(G.bulbRim, M.dark, bx, 0.72, 0.215));
      ped.add(mesh(G.bulb, bm, bx, 0.72, 0.235, { cast: false }));
      bulbs.push(bm);
    }
    this.scene.add(ped);

    const gun = new THREE.Group();
    gun.position.set(x, GUN_Y, GUN_Z);
    gun.add(mesh(G.gunMount, M.gun, 0, 0.3, 0));
    const pivot = new THREE.Group();
    const barrel = mesh(G.barrel, M.barrel, 0, 0, 0.36);
    barrel.rotation.x = Math.PI / 2;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x440000 });
    const laser = new THREE.Mesh(G.laser, M.laser);
    laser.visible = false;
    pivot.add(mesh(G.gunBody, M.gun), barrel, mesh(G.eye, eyeMat, 0.11, 0.06, 0.16, { cast: false }), laser);
    const aim = new THREE.Object3D();
    gun.add(pivot, aim);
    this.scene.add(gun);

    Object.assign(seat, {
      lives: LIVES, total: 0, best: null, diedHeat: 0,
      heatState: 'idle', ms: 0, lost: false, beeped: false, execAt: 0,
      pressT: 0, zapT: 0, btnK: 0, armK: ARM_REST, tenseK: 0,
      button, bulbs,
      gun: { group: gun, pivot, aim, barrel, laser, eyeMat, recoil: 0, aiming: false },
    });
  }

  /** Repaint the wall screen (only when its content changes). */
  _drawScreen(text, fg, bg, sub = '') {
    const key = `${text}|${fg}|${bg}|${sub}`;
    if (key === this._screenKey) return;
    this._screenKey = key;
    const c = this.screenCanvas.getContext('2d');
    const w = 256, h = 112;
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let size = 64;
    c.font = `${size}px "Black Ops One", Impact, sans-serif`;
    const fit = (w * 0.9) / Math.max(1, c.measureText(text).width);
    if (fit < 1) { size = Math.floor(size * fit); c.font = `${size}px "Black Ops One", Impact, sans-serif`; }
    c.fillText(text, w / 2, sub ? 46 : 58);
    if (sub) {
      c.font = '22px "VT323", monospace';
      c.fillText(sub, w / 2, 94);
    }
    c.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < h; y += 2) c.fillRect(0, y, w, 1);
    this.screenTex.needsUpdate = true;
  }

  _setSignal(mode) { this.signalMode = mode; this.signalT = 0; }

  // -------------------------------------------------------------- lifecycle

  start() {
    this.hud.prompt('Press {A} the moment the screen turns green');
    setTimeout(() => { if (this.state === 'play') this.hud.prompt(null); }, 5000);
    this._beginPause();
  }

  preview(dt) { this._animate(dt); }

  update(dt) {
    this._animate(dt);
    if (this.state !== 'play') return;
    // All round timing runs on our own counters, advanced here once per tick.
    this.phaseT += dt;
    this.playT += dt;
    if (this.playT >= CAP + 6 && this.phase !== 'done') { this._timeUp(); return; } // absolute safety net
    switch (this.phase) {
      case 'pause': if (this.phaseT >= PAUSE) this._beginWait(); break;
      case 'wait': this._stepWait(dt); break;
      case 'draw': this._stepDraw(); break;
      case 'result': this._stepResult(); break;
      default: break;
    }
    if (this.state === 'play') this._updateHud();
  }

  // ------------------------------------------------------------------ heats

  _beginPause() {
    if (this.playT >= LAST_HEAT) { this._timeUp(); return; }
    this.heat++;
    this.phase = 'pause';
    this.phaseT = 0;
    for (const s of this.seats) { s.heatState = s.alive ? 'steady' : 'idle'; s.ms = 0; s.lost = false; }
    this.hud.banner(`HEAT ${this.heat}`, 900);
    this._drawScreen(`HEAT ${this.heat}`, '#d8d2c0', '#141410', 'STAND BY');
    this._setSignal('off');
  }

  _beginWait() {
    this.phase = 'wait';
    this.phaseT = 0;
    this.waitDur = rand(WAIT_MIN, WAIT_MAX);
    this.tickT = 0.3;
    this.hud.banner('WAIT...', 0, 'danger');
    this._drawScreen('WAIT', '#ffb030', '#1a0c04');
    this._setSignal('wait');
    Audio.sfx('beep', { vol: 0.5 });
  }

  _beginDraw() {
    this.phase = 'draw';
    this.phaseT = 0;
    this.drawAt = this.time;
    this.hud.banner('DRAW!', 900, 'good');
    this._drawScreen('DRAW!', '#041004', '#39ff5a');
    this._setSignal('draw');
    Audio.sfx('go');
  }

  _stepWait(dt) {
    // Presses are checked before the switch to DRAW: a press on the very tick
    // DRAW appears was made blind and counts as a false start.
    const jumpers = this.aliveSeats.filter((s) => s.ctrl.aPressed);
    if (jumpers.length) { this._falseStart(jumpers); return; }
    this.tickT -= dt;
    if (this.tickT <= 0) { this.tickT = 0.55; Audio.sfx('tick', { vol: 0.6 }); }
    if (this.phaseT >= this.waitDur) this._beginDraw();
  }

  _stepDraw() {
    const t = this.phaseT; // seconds since DRAW (phaseT was reset when DRAW appeared)
    for (const s of this.aliveSeats) {
      if (s.heatState !== 'steady' || !s.ctrl.aPressed) continue;
      s.heatState = 'pressed';
      s.ms = Math.max(1, Math.round(t * 1000));
      s.total += t;
      if (s.best === null || t < s.best) s.best = t;
      s.pressT = 0.22;
      Audio.sfx('clank', { vol: 0.5 });
      Haptics.forPlayer(s.player, 'press');
    }
    const pending = this.aliveSeats.filter((s) => s.heatState === 'steady');
    if (!pending.length || t >= DRAW_WINDOW) this._resolveHeat(pending);
  }

  _falseStart(jumpers) {
    for (const s of jumpers) {
      s.heatState = 'false';
      s.total += DRAW_WINDOW;
      s.pressT = 0.22;
      this.hud.feed(`${s.player.name}: FALSE START`, s.player.color);
    }
    this.hud.banner('FALSE START', 1400, 'danger');
    this._drawScreen('FALSE START', '#ffffff', '#7a0e08');
    this._setSignal('fault');
    Audio.sfx('wrong');
    this._punish(jumpers);
  }

  /** Heat over: list the times, find who pays. */
  _resolveHeat(pending) {
    for (const s of pending) { s.heatState = 'slow'; s.total += DRAW_WINDOW; }
    const racers = this.aliveSeats.filter((s) => s.heatState === 'pressed').sort((a, b) => a.ms - b.ms);
    // Feed: newest line goes on top, so post slowest first.
    for (const s of pending) this.hud.feed(`${s.player.name}: TOO SLOW`, s.player.color);
    for (let i = racers.length - 1; i >= 0; i--) this.hud.feed(`${racers[i].player.name}: ${racers[i].ms} MS`, racers[i].player.color);

    let losers = [];
    if (pending.length) {
      losers = pending;
      this.hud.banner('TOO SLOW', 1400, 'danger');
      if (racers.length) this._drawScreen(`${racers[0].ms} MS`, '#39ff5a', '#041004', racers[0].player.name);
      else this._drawScreen('TOO SLOW', '#ffffff', '#7a0e08');
    } else if (racers.length) {
      const worst = racers[racers.length - 1].ms;
      if (racers.length > 1 && racers[0].ms === worst) {
        this.hud.banner('DEAD HEAT', 1400, 'good');
        this._drawScreen('DEAD HEAT', '#39ff5a', '#041004', `${worst} MS`);
      } else {
        losers = racers.filter((s) => s.ms === worst);
        this.hud.banner(`${racers[0].player.name} DRAWS FIRST`, 1400, 'good');
        this._drawScreen(`${racers[0].ms} MS`, '#39ff5a', '#041004', racers[0].player.name);
      }
    }
    this._setSignal(losers.length ? 'fault' : 'off');
    this._punish(losers);
  }

  /** Take a life from each loser; queue executions for the empty ones. */
  _punish(losers) {
    this.phase = 'result';
    this.phaseT = 0;
    this.execQueue = [];
    for (const s of losers) {
      s.lives = Math.max(0, s.lives - 1);
      s.lost = true;
      s.beeped = false;
      if (s.bulbs[s.lives]) s.bulbs[s.lives].color.setHex(UNLIT);
      this._zap(s);
      if (s.lives <= 0) { s.diedHeat = this.heat; this.execQueue.push(s); }
    }
    this.execQueue.forEach((s, i) => { s.execAt = 0.35 + i * (AIM_TIME + EXEC_GAP); });
    const execEnd = this.execQueue.length ? 0.35 + this.execQueue.length * (AIM_TIME + EXEC_GAP) + 0.6 : 0;
    this.resultEnd = Math.max(RESULT_TIME, execEnd);
  }

  _zap(s) {
    s.zapT = 0.7;
    Audio.sfx('buzz');
    Audio.sfx('snap', { vol: 0.5 });
    this.fx.sparks(s.button.getWorldPosition(new THREE.Vector3()), { color: 0x9fd8ff, count: 14, speed: 4 });
    Haptics.forPlayer(s.player, 'hit');
  }

  _stepResult() {
    for (const s of this.execQueue) {
      if (!s.alive || this.phaseT < s.execAt) continue;
      s.gun.aiming = true;
      if (!s.beeped) { s.beeped = true; Audio.sfx('beep'); }
      if (this.phaseT >= s.execAt + AIM_TIME) this._execute(s);
    }
    if (this.phaseT < this.resultEnd) return;
    if (this.aliveSeats.length <= 1) this._finish();
    else this._beginPause();
  }

  _execute(s) {
    const g = s.gun;
    g.aiming = false;
    g.laser.visible = false;
    g.recoil = 1;
    const muzzle = g.pivot.localToWorld(new THREE.Vector3(0, 0, 0.6));
    this.fx.sparks(muzzle, { count: 12, color: 0xffe08a, speed: 5 });
    this.kill(s, 'shot', { dir: new THREE.Vector3(0, 0, -1) });
  }

  _finish() {
    this.phase = 'done';
    this._setSignal('off');
    this._drawScreen('AUDIT COMPLETE', '#d8d2c0', '#141410');
    this.hud.setTimer(null);
    this.end(2.4);
  }

  _timeUp() {
    this.phase = 'done';
    this._setSignal('off');
    this._drawScreen('TIME UP', '#ffb030', '#1a0c04');
    this.hud.banner('TIME UP', 2000);
    this.hud.setTimer(0);
    Audio.sfx('horn');
    this.end(2.4);
  }

  /** Survivors: most lives, then lowest total time. Dead: later heat first, then total time. */
  placement() {
    const key = (s) => `${s.alive}|${s.lives}|${s.diedHeat}|${Math.round(s.total * 1000)}`;
    const alive = this.seats.filter((s) => s.alive).sort((a, b) => (b.lives - a.lives) || (a.total - b.total));
    const dead = this.seats.filter((s) => !s.alive).sort((a, b) => (b.diedHeat - a.diedHeat) || (a.total - b.total));
    return [...groupBy(alive, key), ...groupBy(dead, key)];
  }

  _updateHud() {
    const live = this.phase === 'wait' || this.phase === 'draw';
    for (const s of this.seats) {
      if (!s.alive) { this.hud.setStat(s, 'SHOT'); this.hud.setStatus(s, ''); continue; }
      this.hud.setStat(s, `LIVES ${s.lives}`);
      let st = '';
      if (s.heatState === 'pressed') st = `${s.ms} MS`;
      else if (s.heatState === 'false') st = 'FALSE START';
      else if (s.heatState === 'slow') st = 'TOO SLOW';
      else if (live && s.heatState === 'steady') st = 'STEADY';
      if (this.phase === 'result' && s.lost) st = 'LIFE LOST';
      this.hud.setStatus(s, st);
    }
    this.hud.setTimer(Math.max(0, CAP - this.playT));
  }

  // -------------------------------------------------------------- animation

  _animate(dt) {
    this._ambience(dt);
    const tense = this.state === 'play' && (this.phase === 'wait' || this.phase === 'draw') ? 1 : 0;
    for (const s of this.seats) {
      s.pressT = Math.max(0, s.pressT - dt);
      s.btnK = lerp(s.btnK, s.pressT > 0 ? 1 : 0, damp(30, dt));
      s.button.position.y = BTN_Y - s.btnK * 0.05;
      this._animateGun(s, dt);
      if (!s.alive) continue;
      const sub = s.subject, p = sub.parts;
      sub.animate(dt, 0);
      s.tenseK = lerp(s.tenseK, tense, damp(6, dt));
      const target = s.pressT > 0 ? ARM_SLAM : lerp(ARM_REST, ARM_POISED, s.tenseK);
      s.armK = lerp(s.armK, target, damp(s.pressT > 0 ? 40 : 10, dt));
      p.armR.rotation.x = s.armK;
      p.torso.rotation.x = 0.04 + s.tenseK * 0.12;
      if (s.zapT > 0) {
        s.zapT -= dt;
        sub.root.rotation.z = s.zapT > 0 ? Math.sin(this.clock * 50) * 0.12 : 0;
        p.armL.rotation.x = -2.2;
        p.head.rotation.x = Math.sin(this.clock * 37) * 0.3;
      } else if (s.gun.aiming) {
        p.armL.rotation.x = -2.5; // futile shielding
        p.armL.rotation.z = 0.4;
        p.torso.rotation.x = 0.3;
      }
    }
  }

  /** Guns idly sweep over the heads; the doomed get the laser, then the bullet. */
  _animateGun(s, dt) {
    const g = s.gun, v = this._v;
    g.recoil = Math.max(0, g.recoil - dt * 4);
    g.barrel.position.z = 0.36 - g.recoil * 0.15;
    if (s.alive) {
      s.subject.parts.head.getWorldPosition(v);
      if (!g.aiming) { v.x += Math.sin(this.clock * 0.7 + s.player.slot * 1.7) * 0.6; v.y -= 0.4; }
    } else {
      v.set(g.group.position.x, 0.5, g.group.position.z + 1.5);
      g.aiming = false;
    }
    g.aim.lookAt(v);
    g.pivot.quaternion.slerp(g.aim.quaternion, g.aiming ? 1 : damp(6, dt));
    g.laser.visible = g.aiming && s.alive;
    if (g.laser.visible) {
      const from = g.group.position;
      g.laser.scale.z = Math.max(0.1, Math.hypot(v.x - from.x, v.y - from.y, v.z - from.z) - 0.1);
    }
    g.eyeMat.color.setHex(g.aiming ? 0xff2020 : 0x440000);
  }

  /** Signal lamps + coloured flood light (cosmetic). */
  _ambience(dt) {
    this.signalT += dt;
    let col = 0x1c1c1a, li = 0, lc = 0xff2010;
    switch (this.signalMode) {
      case 'wait': col = 0xff2a10; li = 3 + Math.sin(this.signalT * 6) * 0.8; lc = 0xff2a10; break;
      case 'draw': col = 0x39ff5a; li = 6 + 14 * Math.exp(-this.signalT * 4); lc = 0x39ff5a; break;
      case 'fault': {
        const on = (this.signalT * 8) % 1 < 0.5;
        col = on ? 0xff2a10 : 0x2a0806; li = on ? 8 : 0; lc = 0xff2010;
        break;
      }
      default: break;
    }
    this.lampMat.color.setHex(col);
    this.signal.intensity = li;
    this.signal.color.setHex(lc);
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    void dt;
    const b = seat.brain, m = b.memory;
    if (m.heat !== this.heat) {
      // Plan this heat: reaction time (better bots faster) and a rare jump start.
      m.heat = this.heat;
      const d = b.difficulty;
      const personal = b.reaction - (0.35 - d * 0.25); // ±0.05 per-bot temperament
      let r = 0.44 - 0.2 * d + personal + (random() + random() - 1) * 0.08 * (1.2 - d);
      if (random() < b.error * 0.3) r += rand(0.12, 0.45); // blinked
      m.react = Math.max(0.15, r);
      m.jumpFrac = random() < 0.012 + 0.06 * (1 - d) ? rand(0.3, 0.9) : null;
    }
    // Hold A from the planned moment until the game has registered the press
    // (heatState leaves 'steady'), then release. Written in tick N, the edge
    // shows up as ctrl.aPressed in tick N+1; holding also survives any missed
    // commit. Released at all other times so the next press is a fresh edge.
    const steady = seat.heatState === 'steady';
    let press = false;
    if (steady && this.phase === 'wait' && m.jumpFrac !== null && this.phaseT >= this.waitDur * m.jumpFrac) press = true;
    else if (steady && this.phase === 'draw' && this.phaseT >= m.react) press = true;
    seat.ctrl.setButtons(press, false);
  }
}
