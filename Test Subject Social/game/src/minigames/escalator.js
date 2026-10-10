/**
 * DOWN ESCALATOR — climb a down-running escalator one correct arrow at a time.
 *
 * Rules
 *  - Every subject has their own steep escalator lane that runs DOWN into a
 *    toothed crusher. Everyone starts halfway up (step 20 of 40).
 *  - The CRT above each lane shows the next required direction (big) and the
 *    two after it (small). The correct direction climbs one step.
 *  - A wrong direction is a stumble: −2 steps and a 0.4 s stun.
 *  - The drag speeds up over time; after 45 s it goes into overdrive.
 *  - Reach the top to escape (finish order is recorded). Reach the bottom
 *    and the crusher has you.
 *  - Placement: escapees in order, then anyone still on (by height), then
 *    the dead (last to die places highest).
 */
import * as THREE from 'three';
import { Minigame, groupBy } from './base.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, block, stencil, hazardStrip, mesh, monitor } from '../core/environment.js';
import { Tex, mat, canvasTexture, textTexture } from '../core/textures.js';
import { rand, pick, clamp, lerp, damp } from '../core/util.js';

const TOP = 40;                 // steps to escape
const START = 20;               // everyone starts in the middle
const ANGLE = 0.6;              // incline (radians, ≈34°)
const LEN = 12;                 // visual incline length (world units)
const Y0 = 0.5, Z0 = 3;         // bottom of the incline
const STEP_COUNT = 34;          // visible steps per lane
const STEP_W = 1.3;
const STUN = 0.4;
const OVERDRIVE = 45;           // seconds until the drag ramps hard
const HARD_CAP = 75;            // absolute safety end
const DIRS = ['up', 'down', 'left', 'right'];
const SIN = Math.sin(ANGLE), COS = Math.cos(ANGLE);

/** Drag rate in steps per second at round time t. */
const dragAt = (t) => 0.9 + 0.035 * t + (t > OVERDRIVE ? 0.5 * (t - OVERDRIVE) : 0);

export class DownEscalator extends Minigame {
  static meta = {
    id: 'escalator',
    title: 'DOWN ESCALATOR',
    tagline: 'The only way out is up. The machine disagrees.',
    category: 'Reflex',
    controls: [{ input: 'move', label: 'Press the shown arrow' }],
    objective: 'Climb to the top of your down-running escalator before it feeds you to the crusher.',
    rules: [
      'Press the direction on your monitor to climb one step.',
      'Wrong direction: you stumble down two steps.',
      'The escalator keeps speeding up. The bottom has teeth.',
      'First to the top places highest.',
    ],
  };

  build() {
    const n = this.seats.length;
    this.spacing = n <= 2 ? 4.0 : n === 3 ? 3.1 : 2.6;
    const width = n * this.spacing;
    const scene = this.makeScene({ fogNear: 20, fogFar: 55, ambientIntensity: 1.0 });
    const camZ = 12.5 + Math.max(0, width - 10.4) * 0.6;
    this.makeCamera([0, 4.0, camZ + 1.2], [0, 3.5, -2], 50);
    const fill = new THREE.DirectionalLight(0xcfd4d8, 0.8);
    fill.position.set(0, 5, 14);
    scene.add(fill);

    this._buildShaft(width);
    this.stepGeo = new THREE.BoxGeometry(STEP_W, (LEN / STEP_COUNT) * SIN + 0.15, (LEN / STEP_COUNT) * COS + 0.01);
    this.stepMat = mat(0xffffff, stepTex());
    this.toothGeo = new THREE.BoxGeometry(STEP_W + 0.2, 0.16, 0.16);
    this.lanes = this.seats.map((seat, i) => this._buildLane(seat, (i - (n - 1) / 2) * this.spacing));

    this.seq = [];
    this.phase = 0;               // shared step scroll offset
    this.finishOrder = [];
    this.overdriveAnnounced = false;
  }

  // ------------------------------------------------------------------ stage

  _buildShaft(width) {
    const scene = this.scene;
    floor(scene, width + 20, 30, { tex: 'concrete', tile: 3, z: 0 });
    const topY = Y0 + LEN * SIN, topZ = Z0 - LEN * COS;
    this.topY = topY; this.topZ = topZ;
    // Back wall and upper landing.
    block(scene, 0, 8, topZ - 3.4, width + 20, 16, 0.4, mat(0xffffff, Tex.wall([(width + 20) / 4, 4])));
    block(scene, 0, topY / 2, topZ - 1.6, width + 3, topY, 3.2, mat(0x2e2f2c, Tex.plate([4, 2])));
    const landing = mesh(new THREE.PlaneGeometry(width + 3, 3.2), mat(0xffffff, Tex.plate([(width + 3) / 1.5, 2])), 0, topY + 0.01, topZ - 1.6, { cast: false });
    landing.rotation.x = -Math.PI / 2; scene.add(landing);
    stencil(scene, 'KEEP CLIMBING', 0, topY + 4.9, topZ - 3.15, { w: 8, h: 2.4, opacity: 0.55 });
    // Glowing EXIT sign.
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: textTexture('EXIT', { w: 128, h: 48, size: 40, color: '#47ff6a', bg: '#06200a', grimy: false }) }));
    exit.position.set(0, topY + 2.6, topZ - 3.1); scene.add(exit);
    const exitLight = new THREE.PointLight(0x47ff6a, 4, 6, 1.5);
    exitLight.position.set(0, topY + 2.4, topZ - 2.4); scene.add(exitLight);
    // Crusher pit housing across all lanes.
    block(scene, 0, 0.06, Z0 + 1.5, width + 1, 0.12, 0.15, mat(0x2a2a27, Tex.metal()));
    const pit = mesh(new THREE.PlaneGeometry(width + 1, 1.4), new THREE.MeshBasicMaterial({ color: 0x1a0503 }), 0, 0.005, Z0 + 0.8, { cast: false });
    pit.rotation.x = -Math.PI / 2; scene.add(pit);
    hazardStrip(scene, 0, Z0 + 2.0, width + 1, 0.6, 0.012);
    stencil(scene, 'MIND THE TEETH', 0, 0.02, Z0 + 2.9, { w: 5, h: 1.2, opacity: 0.4 }).rotation.x = -Math.PI / 2;
    this.pitLight = new THREE.PointLight(0xff2a1a, 5, 6, 1.4);
    this.pitLight.position.set(0, 0.3, Z0 + 1.3);
    scene.add(this.pitLight);
    // Overhead lamps along the incline.
    hangingLamp(scene, -width / 4, 10.5, -1.5, { intensity: 70, angle: 0.9, target: new THREE.Vector3(-width / 4, 3, -1.5) });
    hangingLamp(scene, width / 4, 10.5, -1.5, { intensity: 70, angle: 0.9, target: new THREE.Vector3(width / 4, 3, -1.5) });
  }

  /** One escalator: truss, balustrades, rails, moving steps, crusher, CRT. */
  _buildLane(seat, x) {
    const scene = this.scene;
    const color = new THREE.Color(seat.player.color);
    const lane = { seat, x, steps: [], rollers: [] };
    seat.lane = lane;
    Object.assign(seat, { p: START, dispP: START, idx: 0, stun: 0, streak: 0, missteps: 0, finished: false, dying: 0, climbT: 0, flash: 0, okFlash: 0, walkOff: 0 });

    const inclined = (geo, material, s, up = 0, dx = 0) => {
      const m = mesh(geo, material, x + dx, Y0 + s * SIN + up * COS, Z0 - s * COS + up * SIN);
      m.rotation.x = ANGLE;
      scene.add(m);
      return m;
    };
    // Truss under the steps.
    inclined(new THREE.BoxGeometry(STEP_W + 0.1, 0.7, LEN + 0.6), mat(0x262624, Tex.metal()), LEN / 2, -0.5);
    // Balustrades + handrails + coloured skirt lights.
    const balMat = mat(0x5d605b, Tex.plate([1, 6]));
    const railMat = mat(0x151515);
    lane.skirtMat = new THREE.MeshBasicMaterial({ color });
    for (const side of [-1, 1]) {
      const dx = side * (STEP_W / 2 + 0.09);
      inclined(new THREE.BoxGeometry(0.14, 1.0, LEN + 0.4), balMat, LEN / 2, 0.45, dx);
      inclined(new THREE.BoxGeometry(0.2, 0.09, LEN + 0.6), railMat, LEN / 2, 1.0, dx);
      inclined(new THREE.BoxGeometry(0.03, 0.04, LEN), lane.skirtMat, LEN / 2, 0.05, side * (STEP_W / 2 + 0.01));
    }
    // Moving steps.
    for (let i = 0; i < STEP_COUNT; i++) {
      const st = mesh(this.stepGeo, this.stepMat);
      scene.add(st);
      lane.steps.push(st);
    }
    // Crusher: two counter-rotating toothed rollers.
    const rollMat = mat(0x7a7c78, Tex.metal());
    const toothMat = mat(0xd8d4c8, Tex.metal(), { emissive: 0x3a0800 });
    for (const [rz, dir] of [[Z0 + 0.55, 1], [Z0 + 1.05, -1]]) {
      const g = new THREE.Group();
      const core = mesh(new THREE.CylinderGeometry(0.26, 0.26, STEP_W + 0.2, 10), rollMat);
      core.rotation.z = Math.PI / 2; g.add(core);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const t = mesh(this.toothGeo, toothMat, 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
        t.rotation.x = a; g.add(t);
      }
      g.position.set(x, 0.32, rz);
      scene.add(g);
      lane.rollers.push({ g, dir });
    }
    // Comb plate where steps vanish.
    block(scene, x, Y0 - 0.02, Z0 + 0.12, STEP_W + 0.3, 0.12, 0.32, mat(0xb09a3a, Tex.metal()));
    // Monitor above the top of the lane.
    lane.crt = monitor(scene, x, this.topY + 3.25, this.topZ - 0.6, { w: Math.min(1.9, this.spacing * 0.72), h: Math.min(1.4, this.spacing * 0.53), rotX: 0.22 });
    lane.drawKey = '';
    lane.drawT = 0;

    this.spawnSubject(seat, { x, y: Y0, z: Z0, facing: Math.PI });
    this._placeSubject(seat, 1);
    return lane;
  }

  /** Arrow at sequence index i (extended lazily, shared by everyone for fairness). */
  arrow(i) {
    while (this.seq.length <= i) {
      const n = this.seq.length;
      let d = pick(DIRS);
      if (n >= 2 && this.seq[n - 1] === d && this.seq[n - 2] === d) d = pick(DIRS.filter((x) => x !== d));
      this.seq.push(d);
    }
    return this.seq[i];
  }

  // -------------------------------------------------------------- animation

  _scrollSteps(dt, rate) {
    const d = LEN / STEP_COUNT;
    this.phase = ((this.phase - rate * (LEN / TOP) * dt) % d + d) % d;
    for (const lane of this.lanes) {
      lane.steps.forEach((st, i) => {
        const s = i * d + this.phase;
        const topY = Y0 + (s + d) * SIN;
        st.position.set(lane.x, topY - this.stepGeo.parameters.height / 2, Z0 - (s + d / 2) * COS);
      });
      for (const r of lane.rollers) r.g.rotation.x += r.dir * dt * (3 + rate * 2);
    }
    this.pitLight.intensity = 4 + Math.sin(this.engine.time * 9) * 1.5;
  }

  /** Put a subject on the incline at its displayed height. */
  _placeSubject(seat, k) {
    const s = seat.subject;
    seat.dispP = lerp(seat.dispP, seat.p, k);
    const along = clamp(seat.dispP / TOP, 0, 1) * LEN + seat.walkOff;
    const onLanding = along > LEN;
    const y = onLanding ? this.topY : Y0 + along * SIN + 0.05;
    s.root.position.set(seat.lane.x, y, Z0 - along * COS);
  }

  _animateSubjects(dt) {
    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const s = seat.subject, p = s.parts;
      if (seat.dying > 0) continue;
      seat.climbT = Math.max(0, seat.climbT - dt);
      if (seat.finished) {
        if (seat.walkOff < 1.3) { seat.walkOff = Math.min(1.3, seat.walkOff + dt * 2.5); s.animate(dt, 3); }
        else { s.faceAngle(0, dt, 6); s.pose = 'armsUp'; s.animate(dt, 0); }
        this._placeSubject(seat, 1);
        continue;
      }
      s.animate(dt, seat.climbT > 0 ? 6 : 0);
      if (seat.stun > 0) {
        p.torso.rotation.x = -0.35;
        p.armL.rotation.x = -2.4 + Math.sin(this.engine.time * 40) * 0.5;
        p.armR.rotation.x = -2.4 - Math.sin(this.engine.time * 40) * 0.5;
      } else if (seat.climbT <= 0) {
        // Hands on the rails.
        p.armL.rotation.z = lerp(p.armL.rotation.z, 0.35, damp(10, dt));
        p.armR.rotation.z = lerp(p.armR.rotation.z, -0.35, damp(10, dt));
      }
      this._placeSubject(seat, damp(16, dt));
    }
  }

  /** Redraw a lane monitor (throttled; immediate on events). */
  _drawMonitor(lane, dt, force = false) {
    const seat = lane.seat;
    lane.drawT -= dt;
    const flash = seat.flash > 0, ok = seat.okFlash > 0;
    const key = `${seat.idx}|${flash}|${ok}|${seat.finished}|${seat.alive}|${seat.stun > 0}`;
    if (!force && key === lane.drawKey && lane.drawT > 0) return;
    lane.drawKey = key; lane.drawT = 0.08;
    const col = seat.player.color;
    lane.crt.draw((c, w, h) => {
      if (flash) { c.fillStyle = '#3a0505'; c.fillRect(0, 0, w, h); }
      c.strokeStyle = col; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = col; c.font = '12px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(`P${seat.player.slot + 1}`, 7, 6);
      if (!seat.alive) { drawGlyphX(c, w / 2, h / 2, 26, '#ff3a2a'); return; }
      if (seat.finished) {
        c.fillStyle = '#47ff6a'; c.font = 'bold 22px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('EXIT', w / 2 - 6, h / 2 - 8);
        c.font = '14px monospace'; c.fillText(`#${this.finishOrder.indexOf(seat) + 1}`, w / 2 - 6, h / 2 + 14);
      } else {
        const main = flash ? '#ff4a3a' : ok ? '#c8ffd0' : '#47ff6a';
        drawArrow(c, this.arrow(seat.idx), 50, 52, 30, main);
        drawArrow(c, this.arrow(seat.idx + 1), 100, 32, 11, 'rgba(71,255,106,0.6)');
        drawArrow(c, this.arrow(seat.idx + 2), 100, 66, 9, 'rgba(71,255,106,0.35)');
      }
      // Height gauge.
      const frac = clamp(seat.p / TOP, 0, 1);
      c.fillStyle = '#0d2a10'; c.fillRect(w - 12, 10, 5, h - 20);
      c.fillStyle = frac < 0.2 ? '#ff4a3a' : '#47ff6a';
      const gh = (h - 20) * frac; c.fillRect(w - 12, 10 + (h - 20) - gh, 5, gh);
    });
  }

  // ------------------------------------------------------------------ flow

  preview(dt) {
    this._scrollSteps(dt, dragAt(0));
    this._animateSubjects(dt);
    for (const lane of this.lanes) this._drawMonitor(lane, dt);
  }

  update(dt) {
    const playing = this.state === 'play';
    const rate = playing ? dragAt(this.time) : dragAt(Math.min(this.time, OVERDRIVE)) * 0.5;
    this._scrollSteps(dt, rate);

    if (playing) {
      for (const seat of this.seats) this._updateSeat(seat, dt, rate);
      if (!this.overdriveAnnounced && this.time >= OVERDRIVE) {
        this.overdriveAnnounced = true;
        this.hud.banner('OVERDRIVE', 1500, 'danger');
        Audio.sfx('horn');
      }
      this.hud.setTimer(Math.max(0, OVERDRIVE - this.time));
      const active = this.seats.filter((s) => s.alive && !s.finished);
      if (active.length === 0 || this.time >= HARD_CAP) this.end(2.4);
    }
    this._animateSubjects(dt);
    for (const lane of this.lanes) this._drawMonitor(lane, dt);
    for (const seat of this.seats) {
      const stat = !seat.alive ? 'MULCHED' : seat.finished ? `ESCAPED #${this.finishOrder.indexOf(seat) + 1}` : `STEP ${Math.max(0, Math.floor(seat.p))}/${TOP} · x${seat.streak}`;
      this.hud.setStat(seat, stat);
      this.hud.setStatus(seat, seat.alive && !seat.finished && seat.stun > 0 ? 'STUMBLE!' : '');
    }
  }

  _updateSeat(seat, dt, rate) {
    if (!seat.alive) return;
    seat.flash = Math.max(0, seat.flash - dt);
    seat.okFlash = Math.max(0, seat.okFlash - dt);
    if (seat.finished) return;
    if (seat.dying > 0) { this._updateDying(seat, dt); return; }

    seat.stun = Math.max(0, seat.stun - dt);
    const dir = seat.ctrl.dirPressed;
    if (dir && seat.stun <= 0) {
      if (dir === this.arrow(seat.idx)) {
        seat.p += 1; seat.idx++; seat.streak++;
        seat.climbT = 0.2; seat.okFlash = 0.08;
        Audio.sfx('step', { vol: 1.4 });
        if (seat.streak % 10 === 0) Audio.sfx('tick');
      } else {
        seat.p -= 2; seat.stun = STUN; seat.streak = 0; seat.missteps++;
        seat.flash = 0.4;
        Audio.sfx('wrong', { vol: 0.7 });
      }
      this._drawMonitor(seat.lane, 0, true);
    }
    seat.p -= rate * dt;

    if (seat.p >= TOP) {
      seat.p = TOP; seat.finished = true;
      this.finishOrder.push(seat);
      if (seat.missteps === 0) this.award(seat, 'expressLane');
      Audio.sfx('ding');
      this.hud.feed(`${seat.player.name} — ESCAPED #${this.finishOrder.length}`, seat.player.color);
      this._drawMonitor(seat.lane, 0, true);
    } else if (seat.p <= 0) {
      seat.p = 0; seat.dying = 0.45;
      seat.dyingFrom = seat.subject.root.position.clone();
      Audio.sfx('grind');
    }
  }

  /** Dragged through the comb into the rollers, then mulched. */
  _updateDying(seat, dt) {
    seat.dying -= dt;
    const k = 1 - Math.max(0, seat.dying) / 0.45;
    const root = seat.subject.root;
    root.position.lerpVectors(seat.dyingFrom, new THREE.Vector3(seat.lane.x, -0.4, Z0 + 0.8), k * k);
    root.rotation.x = -0.9 * k;
    seat.subject.pose = 'armsUp';
    seat.subject.animate(dt, 0);
    if (Math.random() < 0.5) this.fx.sparks(new THREE.Vector3(seat.lane.x + rand(-0.5, 0.5), 0.5, Z0 + 0.8), { count: 3 });
    if (seat.dying <= 0) {
      this.kill(seat, 'gib', { dir: new THREE.Vector3(0, 0, 1), force: 1.1 });
      this.fx.sparks(new THREE.Vector3(seat.lane.x, 0.5, Z0 + 0.8), { count: 20, speed: 8 });
      Audio.sfx('crunch');
      this.engine.shake(0.4);
      this._drawMonitor(seat.lane, 0, true);
    }
  }

  /** Escapees in order, survivors by height, then the dead (last death highest). */
  placement() {
    const fin = this.finishOrder.map((s) => [s]);
    const on = this.seats.filter((s) => s.alive && !s.finished).sort((a, b) => b.p - a.p);
    const onTiers = groupBy(on, (s) => Math.floor(s.p));
    const dead = this.deaths.slice().reverse().map((s) => [s]);
    return [...fin, ...onTiers, ...dead];
  }

  // ------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const b = seat.brain, m = b.memory;
    void dt;
    if (seat.finished || seat.dying > 0 || seat.stun > 0) { m.next = this.time + b.reaction; return; }
    if (m.next === undefined) m.next = this.time + b.reaction + rand(0, 0.2);
    if (this.time < m.next) return;
    const interval = lerp(0.6, 0.28, b.difficulty);
    m.next = this.time + interval * rand(0.85, 1.2);
    const want = this.arrow(seat.idx);
    const slip = Math.random() < b.error * 0.5;
    seat.ctrl.tapDir(slip ? pick(DIRS.filter((d) => d !== want)) : want);
  }

  dispose() {
    this.stepGeo.dispose();
    this.toothGeo.dispose();
    this.stepMat.dispose();
    super.dispose();
  }
}

// ======================================================================
// Procedural assets
// ======================================================================

/** Grooved aluminium step with a yellow safety edge (cached). */
function stepTex() {
  return canvasTexture('esc-step', 32, (c, s) => {
    c.fillStyle = '#6f726e'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#3c3e3b';
    for (let x = 1; x < s; x += 3) c.fillRect(x, 0, 1, s);
    c.fillStyle = '#c9a227'; c.fillRect(0, 0, s, 4); c.fillRect(0, 0, 3, s); c.fillRect(s - 3, 0, 3, s);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 20; i++) c.fillRect(Math.random() * s, Math.random() * s, 2, 1);
  });
}

/** Chunky arrow glyph pointing in `dir`. */
function drawArrow(c, dir, cx, cy, r, color) {
  const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir];
  c.save();
  c.translate(cx, cy); c.rotate(rot);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, -r);
  c.lineTo(r * 0.9, -r * 0.05);
  c.lineTo(r * 0.38, -r * 0.05);
  c.lineTo(r * 0.38, r);
  c.lineTo(-r * 0.38, r);
  c.lineTo(-r * 0.38, -r * 0.05);
  c.lineTo(-r * 0.9, -r * 0.05);
  c.closePath();
  c.fill();
  c.restore();
}

function drawGlyphX(c, cx, cy, r, color) {
  c.strokeStyle = color; c.lineWidth = 7;
  c.beginPath(); c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r); c.stroke();
}
