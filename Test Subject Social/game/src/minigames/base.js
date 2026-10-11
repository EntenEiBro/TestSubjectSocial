/**
 * base.js — the Minigame contract every round implements.
 *
 * Lifecycle (driven by game/flow.js):
 *
 *   const game = new MyGame(ctx);
 *   game.build();          // create scene, camera, avatars (shown behind the briefing)
 *   game.preview(dt)       // optional idle animation while briefing is up
 *   game.begin();          // countdown finished → calls start()
 *   game.tick(dt)          // per frame: bots think, update(), HUD, FX
 *   await game.finished;   // resolves with placement tiers once end() was called
 *
 * Subclasses override: static meta, build(), start(), update(dt),
 * botThink(seat, dt) and optionally placement().
 *
 * A "seat" is the per-round record for one participant:
 *   { player, ctrl, brain, isBot, alive, deathTime, score, subject?, actor? }
 *
 * Determinism (online play runs every round on each player's device in
 * lockstep, see net/lockstep.js): simulation code must take randomness from
 * core/rng.js and time from `this.time` / `this.clock` — never Math.random(),
 * performance.now() or the engine's wall-clock time.
 */
import * as THREE from 'three';
import { Audio } from '../core/audio.js';
import { FX } from '../core/fx.js';
import { createMoodScene } from '../core/engine.js';
import { makeBrain } from '../core/ai.js';
import { subjectFor } from '../core/characters.js';
import { playerRing } from '../core/environment.js';
import { Commendations } from '../game/achievements.js';
import { Haptics } from '../core/haptics.js';
import { Controller } from '../core/input.js';

export class Minigame {
  /**
   * Describes the round for menus and briefing screens. Override in subclasses.
   * controls: [{ input: 'move'|'a'|'b', label }]
   * objective: short win condition text (shown on briefing page 2)
   */
  static meta = {
    id: 'base',
    title: 'Untitled',
    tagline: '',
    category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }],
    objective: 'Survive.',
    rules: [],
  };

  /**
   * @param {object} ctx
   * @param {import('../core/engine.js').Engine} ctx.engine
   * @param {import('../core/input.js').InputManager} ctx.input
   * @param {import('../ui/hud.js').Hud} ctx.hud
   * @param {import('../game/players.js').Player[]} ctx.players
   * @param {number} ctx.botDifficulty 0..1
   * @param {boolean} [ctx.lockstep] online round: every seat gets a private
   *   controller that the lockstep driver feeds and commits once per tick
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.engine = ctx.engine;
    this.input = ctx.input;
    this.hud = ctx.hud;
    this.meta = this.constructor.meta;
    this.time = 0;          // seconds since start()
    this.clock = 0;         // seconds of simulation since build (also runs during preview)
    this.lockstep = !!ctx.lockstep;
    this.state = 'build';   // 'build' | 'preview' | 'play' | 'over'
    this.deaths = [];       // seats in order of death
    this.scene = null;
    this.camera = null;
    this.fx = null;
    this.seats = ctx.players.map((player) => {
      let ctrl;
      if (this.lockstep) ctrl = new Controller(player.device);
      else {
        ctrl = player.isBot ? this.input.controller('bot') : this.input.controller(player.device);
        if (player.isBot) this.input.track(ctrl);
      }
      return {
        player, ctrl, isBot: player.isBot,
        brain: makeBrain(ctx.botDifficulty ?? 0.6),
        alive: true, deathTime: null, score: 0,
        subject: null, actor: null, tagTarget: null,
      };
    });
    this._endIn = null;     // game-time countdown to resolving `finished`
    this._endTiers = null;
    this.finished = new Promise((res) => { this._resolve = res; });
  }

  // ---------------------------------------------------------------- overrides

  /** Construct the stage. Must set this.scene and this.camera. */
  build() {}
  /** Called once when the countdown reaches GO. */
  start() {}
  /** Per-frame game logic while state === 'play'. */
  update(_dt) {}
  /** Per-frame bot logic for one bot seat while playing. */
  botThink(_seat, _dt) {}
  /** Idle animation during briefing (state === 'preview'). */
  preview(_dt) {}
  /**
   * Final ranking as tiers (arrays of seats), best first. Default:
   * survivors (sorted by seat.score, ties grouped) then the dead in reverse
   * death order — whoever died last places highest among the dead.
   */
  placement() {
    const alive = this.seats.filter((s) => s.alive);
    const tiers = groupBy(alive.sort((a, b) => b.score - a.score), (s) => s.score);
    // Subjects who died in the same instant share a tier.
    const dead = groupBy(this.deaths.slice().reverse(), (s) => s.deathTime.toFixed(3));
    return [...tiers, ...dead];
  }

  // ------------------------------------------------------------------ helpers

  /** Create a standard moody scene + FX system. */
  makeScene(opts = {}) {
    this.scene = createMoodScene(opts);
    this.fx = new FX(this.scene, { floorAt: opts.floorAt || (() => 0) });
    return this.scene;
  }

  /** Create a perspective camera positioned at `pos` looking at `look`. */
  makeCamera(pos, look, fov = 50) {
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 300);
    this.camera.position.set(...pos);
    this.camera.lookAt(new THREE.Vector3(...look));
    return this.camera;
  }

  /** Spawn the avatar for a seat, optionally with a coloured ground ring. */
  spawnSubject(seat, { x = 0, y = 0, z = 0, ring = true, facing = 0 } = {}) {
    const s = subjectFor(seat.player);
    s.root.position.set(x, y, z);
    s.root.rotation.y = facing;
    if (ring) { s.ring = playerRing(seat.player.color); s.root.add(s.ring); }
    this.scene.add(s.root);
    seat.subject = s;
    seat.tagTarget = s.parts.head;
    return s;
  }

  /**
   * Eliminate a seat with a death style (see FX.kill). Safe to call twice.
   * @returns {boolean} true if the seat was alive.
   */
  kill(seat, style = 'gib', { dir, force, sound, quiet = false } = {}) {
    if (!seat.alive) return false;
    seat.alive = false;
    seat.deathTime = this.time;
    this.deaths.push(seat);
    if (seat.actor) seat.actor.alive = false;
    if (seat.subject) {
      if (seat.subject.ring) seat.subject.ring.visible = false;
      this.fx.kill(seat.subject, style, { dir, force });
    }
    seat.tagTarget = null;
    this.hud.markDead(seat);
    // The phone's own player feels their death (a long, distinct buzz).
    Haptics.forPlayer(seat.player, 'death');
    const sfx = sound || { gib: 'splat', shot: 'shot', crush: 'crunch', fall: 'whoosh', snap: 'snap', burn: 'burn', slice: 'saw' }[style];
    if (sfx) Audio.sfx(sfx);
    if (style !== 'fall') Audio.sfx('splat', { vol: 0.6 });
    this.engine.shake(style === 'fall' ? 0.1 : 0.5);
    if (!quiet) this.hud.feed(`${seat.player.name} — TERMINATED`, seat.player.color);
    return true;
  }

  /** True for seats played on this device (online players' seats live on their own devices). */
  isLocal(seat) { return !!seat && !seat.isBot && !seat.player.remote; }

  /** Unlock a one-shot commendation for a human seat on this device (see game/achievements.js). */
  award(seat, key) { if (this.isLocal(seat)) Commendations.unlock(key); }

  /** Advance a cumulative commendation counter for a human seat on this device. */
  progress(seat, key, amount = 1) { if (this.isLocal(seat)) Commendations.add(key, amount); }

  get aliveSeats() { return this.seats.filter((s) => s.alive); }
  get humanSeats() { return this.seats.filter((s) => !s.isBot); }

  /** Finish the round after an optional dramatic pause. */
  end(delay = 2.2, tiers = null) {
    if (this.state === 'over') return;
    this.state = 'over';
    // Counted in game time (see tick) so pauses and throttled frames stay in sync.
    this._endIn = delay;
    this._endTiers = tiers;
  }

  /** Standard "last one standing" check. Returns true if the round ended. */
  checkLastStanding(minAlive = 1) {
    if (this.state !== 'play') return false;
    if (this.aliveSeats.length <= minAlive) { this.end(); return true; }
    return false;
  }

  // ----------------------------------------------------------- engine-facing

  /**
   * Compile every shader the round can need now, behind the briefing, so
   * nothing stalls mid-round (phones need ~100 ms per batch of shaders):
   *  - lights attached to objects move to the scene root and follow them
   *    (see _syncLights). A light that appears or disappears with its object
   *    changes the light count, and that recompiles every material;
   *  - all materials are compiled, hidden objects included, plus samples of
   *    the effect materials (blood, pools, smoke, sparks) and one avatar per
   *    seat. Materials that only exist later must be on a hidden template
   *    mesh in build() (see sonar.js pings, pressure.js shards).
   * Called by the flow right after build().
   */
  prewarm() {
    if (!this.scene || !this.camera) return;
    this._hoistLights();
    const samples = this.fx ? this.fx.samples() : [];
    // Avatars spawned later in the round (e.g. a seat that sits out a phase) use these shaders.
    const avatars = this.seats.map((seat) => subjectFor(seat.player));
    for (const a of avatars) samples.push(a.root);
    for (const m of samples) this.scene.add(m);
    try {
      this.engine.renderer.compile(this.scene, this.camera);
    } finally {
      for (const m of samples) this.scene.remove(m);
      for (const a of avatars) a.dispose();
    }
  }

  _hoistLights() {
    const lights = [];
    this.scene.traverse((o) => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight && o.parent !== this.scene) lights.push(o); });
    this._lights = lights.map((light) => {
      const anchor = new THREE.Object3D(); // stands in for the light inside its object
      anchor.position.copy(light.position);
      light.parent.add(anchor);
      this.scene.add(light);
      return { light, anchor, hidden: false, saved: light.intensity };
    });
    this._syncLights();
  }

  /** Hoisted lights follow their anchor; while it is hidden (or removed) the light is dark. */
  _syncLights() {
    if (!this._lights) return;
    for (const h of this._lights) {
      let o = h.anchor;
      let shown = true;
      while (o && o !== this.scene) { if (!o.visible) shown = false; o = o.parent; }
      if (!o) shown = false; // no longer in the scene
      if (shown) {
        if (h.hidden) { h.hidden = false; h.light.intensity = h.saved; }
        h.anchor.updateWorldMatrix(true, false);
        h.light.position.setFromMatrixPosition(h.anchor.matrixWorld);
      } else {
        if (h.light.intensity !== 0) h.saved = h.light.intensity; // the round may still change it
        h.hidden = true;
        h.light.intensity = 0;
      }
    }
  }

  /** Countdown finished. */
  begin() {
    this.state = 'play';
    this.time = 0;
    this.start();
  }

  /** Called every frame by the flow controller. */
  tick(dt) {
    this.clock += dt;
    if (this.state === 'preview' || this.state === 'build') this.preview(dt);
    if (this.state === 'play') {
      this.time += dt;
      for (const seat of this.seats) if (seat.isBot && seat.alive) this.botThink(seat, dt);
      this.update(dt);
    } else if (this.state === 'over') {
      this.update(dt); // let physics / animations settle
      if (this._endIn !== null) {
        this._endIn -= dt;
        if (this._endIn <= 0) { this._endIn = null; this._resolve(this._endTiers || this.placement()); }
      }
    }
    if (this.fx) this.fx.update(dt);
    this._syncLights();
    this._updateTags();
  }

  _updateTags() {
    const v = new THREE.Vector3();
    for (const seat of this.seats) {
      if (!seat.tagTarget || !this.camera) { this.hud.tag(seat, null); continue; }
      seat.tagTarget.getWorldPosition(v);
      v.y += 0.55;
      v.project(this.camera);
      if (v.z > 1) { this.hud.tag(seat, null); continue; }
      this.hud.tag(seat, { x: (v.x + 1) / 2, y: (1 - v.y) / 2 });
    }
  }

  /** Release resources. */
  dispose() {
    this.input.untrackAll();
    this.hud.clear();
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // Shared (cached) procedural textures survive; per-round textures are freed.
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); });
    });
  }
}

/** Group a pre-sorted array into tiers of equal key. */
export function groupBy(sorted, key) {
  const tiers = [];
  for (const item of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && key(last[0]) === key(item)) last.push(item); else tiers.push([item]);
  }
  return tiers;
}

/** Rank by score descending, then (if equal) alive before dead. */
export function rankByScore(seats) {
  const sorted = seats.slice().sort((a, b) => (b.score - a.score) || ((b.alive ? 1 : 0) - (a.alive ? 1 : 0)));
  return groupBy(sorted, (s) => `${s.score}|${s.alive}`);
}
