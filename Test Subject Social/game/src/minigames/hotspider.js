/**
 * HOT SPIDER — a clockwork spider bomb clings to somebody's spine. Pass it on
 * before the fuse runs out.
 *
 * Rules
 *  - Circular grated pit with a furnace glowing underneath.
 *  - A mechanical spider drops onto a random subject's back. Its fuse is a
 *    hidden 8–14 s; the red eye blinks faster as it burns down and digits
 *    appear for the final 3 seconds.
 *  - The carrier presses A to THROW it (arc, facing direction). It latches
 *    onto the first subject it hits; on a miss it lands and scuttles after
 *    the nearest subject. A thrower is immune for 1 s after letting go.
 *  - The carrier moves 10% faster. B shoves.
 *  - Fuse out: the carrier's spine is folded the wrong way ('snap') plus a
 *    small blast. A spider that pops on the floor gibs anyone within reach.
 *    A fresh spider drops 2 s later. Last subject alive wins.
 *  - After 75 s the fuses shorten so the round always resolves.
 */
import * as THREE from 'three';
import { Minigame } from './base.js';
import { Arena, ArenaActor } from '../core/physics.js';
import { Audio } from '../core/audio.js';
import { hangingLamp } from '../core/engine.js';
import { floor, mesh, pipe, stencil } from '../core/environment.js';
import { Tex, mat, glow } from '../core/textures.js';
import { steerTo, nearest, wander } from '../core/ai.js';
import { angleDiff } from '../core/util.js';
import { rand, pick, random } from '../core/rng.js';

const R = 7.5;               // arena radius
const THROW_SPEED = 12;      // horizontal throw speed
const THROW_UP = 3.5;        // initial vertical speed of a throw
const GRAVITY = 20;
const SCUTTLE_SPEED = 3.8;
const POUNCE_RANGE = 2.6;    // a loose spider leaps at anyone this close
const LATCH_DIST = 0.7;
const IMMUNE_TIME = 1;
const BLAST_R = 2.2;         // floor detonation kill radius
const LOOSE_BURN = 0.75;     // fuse burns slower while the spider is loose

export class HotSpider extends Minigame {
  static meta = {
    id: 'hotspider',
    title: 'HOT SPIDER',
    tagline: 'It only wants a hug. A very short, very final hug.',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }, { input: 'a', label: 'Throw spider' }, { input: 'b', label: 'Shove' }],
    objective: 'Do not be wearing the spider when its fuse runs out.',
    rules: [
      'The spider clings to your back. Press {A} to throw it at someone.',
      'Missed throws land — the spider then hunts the nearest subject.',
      'The red eye blinks faster as the hidden fuse burns down.',
      'Whoever wears it at zero gets folded in half.',
    ],
  };

  build() {
    const scene = this.makeScene({ fogNear: 20, fogFar: 52 });
    this.fx.reserveFlash(); // explosions reuse one light (no shader recompiles)
    this.makeCamera([0, 16.5, 12.2], [0, 0, 0.4], 48);

    // --- the pit: furnace glow beneath a see-through grate
    floor(scene, 60, 40, { tex: 'concrete', tile: 3, y: -1.2 });
    const furnace = mesh(new THREE.CircleGeometry(R + 0.4, 28), glow(0x6a2408), 0, -0.7, 0, { cast: false });
    furnace.rotation.x = -Math.PI / 2;
    scene.add(furnace);
    const heat = new THREE.PointLight(0xff6a20, 25, 14, 1.4);
    heat.position.set(0, -0.3, 0);
    scene.add(heat);
    this.heat = heat;
    const grate = mesh(new THREE.CircleGeometry(R + 0.4, 32), new THREE.MeshLambertMaterial({ map: grateTexture(R), alphaTest: 0.5, side: THREE.DoubleSide }), 0, 0, 0, { cast: false });
    grate.rotation.x = -Math.PI / 2;
    scene.add(grate);
    // Rim, hazard band, railing posts
    const rimMat = mat(0xffffff, Tex.rust([6, 1]));
    const rim = mesh(new THREE.CylinderGeometry(R + 0.9, R + 0.9, 1.4, 32, 1, true), mat(0x6b6158, Tex.plate([8, 1]), { side: THREE.DoubleSide }), 0, -0.6, 0);
    scene.add(rim);
    const band = mesh(new THREE.RingGeometry(R - 0.35, R + 0.4, 40), mat(0xffffff, Tex.hazard([12, 1])), 0, 0.015, 0, { cast: false });
    band.rotation.x = -Math.PI / 2;
    scene.add(band);
    const rail = mesh(new THREE.TorusGeometry(R + 0.55, 0.06, 4, 40), rimMat, 0, 1.0, 0);
    rail.rotation.x = Math.PI / 2;
    scene.add(rail);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      scene.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5), rimMat, Math.cos(a) * (R + 0.55), 0.5, Math.sin(a) * (R + 0.55)));
    }
    pipe(scene, [-14, 4.5, -9], [14, 4.5, -9], 0.25);
    pipe(scene, [-14, 3.6, -9.3], [14, 3.6, -9.3], 0.12, 0x5a3022);
    stencil(scene, 'DO NOT FEED', 0, 2.2, -9.6, { w: 6, h: 1.8, opacity: 0.5 });
    const back = mesh(new THREE.PlaneGeometry(40, 10), mat(0xffffff, Tex.wall([10, 2.5])), 0, 3.8, -9.8);
    scene.add(back);

    hangingLamp(scene, 0, 9, 0, { intensity: 120, angle: 0.85 });
    hangingLamp(scene, -6, 8, -2, { intensity: 50, angle: 0.8, shadow: false });
    hangingLamp(scene, 6, 8, -2, { intensity: 50, angle: 0.8, shadow: false });

    // --- arena + avatars
    this.arena = new Arena({ bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R }, shoveForce: 12 });
    this.seats.forEach((seat, i) => {
      const a = (i / this.seats.length) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 3.6, z = Math.sin(a) * 3.6;
      this.spawnSubject(seat, { x, z });
      seat.actor = this.arena.add(new ArenaActor({ player: seat.player, ctrl: seat.ctrl, subject: seat.subject, x, z }));
      seat.actor.seat = seat;
      seat.actor.data.immuneUntil = 0;
    });

    this._buildSpider(scene);
    this.respawnT = 1.2;
  }

  /** Low-poly clockwork spider: shell, eye, eight two-segment legs, countdown sprite. */
  _buildSpider(scene) {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.scale.setScalar(1.45);
    const shell = mat(0x9aa09c, Tex.metal());
    const dark = mat(0x1b1c1b);
    const body = mesh(new THREE.SphereGeometry(0.28, 7, 5), shell, 0, 0.24, -0.05);
    body.scale.set(1, 0.6, 1.25);
    const head = mesh(new THREE.BoxGeometry(0.24, 0.15, 0.2), shell, 0, 0.22, 0.3);
    const band = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.12), mat(0xb5741f, Tex.rust()), 0, 0.3, -0.02);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a10 });
    const eye = mesh(new THREE.SphereGeometry(0.075, 6, 4), eyeMat, 0, 0.42, 0.05, { cast: false });
    const fangs = [-0.06, 0.06].map((x) => { const f = mesh(new THREE.ConeGeometry(0.025, 0.12, 4), dark, x, 0.13, 0.4); f.rotation.x = Math.PI; return f; });
    g.add(body, head, band, eye, ...fangs);
    const legs = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.18, 0.24, 0.18 - i * 0.13);
        hip.rotation.y = side * (-0.7 + i * 0.45) * -1;
        const upper = mesh(new THREE.BoxGeometry(0.34, 0.045, 0.045), dark, side * 0.15, 0.09, 0);
        upper.rotation.z = side * 0.6;
        const lower = mesh(new THREE.BoxGeometry(0.045, 0.44, 0.045), dark, side * 0.36, -0.02, 0);
        lower.rotation.z = side * 0.35;
        hip.add(upper, lower);
        g.add(hip);
        legs.push({ hip, side, i, baseY: hip.rotation.y });
      }
    }
    const light = new THREE.PointLight(0xff2010, 0, 3.5, 1.5);
    light.position.set(0, 0.6, 0);
    g.add(light);
    g.visible = false;
    scene.add(g);

    // Countdown digits (last 3 seconds only).
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.setScalar(1.1);
    sprite.renderOrder = 10;
    sprite.visible = false;
    scene.add(sprite);

    this.spider = {
      g, legs, eyeMat, light, sprite, canvas, tex, shownDigit: null,
      state: 'none', pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0,
      carrier: null, thrower: null, attachedT: 0, fuse: 0, fuseMax: 1, blink: 0, blinkOn: false, legPhase: 0,
      dropT: 0, dropTarget: null, pounceCd: 0,
    };
  }

  start() {
    this.respawnT = 1.0;
    this.spider.g.visible = false;
    this.hud.banner('CATCH!', 900);
  }

  preview(dt) {
    for (const s of this.seats) s.subject.animate(dt, 0);
    // A demo spider idles in the middle of the pit.
    const sp = this.spider;
    sp.g.visible = true;
    sp.g.position.set(0, 0, 0);
    sp.heading += dt * 0.6;
    sp.g.rotation.set(0, sp.heading, 0);
    this._animateSpider(dt, 1.5, 0.5);
  }

  // ------------------------------------------------------------------ spider

  /** Drop a fresh spider from the ceiling onto a random survivor. */
  _spawnSpider() {
    const alive = this.aliveSeats;
    if (alive.length < 2) return;
    const sp = this.spider;
    sp.state = 'drop';
    sp.dropT = 0;
    sp.dropTarget = pick(alive);
    sp.fuseMax = sp.fuse = this.time > 75 ? rand(3.5, 5.5) : rand(8, 14);
    sp.blink = 0;
    sp.g.visible = true;
    Audio.sfx('spider');
    this.hud.banner('INCOMING', 900, 'danger');
  }

  /** Clamp the spider onto `seat`'s back. */
  _latch(seat) {
    const sp = this.spider;
    if (sp.carrier && sp.carrier.actor) sp.carrier.actor.speedMul = 1;
    sp.carrier = seat;
    sp.state = 'attached';
    sp.attachedT = 0;
    seat.actor.speedMul = 1.1;
    Audio.sfx('spider');
    Audio.sfx('clank', { vol: 0.4 });
    this.hud.feed(`${seat.player.name} is wearing the spider`, seat.player.color);
  }

  /** Carrier lets go: the spider leaves in an arc along their facing. */
  _throw(seat) {
    const sp = this.spider, a = seat.actor;
    const f = a.forward;
    if (sp.fuse < 1) { this.award(seat, 'buzzerBeater'); this.hud.feed(`${seat.player.name} — buzzer beater!`, seat.player.color); }
    a.speedMul = 1;
    a.data.immuneUntil = this.time + IMMUNE_TIME;
    a.subject.push();
    sp.carrier = null;
    sp.thrower = seat;
    sp.state = 'flying';
    sp.pos.set(a.pos.x + f.x * 0.6, 1.4, a.pos.z + f.z * 0.6);
    sp.vel.set(f.x * THROW_SPEED, THROW_UP, f.z * THROW_SPEED);
    sp.heading = a.facing;
    Audio.sfx('whoosh');
  }

  /** Fuse reached zero: snap the carrier or blast whoever is near the floor bomb. */
  _detonate() {
    const sp = this.spider;
    const at = sp.g.position.clone();
    this.fx.explosion(at, 0.55);
    Audio.sfx('explode', { vol: 0.7 });
    this.engine.shake(0.6);
    if (sp.state === 'attached' && sp.carrier) {
      const victim = sp.carrier;
      victim.actor.speedMul = 1;
      this.kill(victim, 'snap');
    } else {
      for (const seat of this.aliveSeats) {
        const d = Math.hypot(seat.actor.pos.x - at.x, seat.actor.pos.z - at.z);
        if (d < BLAST_R) this.kill(seat, 'gib', { dir: new THREE.Vector3(seat.actor.pos.x - at.x, 0, seat.actor.pos.z - at.z) });
      }
    }
    // Blast wave shoves everyone nearby.
    for (const seat of this.aliveSeats) {
      const a = seat.actor;
      const dx = a.pos.x - at.x, dz = a.pos.z - at.z, d = Math.hypot(dx, dz);
      if (d < 2.8 && d > 0.01) { a.knock.x += (dx / d) * 9 * (1 - d / 2.8); a.knock.z += (dz / d) * 9 * (1 - d / 2.8); }
    }
    sp.state = 'none';
    sp.carrier = null;
    sp.g.visible = false;
    sp.sprite.visible = false;
    sp.light.intensity = 0;
    this.respawnT = 2;
  }

  /** A loose spider leaps at a nearby subject's predicted position. */
  _pounce(t) {
    const sp = this.spider;
    const flight = 0.42;
    const tx = t.pos.x + t.vel.x * flight, tz = t.pos.z + t.vel.z * flight;
    sp.vel.set((tx - sp.pos.x) / flight, (GRAVITY * flight) / 2 + 1.2, (tz - sp.pos.z) / flight);
    sp.pos.y = 0.05;
    sp.state = 'flying';
    sp.thrower = null;
    sp.pounceCd = 1.4;
    Audio.sfx('spider');
  }

  /** Can this actor be latched right now? */
  _latchable(a) { return a.alive && !(a.data.immuneUntil > this.time); }

  _updateSpider(dt) {
    const sp = this.spider;
    if (sp.state === 'none') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this._spawnSpider();
      return;
    }
    if (sp.state !== 'drop') {
      sp.fuse -= sp.state === 'attached' ? dt : dt * LOOSE_BURN;
      if (sp.fuse <= 0) { this._detonate(); return; }
    }

    if (sp.state === 'drop') {
      const t = sp.dropTarget;
      if (!t.alive) { sp.state = 'flying'; sp.vel.set(0, 0, 0); }
      else {
        sp.dropT += dt / 0.6;
        const back = this._backPos(t.actor);
        const k = Math.min(1, sp.dropT);
        sp.pos.set(back.x, back.y + (1 - k * k) * 9, back.z);
        sp.g.rotation.set(0, sp.heading += dt * 6, 0);
        if (sp.dropT >= 1) this._latch(t);
      }
    }
    if (sp.state === 'attached') {
      const a = sp.carrier.actor;
      sp.attachedT += dt;
      sp.pos.copy(this._backPos(a));
      sp.g.rotation.set(-Math.PI / 2, a.subject.root.rotation.y, 0);
      if (sp.carrier.ctrl.aPressed && sp.attachedT > 0.25 && this.state === 'play') this._throw(sp.carrier);
    } else if (sp.state === 'flying') {
      sp.vel.y -= GRAVITY * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      const r = Math.hypot(sp.pos.x, sp.pos.z);
      if (r > R - 0.3) { // bonk off the railing
        sp.pos.x *= (R - 0.3) / r; sp.pos.z *= (R - 0.3) / r;
        sp.vel.x *= -0.35; sp.vel.z *= -0.35;
        Audio.sfx('clank', { vol: 0.4 });
      }
      sp.g.rotation.set(0, sp.heading += dt * 14, 0);
      for (const seat of this.aliveSeats) {
        const a = seat.actor;
        if (!this._latchable(a) || sp.pos.y > 2.2) continue;
        if (Math.hypot(a.pos.x - sp.pos.x, a.pos.z - sp.pos.z) < LATCH_DIST) { this._latch(seat); break; }
      }
      if (sp.state === 'flying' && sp.pos.y <= 0.02) {
        sp.pos.y = 0;
        sp.state = 'scuttle';
        sp.pounceCd = Math.max(sp.pounceCd, 0.5);
        Audio.sfx('clank', { vol: 0.5 });
        this.fx.sparks(sp.pos.clone(), { count: 6 });
      }
    } else if (sp.state === 'scuttle') {
      let best = null, bd = Infinity;
      for (const seat of this.aliveSeats) {
        if (!this._latchable(seat.actor)) continue;
        const d = Math.hypot(seat.actor.pos.x - sp.pos.x, seat.actor.pos.z - sp.pos.z);
        if (d < bd) { bd = d; best = seat; }
      }
      sp.pounceCd -= dt;
      if (best) {
        const t = best.actor;
        const want = Math.atan2(t.pos.x - sp.pos.x, t.pos.z - sp.pos.z);
        sp.heading += angleDiff(sp.heading, want) * Math.min(1, dt * 10);
        const speed = SCUTTLE_SPEED + (1 - sp.fuse / sp.fuseMax) * 1.5;
        sp.pos.x += Math.sin(sp.heading) * speed * dt;
        sp.pos.z += Math.cos(sp.heading) * speed * dt;
        if (bd < LATCH_DIST) this._latch(best);
        else if (bd < POUNCE_RANGE && sp.pounceCd <= 0) this._pounce(t);
      }
      sp.g.rotation.set(0, sp.heading, 0);
    }
    sp.g.position.copy(sp.pos);

    const scuttling = sp.state === 'scuttle' || sp.state === 'drop';
    this._animateSpider(dt, scuttling ? 14 : sp.state === 'attached' ? 5 : 2, scuttling ? 0.55 : 0.25);
    this._updateFuseDisplay(dt);
  }

  /** World point on an actor's back where the spider clings. */
  _backPos(a) {
    const yaw = a.subject.root.rotation.y;
    return new THREE.Vector3(a.pos.x - Math.sin(yaw) * 0.28, a.y + 1.3, a.pos.z - Math.cos(yaw) * 0.28);
  }

  /** Leg gait: alternating tetrapod swing. */
  _animateSpider(dt, rate, amp) {
    const sp = this.spider;
    sp.legPhase += dt * rate;
    for (const L of sp.legs) {
      const ph = sp.legPhase + (L.i % 2 ? Math.PI : 0) + (L.side > 0 ? Math.PI : 0);
      L.hip.rotation.y = L.baseY + Math.sin(ph) * amp * 0.6;
      L.hip.rotation.z = Math.max(0, Math.cos(ph)) * amp * 0.5 * L.side;
    }
  }

  /** Blinking eye (faster as the fuse burns) + digits for the final 3 s. */
  _updateFuseDisplay(dt) {
    const sp = this.spider;
    const burnt = 1 - Math.max(0, sp.fuse) / sp.fuseMax;
    const freq = sp.state === 'drop' ? 1 : 1.2 + burnt * burnt * 11;
    sp.blink += dt * freq;
    const on = (sp.blink % 1) < 0.45;
    if (on && !sp.blinkOn && sp.state !== 'drop') Audio.sfx(sp.fuse < 3 ? 'beep' : 'tick', { vol: sp.fuse < 3 ? 0.35 : 0.5 });
    sp.blinkOn = on;
    sp.eyeMat.color.setHex(on ? 0xff2010 : 0x3a0806);
    sp.light.intensity = on ? 6 : 0;
    const show = sp.state !== 'drop' && sp.fuse <= 3;
    sp.sprite.visible = show;
    if (show) {
      const digit = Math.max(1, Math.ceil(sp.fuse));
      if (digit !== sp.shownDigit) {
        sp.shownDigit = digit;
        const c = sp.canvas.getContext('2d');
        c.clearRect(0, 0, 64, 64);
        c.font = '52px "Black Ops One", Impact, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 8; c.strokeStyle = '#000'; c.strokeText(String(digit), 32, 35);
        c.fillStyle = '#ff3a2a'; c.fillText(String(digit), 32, 35);
        sp.tex.needsUpdate = true;
      }
      sp.sprite.position.set(sp.pos.x, sp.pos.y + 1.0, sp.pos.z);
      sp.sprite.scale.setScalar(on ? 1.25 : 1.05);
    }
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    const playing = this.state === 'play';
    this.arena.step(dt, playing);
    // Circular pit wall.
    for (const a of this.arena.actors) {
      if (!a.alive) continue;
      const r = Math.hypot(a.pos.x, a.pos.z), max = R - a.radius;
      if (r > max) { a.pos.x *= max / r; a.pos.z *= max / r; a.subject.root.position.x = a.pos.x; a.subject.root.position.z = a.pos.z; }
    }
    this.heat.intensity = 22 + Math.sin(this.time * 3) * 4 + random() * 3;
    if (playing) this._updateSpider(dt);
    else if (this.spider.state === 'attached' && this.spider.carrier) {
      // keep the spider glued to the winner while the round wraps up
      const sp = this.spider;
      sp.g.position.copy(this._backPos(sp.carrier.actor));
      sp.g.rotation.set(-Math.PI / 2, sp.carrier.actor.subject.root.rotation.y, 0);
      this._animateSpider(dt, 5, 0.25);
    }
    if (!playing) return;

    const sp = this.spider;
    for (const seat of this.seats) {
      if (!seat.alive) { this.hud.setStat(seat, 'FOLDED'); this.hud.setStatus(seat, ''); continue; }
      const has = sp.state === 'attached' && sp.carrier === seat;
      this.hud.setStat(seat, has ? 'SPIDER!' : seat.actor.data.immuneUntil > this.time ? 'IMMUNE' : 'CLEAN');
      this.hud.setStatus(seat, has ? 'CARRIER' : '');
    }
    this.hud.setTimer(null);
    if (this.time > 150) { this.end(); return; } // absolute safety net
    this.checkLastStanding();
  }

  // ---------------------------------------------------------------------- bots

  botThink(seat, dt) {
    const a = seat.actor, brain = seat.brain, mem = brain.memory;
    const sp = this.spider;
    let wantA = false, wantB = false;

    if (sp.state === 'attached' && sp.carrier === seat) {
      // Carrier: chase the nearest latchable rival and throw when lined up.
      const n = nearest(a, this.arena.actors, (o) => this._latchable(o));
      if (n) {
        const t = n.actor;
        const lead = 0.25;
        const tx = t.pos.x + t.vel.x * lead, tz = t.pos.z + t.vel.z * lead;
        const ang = Math.atan2(tx - a.pos.x, tz - a.pos.z);
        if (n.dist < 4 && sp.attachedT > 0.3 + brain.reaction) {
          mem.aim = mem.aim ?? rand(-1, 1) * brain.error * 0.9;
          const aim = ang + mem.aim;
          a.ctrl.setMove(Math.sin(aim) * 0.35, Math.cos(aim) * 0.35);
          if (Math.abs(angleDiff(a.facing, aim)) < 0.25 || sp.fuse < 0.6) wantA = true;
        } else {
          mem.aim = null;
          steerTo(a, tx, tz, { arrive: 0 });
        }
      } else wander(a, brain, dt, { minX: -R + 2, maxX: R - 2, minZ: -R + 2, maxZ: R - 2 });
    } else {
      mem.aim = null;
      // Everyone else: flee the carrier / loose spider, hug the middle of the free space.
      let threat = null;
      if (sp.state === 'attached' && sp.carrier) threat = sp.carrier.actor.pos;
      else if (sp.state !== 'none') threat = sp.pos;
      let fx = 0, fz = 0;
      if (threat) {
        const dx = a.pos.x - threat.x, dz = a.pos.z - threat.z, d = Math.hypot(dx, dz) || 0.01;
        const range = sp.state === 'scuttle' ? 5 : 6.5;
        if (d < range) {
          const w = (range - d) / range;
          fx += (dx / d) * w * 2.2; fz += (dz / d) * w * 2.2;
          // Slide along the wall instead of getting pinned against it.
          const r = Math.hypot(a.pos.x, a.pos.z) || 0.01;
          if (r > R - 2.4) {
            let tx = -a.pos.z / r, tz = a.pos.x / r;
            if (tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
            fx += tx * 1.6 - (a.pos.x / r) * 0.9; fz += tz * 1.6 - (a.pos.z / r) * 0.9;
          }
        }
        // Panic shove: carrier right on top of us.
        if (sp.state === 'attached' && d < 1.25 && random() < 0.08 + brain.difficulty * 0.1) {
          a.ctrl.setMove(-dx / d * 0.3, -dz / d * 0.3);
          wantB = true;
          fx = fz = 0;
        }
      }
      if (!wantB) {
        if (Math.hypot(fx, fz) > 0.25) a.ctrl.setMove(fx, fz);
        else wander(a, brain, dt, { minX: -R + 2.2, maxX: R - 2.2, minZ: -R + 2.2, maxZ: R - 2.2 });
      }
    }
    // Buttons are edge-triggered: alternate so repeated intents become fresh presses.
    a.ctrl.setButtons(wantA && !mem.aPrev, wantB && !mem.bPrev);
    mem.aPrev = wantA && !mem.aPrev;
    mem.bPrev = wantB && !mem.bPrev;
  }
}

/** See-through steel grate: dark bars on transparent holes (alpha-tested). */
function grateTexture(radius) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#4b4c48';
  for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 5, 64); g.fillRect(0, i, 64, 5); }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 64; i += 16) { g.fillRect(i + 4, 0, 1, 64); g.fillRect(0, i + 4, 64, 1); }
  const img = g.getImageData(0, 0, 64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 40;
    img.data[i] += n + 8; img.data[i + 1] += n; img.data[i + 2] += n - 6;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(radius * 0.9, radius * 0.9);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
